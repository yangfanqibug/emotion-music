/**
 * 歌曲情绪画像
 * ==================================================================
 * 把本地曲库的 mood 标签（feel）、BPM、曲风与标题关键词，折算成
 * 7 维情绪画像 + 效价/唤醒度，供推荐引擎做相似度计算。
 */

import { EMOTION_KEYS, clamp01, normalizeProb, toObject, valenceArousalOf } from './emotions.js'

/** 标签位置衰减：第 1 / 2 / 3 个 mood 标签的权重 */
const FEEL_WEIGHTS = [1, 0.6, 0.36]

/** mood 标签（小写）→ 情绪倾向，一条标签可指向多个情绪 */
const FEEL_MAP = {
  happy: { happy: 1 },
  joyful: { happy: 1 },
  uplifting: { happy: 0.8, surprised: 0.3 },
  bright: { happy: 0.7, surprised: 0.3 },
  cheerful: { happy: 1 },
  playful: { happy: 0.7, disgusted: 0.2, surprised: 0.2 },
  funny: { happy: 0.6, surprised: 0.4 },
  hopeful: { happy: 0.5, neutral: 0.4 },
  warm: { happy: 0.5, neutral: 0.4 },
  sunny: { happy: 0.9 },
  upbeat: { happy: 0.9, surprised: 0.2 },
  bouncy: { happy: 0.8, surprised: 0.3 },
  fun: { happy: 0.8, surprised: 0.2 },
  grooving: { happy: 0.4, neutral: 0.5 },
  groovy: { happy: 0.4, neutral: 0.5 },

  sad: { sad: 1 },
  melancholic: { sad: 0.9, neutral: 0.2 },
  melancholy: { sad: 0.9, neutral: 0.2 },
  sentimental: { sad: 0.5, neutral: 0.5 },
  tender: { sad: 0.3, neutral: 0.6 },
  longing: { sad: 0.7, neutral: 0.3 },
  tragic: { sad: 0.9, fearful: 0.2 },
  sorrow: { sad: 1 },
  emotional: { sad: 0.5, neutral: 0.5 },

  angry: { angry: 1 },
  aggressive: { angry: 0.9, fearful: 0.2 },
  intense: { angry: 0.7, surprised: 0.2 },
  harsh: { angry: 0.8, disgusted: 0.2 },
  rage: { angry: 1 },
  power: { angry: 0.5, surprised: 0.4 },

  fearful: { fearful: 1 },
  scary: { fearful: 1 },
  suspense: { fearful: 0.9, surprised: 0.1 },
  suspenseful: { fearful: 0.9, surprised: 0.1 },
  mysterious: { fearful: 0.5, neutral: 0.4 },
  eerie: { fearful: 0.8, disgusted: 0.2 },
  dark: { fearful: 0.7, sad: 0.2 },
  chilling: { fearful: 0.9 },
  tension: { fearful: 0.8, surprised: 0.2 },
  horror: { fearful: 1 },
  ominous: { fearful: 0.8, angry: 0.2 },

  quirky: { disgusted: 0.8, surprised: 0.2 },
  weird: { disgusted: 0.8, surprised: 0.2 },
  odd: { disgusted: 0.7, surprised: 0.2 },
  comical: { disgusted: 0.4, happy: 0.5 },

  epic: { surprised: 0.8, happy: 0.2 },
  dramatic: { surprised: 0.6, fearful: 0.2 },
  cinematic: { surprised: 0.7, neutral: 0.2 },
  triumphant: { surprised: 0.5, happy: 0.5 },
  exciting: { surprised: 0.6, happy: 0.4 },
  fanfare: { surprised: 0.8, happy: 0.2 },
  energetic: { surprised: 0.5, happy: 0.5 },

  calming: { neutral: 1 },
  relaxed: { neutral: 1 },
  chill: { neutral: 0.9 },
  ambient: { neutral: 1 },
  meditative: { neutral: 1 },
  dreamy: { neutral: 0.8, sad: 0.2 },
  ethereal: { neutral: 0.7, surprised: 0.2 },
  soft: { neutral: 0.8 },
  mellow: { neutral: 0.8 },
  peaceful: { neutral: 1 },
  easy: { neutral: 0.8 },
  gentle: { neutral: 0.8 },
  flowing: { neutral: 0.8 },
}

/** 标题关键词 → 情绪倾向（作为 mood 标签的补充） */
const TITLE_KEYWORDS = [
  { re: /(happy|sun|smile|joy|fun|party|dance)/i, mood: { happy: 0.5 } },
  { re: /(sad|cry|tear|alone|goodbye|farewell|lost)/i, mood: { sad: 0.5 } },
  { re: /(war|battle|fight|rage|storm)/i, mood: { angry: 0.4, fearful: 0.2 } },
  { re: /(night|dark|haunt|ghost|fear|shadow)/i, mood: { fearful: 0.4 } },
  { re: /(dream|sleep|moon|star|float|cloud|calm)/i, mood: { neutral: 0.4 } },
  { re: /(love|heart|tender|waltz)/i, mood: { sad: 0.2, neutral: 0.3 } },
]

function emptyProfile() {
  const p = {}
  EMOTION_KEYS.forEach((k) => { p[k] = 0 })
  return p
}

/** 把一条带权 mood 倾向叠加到画像上 */
function addMood(profile, mood, weight = 1) {
  Object.entries(mood || {}).forEach(([id, strength]) => {
    if (id in profile) profile[id] += weight * strength
  })
}

/**
 * 推算歌曲的 7 维情绪画像
 * @param {object} song 本地或在线歌曲
 * @returns {{profile: Record<string, number>, valence: number, arousal: number, moodTags: string[]}}
 */
export function inferSongProfile(song = {}) {
  const profile = emptyProfile()
  const feels = Array.isArray(song.feel) ? song.feel : song.mood ? [song.mood] : []

  // 1. mood 标签按位置衰减
  feels.slice(0, 3).forEach((feel, i) => {
    const key = String(feel || '').trim().toLowerCase()
    const mood = FEEL_MAP[key]
    if (mood) addMood(profile, mood, FEEL_WEIGHTS[i] ?? 0.2)
  })

  // 2. 标题关键词补充
  const title = String(song.title || '')
  TITLE_KEYWORDS.forEach(({ re, mood }) => {
    if (re.test(title)) addMood(profile, mood, 0.5)
  })

  // 3. BPM 调制：快歌偏向高唤醒，慢歌偏向平静/悲伤
  const bpm = Number(song.bpm)
  if (Number.isFinite(bpm) && bpm > 0) {
    if (bpm >= 120) { profile.happy += 0.3; profile.surprised += 0.2; profile.angry += 0.1 }
    else if (bpm >= 100) { profile.happy += 0.15 }
    else if (bpm <= 70) { profile.sad += 0.25; profile.neutral += 0.2 }
  }

  // 4. 没有任何线索时以平静兜底
  const total = EMOTION_KEYS.reduce((s, k) => s + profile[k], 0)
  if (total <= 1e-9) {
    profile.neutral = 1
    profile.happy = 0.2
  }

  // 5. 归一化到 0~1（保留相对强度，便于余弦相似度）
  const max = Math.max(...EMOTION_KEYS.map((k) => profile[k]), 1e-6)
  EMOTION_KEYS.forEach((k) => { profile[k] = Number((profile[k] / max).toFixed(4)) })

  // 6. 效价/唤醒度：画像加权 + BPM 唤醒度微调
  const prob = normalizeProb(profile)
  const va = valenceArousalOf(prob)
  let arousal = va.arousal
  if (Number.isFinite(bpm) && bpm > 0) {
    const bpmArousal = clamp01((bpm - 60) / 120)
    arousal = clamp01(arousal * 0.7 + bpmArousal * 0.3)
  }

  return {
    profile,
    valence: Number(va.valence.toFixed(3)),
    arousal: Number(arousal.toFixed(3)),
    moodTags: feels.slice(0, 3),
  }
}

/** 在线歌曲：曲风 + 标题 + 时长启发式（无 mood 标签时） */
export function inferOnlineSongProfile(song = {}) {
  const genre = String(song.genre || '').toLowerCase()
  const hints = []
  if (/(dance|electronic|edm|house|pop)/.test(genre)) hints.push({ happy: 0.5, surprised: 0.3 })
  if (/(rock|metal|punk|hardcore)/.test(genre)) hints.push({ angry: 0.5, surprised: 0.2 })
  if (/(folk|acoustic|singer|songwriter)/.test(genre)) hints.push({ sad: 0.3, neutral: 0.4 })
  if (/(classical|piano|ambient|new age)/.test(genre)) hints.push({ neutral: 0.6 })
  if (/(hip|rap|r&b|soul)/.test(genre)) hints.push({ happy: 0.3, neutral: 0.3 })
  if (/(soundtrack|score|cinematic)/.test(genre)) hints.push({ surprised: 0.4, fearful: 0.2 })

  const base = inferSongProfile({ ...song, feel: [] })
  hints.forEach((mood) => {
    Object.entries(mood).forEach(([id, s]) => {
      base.profile[id] = Math.min(1, (base.profile[id] || 0) + s)
    })
  })
  const va = valenceArousalOf(base.profile)
  return { ...base, moodTags: genre ? [genre] : [], valence: va.valence, arousal: va.arousal }
}

/** 本地曲库记录 → 应用内歌曲（同时预计算画像，减少推荐阶段开销） */
export function enrichLocalSong(raw = {}) {
  const song = {
    ...raw,
    source: raw.source || 'local',
    artwork: raw.artwork || null,
    previewUrl: raw.previewUrl || null,
    audioUrl: raw.audioUrl || null,
    bpm: Number.isFinite(Number(raw.bpm)) ? Number(raw.bpm) : null,
    rating: Number(raw.rating) || 0,
    playCount: Number(raw.playCount) || 0,
    license: raw.license || null,
    licenseUrl: raw.licenseUrl || null,
  }
  const inferred = inferSongProfile(song)
  return { ...song, ...inferred }
}

/** 画像对象 → 7 维数组 */
export function songToVector(profileObj) {
  const obj = toObject(profileObj)
  return EMOTION_KEYS.map((k) => obj[k])
}
