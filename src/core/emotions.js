/**
 * 情绪词典与向量工具
 * ==================================================================
 * 统一 7 类情绪的顺序、中文名、颜色、表情以及效价/唤醒度坐标；
 * 提供向量互转、熵、主导情绪、温度摊平等基础运算。
 */

/** 7 类情绪（顺序即向量顺序） */
export const EMOTIONS = [
  { id: 'happy', label: '开心', en: 'Happy', color: '#FFC857', emoji: '😄', valence: 0.85, arousal: 0.75, accent: '#FF9F1C' },
  { id: 'sad', label: '悲伤', en: 'Sad', color: '#5B8FF9', emoji: '😢', valence: -0.8, arousal: 0.25, accent: '#3B74E8' },
  { id: 'angry', label: '愤怒', en: 'Angry', color: '#F95738', emoji: '😠', valence: -0.75, arousal: 0.95, accent: '#D93A1F' },
  { id: 'fearful', label: '恐惧', en: 'Fearful', color: '#9B5DE5', emoji: '😨', valence: -0.7, arousal: 0.8, accent: '#7A3FC7' },
  { id: 'disgusted', label: '厌恶', en: 'Disgusted', color: '#8D9440', emoji: '🤢', valence: -0.6, arousal: 0.5, accent: '#6E7530' },
  { id: 'surprised', label: '惊讶', en: 'Surprised', color: '#00BBF9', emoji: '😲', valence: 0.15, arousal: 0.9, accent: '#0092C4' },
  { id: 'neutral', label: '平静', en: 'Neutral', color: '#ADB5BD', emoji: '😐', valence: 0, arousal: 0.35, accent: '#8A939D' },
]

/** 情绪 id 顺序 */
export const EMOTION_KEYS = EMOTIONS.map((e) => e.id)

/** id → 元数据 */
const EMOTION_MAP = new Map(EMOTIONS.map((e) => [e.id, e]))

/** 便捷映射：id → 颜色 / 表情 / 中文名 */
export const EMOTION_COLORS = Object.fromEntries(EMOTIONS.map((e) => [e.id, e.color]))
export const EMOTION_EMOJI = Object.fromEntries(EMOTIONS.map((e) => [e.id, e.emoji]))
export const EMOTION_LABELS = Object.fromEntries(EMOTIONS.map((e) => [e.id, e.label]))

/** 数值清洗：非有限数归零，负数截断为 0 */
function safe(n) {
  const v = Number(n)
  return Number.isFinite(v) && v > 0 ? v : 0
}

export function clamp01(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.min(1, Math.max(0, v))
}

export function round3(n) {
  return Math.round(Number(n) * 1000) / 1000
}

export function formatPercent(n, digits = 1) {
  return `${(Number(n) * 100).toFixed(digits)}%`
}

/** 取情绪元数据，未知回退平静 */
export function getEmotion(id) {
  return EMOTION_MAP.get(id) || EMOTION_MAP.get('neutral')
}

/** 任意输入（数组 / 对象）→ 按 EMOTION_KEYS 顺序的 7 维数组 */
export function toVec(input) {
  if (Array.isArray(input)) {
    return EMOTION_KEYS.map((_, i) => safe(input[i]))
  }
  if (input && typeof input === 'object') {
    return EMOTION_KEYS.map((k) => safe(input[k]))
  }
  return EMOTION_KEYS.map(() => 0)
}

/** 任意输入 → { happy: 0.2, sad: 0, ... } 全 7 键对象 */
export function toObject(input) {
  const vec = toVec(input)
  const out = {}
  EMOTION_KEYS.forEach((k, i) => { out[k] = vec[i] })
  return out
}

/** 归一化为概率分布（和为 1）；全零时退化为均匀分布 */
export function normalizeProb(input) {
  const obj = toObject(input)
  let sum = 0
  EMOTION_KEYS.forEach((k) => { sum += obj[k] })
  const out = {}
  if (sum <= 1e-9) {
    const uniform = 1 / EMOTION_KEYS.length
    EMOTION_KEYS.forEach((k) => { out[k] = uniform })
    return out
  }
  EMOTION_KEYS.forEach((k) => { out[k] = obj[k] / sum })
  return out
}

/** 归一化香农熵 ∈ [0,1]：0 表示完全确定，1 表示完全均匀 */
export function entropyOf(input) {
  const prob = normalizeProb(input)
  let h = 0
  EMOTION_KEYS.forEach((k) => {
    const p = prob[k]
    if (p > 0) h -= p * Math.log(p)
  })
  return clamp01(h / Math.log(EMOTION_KEYS.length))
}

/** 置信度 = 1 - 归一化熵 */
export function confidenceOf(input) {
  return clamp01(1 - entropyOf(input))
}

/** 主导情绪 → { id, label, prob, meta } */
export function dominantOf(input) {
  const prob = normalizeProb(input)
  let bestId = 'neutral'
  let best = -1
  EMOTION_KEYS.forEach((k) => {
    if (prob[k] > best) {
      best = prob[k]
      bestId = k
    }
  })
  const meta = getEmotion(bestId)
  return { id: meta.id, label: meta.label, prob: Math.max(0, best), meta }
}

/** 按情绪元数据加权，得到效价 / 唤醒度 / 情绪倾向 */
export function valenceArousalOf(input) {
  const prob = normalizeProb(input)
  let valence = 0
  let arousal = 0
  EMOTION_KEYS.forEach((k) => {
    const meta = getEmotion(k)
    valence += prob[k] * meta.valence
    arousal += prob[k] * meta.arousal
  })
  return {
    valence: round3(valence),
    arousal: round3(arousal),
    tilt: valence > 0.15 ? '正向' : valence < -0.15 ? '负向' : '中性',
  }
}

/**
 * 温度摊平：p ∝ p^(1/T)，T 越大分布越平缓。
 * 用于情绪分散时（explore 策略）降低主导情绪的统治力。
 */
export function temperOf(input, T = 1) {
  const prob = normalizeProb(input)
  const t = Math.max(1, Number(T) || 1)
  const out = {}
  let sum = 0
  EMOTION_KEYS.forEach((k) => {
    const p = Math.pow(prob[k], 1 / t)
    out[k] = p
    sum += p
  })
  EMOTION_KEYS.forEach((k) => { out[k] = sum > 1e-9 ? out[k] / sum : prob[k] })
  return out
}
