/**
 * 人脸情绪识别引擎
 * ==================================================================
 * 基于 face-api.js（内置 TensorFlow.js）在浏览器本地完成：
 *   1. TinyFaceDetector 三级级联人脸检测（416 → 320 → 整幅兜底）
 *   2. FaceExpressionNet 输出 7 类表情 softmax 概率
 * 模型权重来自 public/models，图片不出浏览器。
 */

import * as faceapi from '@vladmandic/face-api'
import { dominantOf, normalizeProb, toObject } from '../core/emotions.js'

// BASE_URL：本地为 '/'，GitHub Pages 部署为 '/<repo>/'
export const MODEL_URL = `${import.meta.env.BASE_URL}models`

/** 最长边缩放上限 */
const MAX_SIDE = 640
/** 主脸裁剪缩略图边长 */
const THUMB_SIZE = 96

const state = {
  ready: false,
  backend: '',
  error: '',
  loadMs: 0,
  loading: null,
}

/* ------------------------------------------------------------------
 * 模型加载
 * ------------------------------------------------------------------ */

async function initBackend() {
  const tf = faceapi.tf
  if (!tf) return 'cpu'
  try {
    if (typeof document !== 'undefined' && tf.findBackend && tf.findBackend('webgl')) {
      await tf.setBackend('webgl')
      await tf.ready()
      return tf.getBackend()
    }
  } catch {
    // WebGL 不可用时回退 CPU
  }
  try {
    await tf.setBackend('cpu')
    await tf.ready()
    return tf.getBackend()
  } catch {
    return tf.getBackend ? tf.getBackend() : 'cpu'
  }
}

/**
 * 加载检测与表情模型（幂等）
 * @returns {Promise<{backend: string, loadMs: number}>}
 */
export function loadModels() {
  if (state.ready) return Promise.resolve({ backend: state.backend, loadMs: state.loadMs })
  if (state.loading) return state.loading

  state.loading = (async () => {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
    await initBackend()
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
    ])
    state.backend = (faceapi.tf?.getBackend && faceapi.tf.getBackend()) || 'cpu'
    state.loadMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0)
    state.ready = true
    state.error = ''
    return { backend: state.backend, loadMs: state.loadMs }
  })()

  state.loading = state.loading.catch((err) => {
    state.error = err?.message || '模型加载失败'
    state.loading = null
    throw new Error(`本地情绪模型加载失败：${state.error}`)
  })

  return state.loading
}

export function isReady() {
  return state.ready
}

export function getEngineInfo() {
  return { ready: state.ready, backend: state.backend, error: state.error, loadMs: state.loadMs }
}

export function dispose() {
  state.ready = false
  state.loading = null
}

/* ------------------------------------------------------------------
 * 工具
 * ------------------------------------------------------------------ */

function assertReady() {
  if (!state.ready) throw new Error('识别模型尚未加载完成，请稍候再试')
}

function inputSize(el) {
  if (!el) return { width: 0, height: 0 }
  if (el instanceof HTMLVideoElement) return { width: el.videoWidth, height: el.videoHeight }
  if (el instanceof HTMLImageElement) return { width: el.naturalWidth, height: el.naturalHeight }
  return { width: el.width, height: el.height }
}

/** 把输入绘制到缩放后的 canvas（长边 ≤ 640） */
function drawToCanvas(el) {
  const { width, height } = inputSize(el)
  if (!width || !height) throw new Error('输入画面尚未就绪，请稍后再试')
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  canvas.getContext('2d').drawImage(el, 0, 0, canvas.width, canvas.height)
  return { canvas, scale }
}

/** 从源画布裁剪主脸缩略图 */
function cropThumb(source, box, scale = 1) {
  try {
    const w = box.width / scale
    const h = box.height / scale
    const pad = Math.max(w, h) * 0.18
    const sx = Math.max(0, box.x / scale - pad)
    const sy = Math.max(0, box.y / scale - pad)
    const sw = Math.min(source.width - sx, w + pad * 2)
    const sh = Math.min(source.height - sy, h + pad * 2)
    if (sw <= 0 || sh <= 0) return null
    const out = document.createElement('canvas')
    out.width = THUMB_SIZE
    out.height = THUMB_SIZE
    out.getContext('2d').drawImage(source, sx, sy, sw, sh, 0, 0, THUMB_SIZE, THUMB_SIZE)
    return out.toDataURL('image/jpeg', 0.82)
  } catch {
    return null
  }
}

/** FaceExpressions → 普通对象 */
function expressionsToObject(expressions) {
  if (!expressions) return normalizeProb({})
  if (typeof expressions.asObject === 'function') return expressions.asObject()
  const out = {}
  Object.keys(expressions).forEach((k) => {
    if (typeof expressions[k] === 'number') out[k] = expressions[k]
  })
  return out
}

function buildFace(detection, rawCanvas, scale) {
  const expressions = expressionsToObject(detection.expressions)
  const box = detection.detection?.box || detection.box
  const score = detection.detection?.score ?? detection.score ?? 0
  const probabilities = normalizeProb(expressions)
  const dominant = dominantOf(probabilities)
  return {
    box: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null,
    score: Number(score) || 0,
    expressions: toObject(probabilities),
    dominant,
    thumbnail: box ? cropThumb(rawCanvas, box, scale) : null,
  }
}

/** 整幅画面兜底：把画面缩放到 224 后直接送入表情网络 */
async function fallbackExpressions(canvas) {
  const tf = faceapi.tf
  if (!tf || !faceapi.nets.faceExpressionNet.isLoaded) return null
  const input = tf.browser.fromPixels(canvas)
  const resized = tf.image.resizeBilinear(input, [224, 224])
  const batched = resized.expandDims(0).toFloat()
  try {
    const result = await faceapi.nets.faceExpressionNet.predictExpressions(batched)
    const expressions = Array.isArray(result) ? result[0] : result
    return expressionsToObject(expressions)
  } finally {
    input.dispose()
    resized.dispose()
    batched.dispose()
  }
}

/* ------------------------------------------------------------------
 * 主流程
 * ------------------------------------------------------------------ */

/**
 * 分析一帧画面
 * @param {HTMLImageElement|HTMLVideoElement|HTMLCanvasElement} el
 * @returns {Promise<object>} 识别结果
 */
export async function analyzeImage(el) {
  assertReady()
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const { canvas, scale } = drawToCanvas(el)

  const attempts = [
    { inputSize: 416, scoreThreshold: 0.35 },
    { inputSize: 320, scoreThreshold: 0.15 },
  ]

  let faces = []
  for (const opts of attempts) {
    const detections = await faceapi
      .detectAllFaces(canvas, new faceapi.TinyFaceDetectorOptions(opts))
      .withFaceExpressions()
    if (detections?.length) {
      faces = detections
        .map((d) => buildFace(d, canvas, scale))
        .sort((a, b) => (b.box?.width || 0) * (b.box?.height || 0) - (a.box?.width || 0) * (a.box?.height || 0))
      break
    }
  }

  let fallback = false
  let note = ''
  if (!faces.length) {
    fallback = true
    let expressions = null
    try {
      expressions = await fallbackExpressions(canvas)
    } catch {
      expressions = null
    }
    if (!expressions) {
      throw new Error('没有检测到人脸，请换一张更清晰、正脸的照片')
    }
    const probabilities = normalizeProb(expressions)
    faces = [{
      box: { x: 0, y: 0, width: canvas.width, height: canvas.height },
      score: 0,
      expressions: toObject(probabilities),
      dominant: dominantOf(probabilities),
      thumbnail: canvas.toDataURL('image/jpeg', 0.82),
    }]
    note = '未检测到清晰人脸，已对整幅画面兜底推理，结果仅供参考。'
  }

  const primary = faces[0]
  const probabilities = toObject(primary.expressions)
  const timingMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0)

  return {
    faces,
    primary,
    probabilities,
    dominant: primary.dominant,
    count: faces.length,
    timingMs,
    fallback,
    note: note || (faces.length > 1 ? `检测到 ${faces.length} 张人脸，取面积最大者为主脸。` : ''),
    thumbnail: primary.thumbnail,
    size: { width: canvas.width, height: canvas.height },
  }
}
