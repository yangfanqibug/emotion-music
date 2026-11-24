/**
 * 推荐引擎（情绪 → 歌曲）
 * ==================================================================
 * 模块职责：
 *   1. 依据用户情绪分布熵选择策略（focus / balanced / explore）；
 *   2. 用五因子（情绪画像、效价唤醒、节奏、质量、多样性）给歌曲打分；
 *   3. 用 MMR 做多样性重排，并对已播放曲目做让位处理；
 *   4. 为每首歌生成可解释的中文推荐理由。
 *
 * 纯 ESM、无第三方依赖；情绪分布与歌曲画像来自 ../core。
 */

import {
  EMOTION_KEYS,
  entropyOf,
  temperOf,
  dominantOf,
  getEmotion,
  clamp01,
} from '../core/emotions.js'
import { inferSongProfile } from '../core/song.js'

/* ------------------------------------------------------------------
 * 一、常量与策略表
 * ------------------------------------------------------------------ */

/** 五因子顺序（同时作为权重键顺序） */
const FACTOR_KEYS = ['emotion', 'va', 'tempo', 'quality', 'diversity']

/** 基础权重：情绪 0.34 / 效价唤醒 0.22 / 节奏 0.12 / 质量 0.12 / 多样性 0.20 */
export const BASE_WEIGHTS = Object.freeze({
  emotion: 0.34,
  va: 0.22,
  tempo: 0.12,
  quality: 0.12,
  diversity: 0.2,
})

/** 五因子中文名 */
export const FACTOR_LABELS = Object.freeze({
  emotion: '情绪匹配',
  va: '效价唤醒',
  tempo: '节奏',
  quality: '质量',
  diversity: '多样性',
})

/** 策略表：权重乘子会与基础权重相乘，再按 Σw 重新归一化 */
export const STRATEGIES = Object.freeze({
  focus: {
    label: '聚焦',
    description: '情绪分布集中时使用：放大情绪画像权重，优先贴合当前主导情绪。',
    weightMultipliers: { emotion: 1.25, va: 1, tempo: 1, quality: 0.75, diversity: 1 },
  },
  balanced: {
    label: '平衡',
    description: '情绪分布中等分散：五因子按基础权重均衡参与打分。',
    weightMultipliers: { emotion: 1, va: 1, tempo: 1, quality: 1, diversity: 1 },
  },
  explore: {
    label: '探索',
    description: '情绪分布高度分散时使用：以温度 T = 1 + 2H 摊平情绪分布，并提高质量权重。',
    weightMultipliers: { emotion: 0.7, va: 1, tempo: 1, quality: 1.3, diversity: 1 },
  },
})

/** 策略切换阈值（归一化熵） */
const ENTROPY_EXPLORE = 0.65
const ENTROPY_BALANCED = 0.45

/* 情绪画像余弦：先做 L2 归一化，再取点积并截断到 [0, 1]。 */

/* 效价唤醒：d = √((0.75·Δv)² + (0.65·Δa)²)，因子 = exp(−d² / (2·0.35²)) */
const VA_VALENCE_WEIGHT = 0.75
const VA_AROUSAL_WEIGHT = 0.65
const VA_SIGMA = 0.35

/* 节奏：目标 BPM = 50 + 130·arousal，δ = |bpm − 目标| / 130，因子 = exp(−0.5·(δ/0.28)²) */
const TEMPO_BASE_BPM = 50
const TEMPO_BPM_RANGE = 130
const TEMPO_SIGMA = 0.28
const TEMPO_NEUTRAL = 0.5

/* 质量：本地曲库 = 0.45 + 0.35·评分 + 0.2·播放量；在线曲库 = 0.55 + 0.25·试听链接 + 0.2·稳定哈希 */
const QUALITY_LOCAL_BASE = 0.45
const QUALITY_RATING_WEIGHT = 0.35
const QUALITY_PLAY_WEIGHT = 0.2
const QUALITY_RATING_SCALE = 5
const QUALITY_PLAY_SCALE = 5000
const QUALITY_ONLINE_BASE = 0.55
const QUALITY_PREVIEW_BONUS = 0.25
const QUALITY_HASH_WEIGHT = 0.2

/* 多样性：1 / (1 + 0.5·(n − 1))，n 为候选集中同艺人数量 */
const DIVERSITY_COEFFICIENT = 0.5

/* MMR：score′ = score − 0.35·max(已选 sim)，sim = 0.5·画像余弦 + 0.5·同艺人标记 */
const MMR_LAMBDA = 0.35
const MMR_ARTIST_WEIGHT = 0.5
const MAX_PER_ARTIST = 2

/** 默认返回条数 */
const DEFAULT_LIMIT = 12

/* ------------------------------------------------------------------
 * 二、通用工具
 * ------------------------------------------------------------------ */

function num(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function round4(value) {
  return Math.round(num(value) * 1e4) / 1e4
}

function clampRange(value, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

/** 把情绪分布（数组或对象）展开为按 EMOTION_KEYS 排序的数值向量 */
function vectorOf(input) {
  if (Array.isArray(input)) {
    return EMOTION_KEYS.map((_, index) => Math.max(0, num(input[index])))
  }
  if (input && typeof input === 'object') {
    return EMOTION_KEYS.map(key => Math.max(0, num(input[key])))
  }
  return EMOTION_KEYS.map(() => 0)
}

/** 概率归一化；全零/非法时返回 null */
function normalizeDistribution(vector) {
  const total = vector.reduce((sum, value) => sum + value, 0)
  if (!Number.isFinite(total) || total <= 1e-12) return null
  return vector.map(value => value / total)
}

/** L2 归一化（用于余弦相似度） */
function l2Normalize(vector) {
  let squareSum = 0
  for (const value of vector) squareSum += value * value
  const length = Math.sqrt(squareSum)
  if (!Number.isFinite(length) || length < 1e-12) return vector.map(() => 0)
  return vector.map(value => value / length)
}

/** 余弦相似度（两侧均需 L2 归一化），点积截断到 [0, 1] */
function cosineSimilarity(a, b) {
  let dot = 0
  const size = Math.min(a.length, b.length)
  for (let i = 0; i < size; i += 1) dot += a[i] * b[i]
  return clamp01(dot)
}

/** 艺人归一化键：小写、去首尾空格，缺失统一为 __unknown__ */
function artistKey(artist) {
  const text = String(artist ?? '').trim().toLowerCase()
  return text || '__unknown__'
}

/** FNV-1a 稳定哈希 → [0, 1)，用于给在线曲目一个确定性的质量先验 */
function stableHash(input) {
  const text = String(input ?? '')
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return (hash >>> 0) / 4294967296
}

function labelOf(id) {
  const meta = id ? getEmotion(id) : null
  return (meta && meta.label) || '平静'
}

/**
 * 歌曲画像缓存：优先使用歌曲自带 profile/valence/arousal，
 * 缺失时用 inferSongProfile 现算，并按对象引用缓存，避免重复计算。
 */
const songCache = new WeakMap()

function isProfile(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function ensureSong(song) {
  if (!song || typeof song !== 'object') return null
  const cached = songCache.get(song)
  if (cached) return cached

  let profile = song.profile
  let valence = song.valence
  let arousal = song.arousal
  const needProfile = !isProfile(profile)
  const needVa = !isFiniteNumber(valence) || !isFiniteNumber(arousal)

  if (needProfile || needVa) {
    const inferred = inferSongProfile(song) || {}
    if (needProfile) profile = isProfile(inferred.profile) ? inferred.profile : {}
    if (!isFiniteNumber(valence)) valence = num(inferred.valence)
    if (!isFiniteNumber(arousal)) arousal = num(inferred.arousal, 0.5)
  }

  const entry = {
    song,
    profile: isProfile(profile) ? profile : {},
    valence: clampRange(valence, -1, 1),
    arousal: clamp01(arousal),
  }
  songCache.set(song, entry)
  return entry
}

/* ------------------------------------------------------------------
 * 三、五因子打分
 * ------------------------------------------------------------------ */

/** 情绪匹配：用户情绪向量与歌曲画像的余弦相似度 */
function emotionFactor(emotionVec, entry) {
  return cosineSimilarity(emotionVec, l2Normalize(vectorOf(entry.profile)))
}

/** 效价唤醒：exp(−d² / (2·0.35²)) */
function vaFactor(userVa, entry) {
  const deltaV = VA_VALENCE_WEIGHT * (num(userVa.valence) - num(entry.valence))
  const deltaA = VA_AROUSAL_WEIGHT * (num(userVa.arousal) - num(entry.arousal))
  const distance = Math.sqrt(deltaV * deltaV + deltaA * deltaA)
  return clamp01(Math.exp(-(distance * distance) / (2 * VA_SIGMA * VA_SIGMA)))
}

/** 节奏：BPM 缺失按中性 0.5，且不计入权重分母 */
function tempoFactor(song, userVa) {
  const bpm = Number(song && song.bpm)
  if (!Number.isFinite(bpm) || bpm <= 0) {
    return { value: TEMPO_NEUTRAL, known: false }
  }
  const target = TEMPO_BASE_BPM + TEMPO_BPM_RANGE * num(userVa.arousal)
  const delta = Math.abs(bpm - target) / TEMPO_BPM_RANGE
  return { value: clamp01(Math.exp(-0.5 * (delta / TEMPO_SIGMA) ** 2)), known: true }
}

/** 在线曲库判定：iTunes 来源，或有试听链接但没有本地音频 */
function isOnlineSong(song) {
  const source = String((song && song.source) || '').toLowerCase()
  if (source === 'itunes') return true
  return !!song && !!song.previewUrl && !song.audioUrl
}

/** 质量：本地用评分 + 播放量对数压缩；在线用稳定哈希 + 试听链接加成 */
function qualityFactor(song) {
  if (isOnlineSong(song)) {
    const id = song.trackId ?? song.id ?? ''
    const previewBonus = song.previewUrl ? 1 : 0
    return clamp01(
      QUALITY_ONLINE_BASE +
        QUALITY_PREVIEW_BONUS * previewBonus +
        QUALITY_HASH_WEIGHT * stableHash(id),
    )
  }
  const rating = clamp01(num(song.rating) / QUALITY_RATING_SCALE)
  const plays = clamp01(
    Math.log1p(Math.max(0, num(song.playCount))) / Math.log1p(QUALITY_PLAY_SCALE),
  )
  return clamp01(
    QUALITY_LOCAL_BASE + QUALITY_RATING_WEIGHT * rating + QUALITY_PLAY_WEIGHT * plays,
  )
}

/** 多样性：1 / (1 + 0.5·(n − 1))，n 为候选集中同艺人数量 */
function diversityFactor(song, artistCounts) {
  const count = num(artistCounts[artistKey(song && song.artist)], 1) || 1
  return clamp01(1 / (1 + DIVERSITY_COEFFICIENT * (count - 1)))
}

/** 按策略把基础权重与乘子合并，并按 Σw 归一化 */
function buildWeights(override = {}, strategy = 'balanced') {
  const table = STRATEGIES[strategy] || STRATEGIES.balanced
  const merged = { ...BASE_WEIGHTS, ...(override || {}) }
  const weights = {}
  let total = 0
  for (const key of FACTOR_KEYS) {
    const multiplier = num(table.weightMultipliers[key], 1)
    const value = Math.max(0, num(merged[key])) * multiplier
    weights[key] = value
    total += value
  }
  if (!(total > 0)) return { ...BASE_WEIGHTS }
  for (const key of FACTOR_KEYS) weights[key] = weights[key] / total
  return weights
}

/**
 * 计算单首歌的五因子得分与加权综合分。
 *
 * @param {object} song 原始歌曲对象
 * @param {{emotionVec?: number[], va?: {valence: number, arousal: number},
 *          weights?: object, artistCounts?: object}} context 打分上下文
 * @returns {{score: number, factors: object, usedWeights: object, tempoKnown: boolean}}
 */
export function scoreSong(song, context = {}) {
  const entry = ensureSong(song)
  const weights = context.weights || BASE_WEIGHTS
  const emotionVec = context.emotionVec || []
  const userVa = context.va || { valence: 0, arousal: 0.5 }
  const artistCounts = context.artistCounts || {}

  if (!entry) {
    return {
      score: 0,
      factors: { emotion: 0, va: 0, tempo: TEMPO_NEUTRAL, quality: 0, diversity: 0 },
      usedWeights: { ...BASE_WEIGHTS },
      tempoKnown: false,
    }
  }

  const tempo = tempoFactor(entry.song, userVa)
  const factors = {
    emotion: emotionFactor(emotionVec, entry),
    va: vaFactor(userVa, entry),
    tempo: tempo.value,
    quality: qualityFactor(entry.song),
    diversity: diversityFactor(entry.song, artistCounts),
  }

  // 加权综合：score = Σ w·s / Σ w（BPM 未知时 tempo 不进入分子与分母）
  let weightedSum = 0
  let weightSum = 0
  const usedWeights = {}
  for (const key of FACTOR_KEYS) {
    const weight = Math.max(0, num(weights[key]))
    if (weight <= 0) {
      usedWeights[key] = 0
      continue
    }
    if (key === 'tempo' && !tempo.known) {
      usedWeights[key] = 0
      continue
    }
    weightedSum += weight * factors[key]
    weightSum += weight
    usedWeights[key] = weight
  }
  if (weightSum > 0) {
    for (const key of FACTOR_KEYS) usedWeights[key] = usedWeights[key] / weightSum
  }

  return {
    score: weightSum > 0 ? clamp01(weightedSum / weightSum) : 0,
    factors,
    usedWeights,
    tempoKnown: tempo.known,
  }
}

/* ------------------------------------------------------------------
 * 四、MMR 多样性重排
 * ------------------------------------------------------------------ */

/**
 * MMR 重排：score′ = score − λ·max(已选集合 sim)，
 * sim = 0.5·画像余弦 + 0.5·同艺人标记；同一艺人最多 2 首。
 * 因艺人上限被挡下的曲目按原始分补在末尾（保留兜底能力）。
 *
 * @param {Array<{song: object, score: number}>} ranked 已按基础分降序的候选
 * @param {{lambda?: number, maxPerArtist?: number}} options
 */
export function mmrRerank(ranked, options = {}) {
  const list = (Array.isArray(ranked) ? ranked : []).filter(Boolean)
  if (list.length <= 1) {
    return list.map(item => ({
      ...item,
      mmrScore: round4(num(item.score)),
      mmrPenalty: 0,
      artistRepeated: false,
      promoted: false,
      demoted: false,
    }))
  }

  const lambda = Number.isFinite(Number(options.lambda))
    ? Math.max(0, Number(options.lambda))
    : MMR_LAMBDA
  const maxPerArtist = Number.isFinite(Number(options.maxPerArtist))
    ? Math.max(1, Math.floor(Number(options.maxPerArtist)))
    : MAX_PER_ARTIST

  const profiles = list.map(item => {
    const song = item.song || item
    const entry = ensureSong(song)
    return l2Normalize(vectorOf(entry ? entry.profile : {}))
  })
  const artists = list.map(item => artistKey((item.song || item || {}).artist))
  const scores = list.map(item => num(item.score))

  const similarity = (a, b) => {
    const profileSim = cosineSimilarity(profiles[a], profiles[b])
    const sameArtist = artists[a] === artists[b] ? 1 : 0
    return MMR_ARTIST_WEIGHT * profileSim + MMR_ARTIST_WEIGHT * sameArtist
  }

  const used = list.map(() => false)
  const penalty = list.map(() => 0)
  const artistUsed = new Map()
  const greedy = []

  for (let step = 0; step < list.length; step += 1) {
    let best = -1
    let bestValue = -Infinity
    for (let i = 0; i < list.length; i += 1) {
      if (used[i]) continue
      if (num(artistUsed.get(artists[i])) >= maxPerArtist) continue
      const value = scores[i] - lambda * penalty[i]
      if (value > bestValue) {
        bestValue = value
        best = i
      }
    }
    if (best < 0) break

    used[best] = true
    const count = num(artistUsed.get(artists[best])) + 1
    artistUsed.set(artists[best], count)
    greedy.push({
      item: list[best],
      origin: best,
      mmrScore: bestValue,
      mmrPenalty: lambda * penalty[best],
      artistRepeated: count > 1,
    })

    for (let j = 0; j < list.length; j += 1) {
      if (used[j]) continue
      const sim = similarity(best, j)
      if (sim > penalty[j]) penalty[j] = sim
    }
  }

  // 被艺人上限挡下的曲目按原始分兜底，排在已选结果之后
  const leftover = []
  for (let i = 0; i < list.length; i += 1) {
    if (used[i]) continue
    leftover.push({
      item: list[i],
      origin: i,
      mmrScore: scores[i],
      mmrPenalty: 0,
      artistRepeated: num(artistUsed.get(artists[i])) > 0,
    })
  }
  leftover.sort((a, b) => b.mmrScore - a.mmrScore || a.origin - b.origin)

  // 已选部分按最终分降序输出
  const ordered = greedy.slice().sort((a, b) => b.mmrScore - a.mmrScore || a.origin - b.origin)
  const merged = [...ordered, ...leftover]

  return merged.map((entry, index) => ({
    ...entry.item,
    mmrScore: round4(entry.mmrScore),
    mmrPenalty: round4(entry.mmrPenalty),
    artistRepeated: entry.artistRepeated,
    promoted: index < entry.origin,
    demoted: index > entry.origin,
  }))
}

/* ------------------------------------------------------------------
 * 五、可解释理由
 * ------------------------------------------------------------------ */

/**
 * 生成中文推荐理由：按“权重 × 因子值”的贡献取前 2 个因子，
 * 若存在 MMR 标记则补 1 条，最终拼成 2~3 段短句。
 *
 * @param {object} song 歌曲
 * @param {object} factors 五因子
 * @param {{weights?: object, va?: object, dominantLabel?: string}} context
 * @param {{promoted?: boolean, artistRepeated?: boolean, demoted?: boolean}} flags
 */
export function buildReason(song, factors = {}, context = {}, flags = {}) {
  const weights = context.weights || BASE_WEIGHTS
  const userVa = context.va || { valence: 0, arousal: 0.5 }
  const stateLabel = context.dominantLabel || '平静'
  const candidates = []

  const emotionScore = clamp01(num(factors.emotion))
  candidates.push({
    key: 'emotion',
    value: emotionScore,
    text:
      emotionScore >= 0.65
        ? `情绪画像高度匹配（${emotionScore.toFixed(2)}）`
        : emotionScore >= 0.4
          ? `情绪画像部分匹配（${emotionScore.toFixed(2)}）`
          : `情绪画像偏中性（${emotionScore.toFixed(2)}）`,
  })

  const vaScore = clamp01(num(factors.va))
  candidates.push({
    key: 'va',
    value: vaScore,
    text:
      vaScore >= 0.75
        ? `与你当前${stateLabel}状态同向`
        : vaScore >= 0.55
          ? '情绪基调较为接近'
          : '情绪基调略有差异',
  })

  const bpm = Number(song && song.bpm)
  const tempoScore = clamp01(num(factors.tempo))
  if (Number.isFinite(bpm) && bpm > 0) {
    const target = TEMPO_BASE_BPM + TEMPO_BPM_RANGE * num(userVa.arousal)
    candidates.push({
      key: 'tempo',
      value: tempoScore,
      text:
        tempoScore >= 0.6
          ? `节奏接近 ${Math.round(bpm)} BPM`
          : `节奏${bpm > target ? '偏快' : '偏慢'}（${Math.round(bpm)} BPM）`,
    })
  } else {
    candidates.push({ key: 'tempo', value: 0, text: '节奏未知（按中性处理）' })
  }

  const qualityScore = clamp01(num(factors.quality))
  candidates.push({
    key: 'quality',
    value: qualityScore,
    text:
      qualityScore >= 0.8
        ? '曲库口碑较好'
        : qualityScore >= 0.55
          ? '曲库评价尚可'
          : '曲库评价一般',
  })

  const diversityScore = clamp01(num(factors.diversity))
  candidates.push({
    key: 'diversity',
    value: diversityScore,
    text: diversityScore >= 0.9 ? '同艺人作品分散推荐' : '避免同艺人扎堆',
  })

  const contribution = candidate =>
    num(weights[candidate.key]) > 0 ? num(weights[candidate.key]) * candidate.value : 0

  const sorted = candidates.slice().sort((a, b) => contribution(b) - contribution(a))
  const phrases = sorted.slice(0, 2).map(candidate => candidate.text)

  let flagText = ''
  if (flags.promoted) flagText = '为打破单一风格补充'
  else if (flags.artistRepeated) flagText = `${(song && song.artist) || '同一位艺人'} 的另一首作品`
  else if (flags.demoted) flagText = '与已选歌曲风格相近，略微降权'

  return (flagText ? [flagText, ...phrases] : phrases).slice(0, 3).join(' · ')
}

/* ------------------------------------------------------------------
 * 六、主流程
 * ------------------------------------------------------------------ */

/** 解析用户情绪入参：既支持纯分布，也支持 { expressions, va } 形式的上下文 */
function resolveUserEmotion(input) {
  if (input && typeof input === 'object' && !Array.isArray(input) && input.expressions) {
    return {
      distribution: input.expressions,
      va:
        input.va && isFiniteNumber(input.va.valence) && isFiniteNumber(input.va.arousal)
          ? input.va
          : null,
    }
  }
  return { distribution: input, va: null }
}

/** 由情绪分布计算 VA（概率加权期望） */
function vaFromDistribution(probabilities) {
  let valence = 0
  let arousal = 0
  EMOTION_KEYS.forEach((key, index) => {
    const p = num(probabilities[index])
    if (p <= 0) return
    const meta = getEmotion(key) || {}
    valence += p * num(meta.valence)
    arousal += p * num(meta.arousal)
  })
  return { valence: clampRange(valence, -1, 1), arousal: clamp01(arousal) }
}

/** 主导情绪的中文名 */
function dominantLabelOf(distribution) {
  const dominant = dominantOf(distribution)
  if (dominant && typeof dominant === 'object') return dominant.label || labelOf(dominant.id)
  if (typeof dominant === 'string') return labelOf(dominant)
  return '平静'
}

/** 归一化 limit */
function normalizeLimit(value) {
  if (value === undefined || value === null) return DEFAULT_LIMIT
  const limit = Number(value)
  if (!Number.isFinite(limit) || limit < 0) return DEFAULT_LIMIT
  return Math.floor(limit)
}

/** 解析已播放 id（支持字符串或 { id } 对象） */
function collectPlayedIds(input) {
  const ids = new Set()
  const list = Array.isArray(input) ? input : input ? [input] : []
  for (const item of list) {
    const id = typeof item === 'string' ? item : item && item.id
    if (id) ids.add(id)
  }
  return ids
}

function roundFactors(factors) {
  const result = {}
  for (const key of FACTOR_KEYS) result[key] = round4(factors[key])
  return result
}

/** 按基础分降序排列候选（同分时保持原顺序） */
function rankEntries(entries, context) {
  const scored = entries.map((entry, index) => ({
    song: entry.song,
    entry,
    index,
    ...scoreSong(entry.song, context),
  }))
  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  return scored
}

function toOutputItem(scored, reason, extraSuffix = '') {
  return {
    song: scored.song,
    score: round4(scored.score),
    factors: roundFactors(scored.factors),
    reason: extraSuffix ? `${reason}${extraSuffix}` : reason,
  }
}

/**
 * 推荐主入口。
 *
 * @param {object|number[]} userEmotion 用户情绪分布（7 键对象 / 数组 / { expressions, va }）
 * @param {Array<object>} songs 候选歌曲
 * @param {{limit?: number, weights?: object, playedIds?: Array<string|object>}} options
 * @returns {{strategy: string, entropy: number, weights: object,
 *            items: Array<{song: object, score: number, factors: object, reason: string}>}}
 */
export function recommend(userEmotion, songs, options = {}) {
  const limit = normalizeLimit(options.limit)
  const emptyResult = () => ({
    strategy: 'balanced',
    entropy: 0,
    weights: buildWeights(options.weights, 'balanced'),
    items: [],
  })

  const { distribution, va: presetVa } = resolveUserEmotion(userEmotion)
  const userVector = vectorOf(distribution)
  const probabilitySum = userVector.reduce((sum, value) => sum + value, 0)

  const entries = (Array.isArray(songs) ? songs : []).map(ensureSong).filter(Boolean)
  if (!(probabilitySum > 1e-9) || entries.length === 0) return emptyResult()

  // 策略：H > 0.65 → explore；H > 0.45 → balanced；否则 focus
  const entropy = clamp01(num(entropyOf(distribution)))
  const strategy =
    entropy > ENTROPY_EXPLORE ? 'explore' : entropy > ENTROPY_BALANCED ? 'balanced' : 'focus'

  // explore 用温度 T = 1 + 2H 摊平情绪分布，其余策略使用原分布
  let userProbabilities = normalizeDistribution(userVector)
  if (!userProbabilities) return emptyResult()
  if (strategy === 'explore') {
    const tempered = normalizeDistribution(vectorOf(temperOf(distribution, 1 + 2 * entropy)))
    if (tempered) userProbabilities = tempered
  }

  const emotionVec = l2Normalize(userProbabilities)
  const va =
    presetVa !== null
      ? {
          valence: clampRange(presetVa.valence, -1, 1),
          arousal: clamp01(presetVa.arousal),
        }
      : vaFromDistribution(userProbabilities)

  const weights = buildWeights(options.weights, strategy)

  // 候选集内同艺人数量（用于多样性因子）
  const artistCounts = {}
  for (const entry of entries) {
    const key = artistKey(entry.song.artist)
    artistCounts[key] = num(artistCounts[key]) + 1
  }

  const context = { emotionVec, va, weights, artistCounts }

  // 历史去重：未听过的曲目优先，全部听过时才回退到全量曲库
  const playedIds = collectPlayedIds(options.playedIds)
  const freshEntries = playedIds.size
    ? entries.filter(entry => !playedIds.has(entry.song.id))
    : entries.slice()
  const playedEntries = playedIds.size
    ? entries.filter(entry => playedIds.has(entry.song.id))
    : []
  const candidates = freshEntries.length > 0 ? freshEntries : entries

  const ranked = rankEntries(candidates, context)
  const reranked = mmrRerank(ranked, { lambda: MMR_LAMBDA, maxPerArtist: MAX_PER_ARTIST })

  const reasonContext = {
    weights,
    va,
    dominantLabel: dominantLabelOf(distribution),
  }

  const items = []
  for (const scored of reranked) {
    if (items.length >= limit) break
    items.push(
      toOutputItem(
        scored,
        buildReason(scored.song, scored.factors, reasonContext, {
          promoted: scored.promoted,
          artistRepeated: scored.artistRepeated,
          demoted: scored.demoted,
        }),
      ),
    )
  }

  // 新鲜曲目不足时才用已播放曲目补位
  if (items.length < limit && playedEntries.length > 0 && freshEntries.length > 0) {
    const playedRanked = rankEntries(playedEntries, context)
    for (const scored of playedRanked) {
      if (items.length >= limit) break
      items.push(
        toOutputItem(scored, buildReason(scored.song, scored.factors, reasonContext, {}), ' · 此前播放过'),
      )
    }
  }

  return {
    strategy,
    entropy: round4(entropy),
    weights: Object.fromEntries(FACTOR_KEYS.map(key => [key, round4(weights[key])])),
    items,
  }
}
