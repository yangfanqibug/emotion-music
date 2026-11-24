/**
 * 情绪稳定器
 * ==================================================================
 * 视频/摄像头逐帧结果抖动较大，这里做两步处理：
 *   1. EMA 指数平滑（α = 0.35）
 *   2. 连续帧判定：≥ 4 帧、主导概率 ≥ 0.45、众数 ≥ 4 帧才标记「稳定」
 */

import { confidenceOf, dominantOf, entropyOf, normalizeProb } from '../core/emotions.js'

export const EMA_ALPHA = 0.35
export const STABLE_FRAMES = 4
export const STABLE_PROB = 0.45
export const MODE_FRAMES = 4
export const HISTORY_LIMIT = 40

/**
 * @param {{alpha?: number, stableFrames?: number, stableProb?: number, modeFrames?: number}} [options]
 */
export function createStabilizer(options = {}) {
  const alpha = Number.isFinite(options.alpha) ? options.alpha : EMA_ALPHA
  const stableFrames = options.stableFrames || STABLE_FRAMES
  const stableProb = options.stableProb || STABLE_PROB
  const modeFrames = options.modeFrames || MODE_FRAMES

  let ema = null
  let frames = 0
  let lastId = ''
  let streak = 0
  let stableCount = 0
  let locked = false
  let history = []

  function pickProbabilities(result) {
    if (!result) return normalizeProb({})
    if (result.probabilities) return normalizeProb(result.probabilities)
    if (result.ema) return normalizeProb(result.ema)
    if (result.dominant?.id && typeof result.dominant.prob === 'number' && Object.keys(result).some((k) => k === 'happy')) {
      return normalizeProb(result)
    }
    return normalizeProb(result.expressions || {})
  }

  function snapshot() {
    const prob = ema ? { ...ema } : null
    const dominant = prob ? dominantOf(prob) : null
    return {
      ema: prob,
      dominant,
      confidence: prob ? confidenceOf(entropyOf(prob)) : 0,
      stable: locked,
      locked,
      frames,
      stableCount,
      streak,
      history: history.map((h) => ({ ...h })),
    }
  }

  /**
   * 推入一帧识别结果
   * @param {object} result analyzeImage 返回值（或任意含 probabilities 的对象）
   * @param {number} [now] 时间戳
   */
  function push(result, now = Date.now()) {
    const prob = pickProbabilities(result)

    if (!ema) {
      ema = { ...prob }
    } else {
      const next = {}
      Object.keys(prob).forEach((k) => {
        next[k] = alpha * prob[k] + (1 - alpha) * (ema[k] || 0)
      })
      ema = normalizeProb(next)
    }

    frames += 1
    const dominant = dominantOf(ema)

    if (dominant.id === lastId) streak += 1
    else {
      lastId = dominant.id
      streak = 1
      stableCount = 0
    }

    if (dominant.prob >= stableProb) stableCount += 1
    else stableCount = 0

    locked = frames >= stableFrames && dominant.prob >= stableProb && streak >= modeFrames

    history.push({ t: now, id: dominant.id, prob: Number(dominant.prob.toFixed(4)) })
    if (history.length > HISTORY_LIMIT) history = history.slice(-HISTORY_LIMIT)

    return snapshot()
  }

  function reset() {
    ema = null
    frames = 0
    lastId = ''
    streak = 0
    stableCount = 0
    locked = false
    history = []
  }

  return { push, reset, snapshot, options: { alpha, stableFrames, stableProb, modeFrames } }
}
