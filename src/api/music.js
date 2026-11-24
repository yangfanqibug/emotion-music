/**
 * 音乐数据接口：iTunes Search API（在线）+ 本地曲库（离线降级）
 * ------------------------------------------------------------------
 * 在线：https://itunes.apple.com/search（无需 key，返回 30 秒试听链接）
 * 本地：public/songs/catalog.json（60 首 CC BY 4.0 试听曲库）
 *
 * 降级策略（README 约定）：在线接口不可用时 UI 不会白屏——在线检索抛出
 * 带 friendly 标记的中文错误并记录在线状态，播放器/推荐列表仍可使用
 * loadLocalCatalog() 返回的本地曲库继续工作。
 *
 * 纯 ESM、零第三方依赖。
 */

/** iTunes Search API 地址 */
export const ITUNES_ENDPOINT = 'https://itunes.apple.com/search'
/** 静态资源根路径：本地为 '/'，GitHub Pages 部署为 '/<repo>/' */
const BASE_URL = import.meta.env.BASE_URL
/** 本地曲库清单地址 */
export const LOCAL_CATALOG_URL = `${BASE_URL}songs/catalog.json`

/** 把曲库中写死的根绝对路径（如 /songs/x.mp3）改写到部署子路径 */
function resolveAsset(url) {
  if (!url || typeof url !== 'string') return null
  if (!url.startsWith('/') || BASE_URL === '/') return url
  return BASE_URL + url.slice(1)
}

/** 在线请求超时（8 秒） */
export const REQUEST_TIMEOUT_MS = 8000
/** 在线检索结果缓存时长（5 分钟） */
export const CACHE_TTL_MS = 300000
/** 在线来源标识 */
export const ONLINE_PROVIDER = 'itunes'

/** 7 类情绪，顺序与 core/emotions.js 的 7 维概率向量一致 */
const EMOTION_ORDER = ['happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'neutral']

/** 情绪 → 英文检索词（沿用产物中的原始映射） */
const EMOTION_QUERY = {
  happy: 'happy upbeat feel good',
  sad: 'sad melancholy',
  angry: 'angry intense rock',
  fearful: 'dark suspenseful',
  disgusted: 'weird quirky',
  surprised: 'surprise epic',
  neutral: 'calm chill ambient',
}

/** 各情绪的典型唤醒度（概率向量的加权平均用于判断是否需要能量词） */
const TYPICAL_AROUSAL = {
  happy: 0.75,
  sad: 0.25,
  angry: 0.95,
  fearful: 0.8,
  disgusted: 0.6,
  surprised: 0.85,
  neutral: 0.45,
}

/** 高唤醒时追加的能量词 */
const ENERGY_WORD_HIGH = {
  happy: 'energetic',
  sad: 'emotional',
  angry: 'intense',
  fearful: 'tense',
  disgusted: 'edgy',
  surprised: 'driving',
  neutral: 'grooving',
}

/** 低唤醒时追加的能量词 */
const ENERGY_WORD_LOW = {
  happy: 'gentle',
  sad: 'soft',
  angry: 'moody',
  fearful: 'eerie',
  disgusted: 'quirky',
  surprised: 'ambient',
  neutral: 'chill',
}

/** 在线接口可用状态（成功/失败时更新） */
let onlineStatus = {
  provider: ONLINE_PROVIDER,
  available: null,
  lastCheckedAt: null,
  lastError: null,
}

/** 在线检索缓存：key = `${term}|${limit}` → { songs, ts } */
const onlineCache = new Map()

/** 本地曲库任务缓存：同一 Promise 只发起一次请求，clearMusicCache 后失效 */
let localCatalogTask = null

/**
 * 构造带 friendly 标记的错误（UI 可直接把 message 展示给用户）
 * @param {string} message 中文提示
 * @returns {Error} 带 friendly = true 的错误对象
 */
function friendlyError(message) {
  const error = new Error(message)
  error.friendly = true
  return error
}

/** 标记在线接口可用 */
function markOnlineAvailable() {
  onlineStatus = {
    provider: ONLINE_PROVIDER,
    available: true,
    lastCheckedAt: Date.now(),
    lastError: null,
  }
}

/** 标记在线接口不可用，并记录原因 */
function markOnlineUnavailable(message) {
  onlineStatus = {
    provider: ONLINE_PROVIDER,
    available: false,
    lastCheckedAt: Date.now(),
    lastError: message || '在线接口不可用',
  }
}

/** 从候选概率中取主导情绪，并用加权唤醒度判断能量 */
function pickDominant(values) {
  const list = EMOTION_ORDER.map((id, index) => ({
    id,
    p: Math.max(0, Number(Array.isArray(values) ? values[index] : values[id]) || 0),
  }))
  const total = list.reduce((sum, item) => sum + item.p, 0)
  if (total <= 0) return null
  let best = list[0]
  for (const item of list) {
    if (item.p > best.p) best = item
  }
  const arousal = list.reduce((sum, item) => sum + (item.p / total) * TYPICAL_AROUSAL[item.id], 0)
  return { id: best.id, arousal, fromString: false }
}

/**
 * 解析情绪输入：字符串 / 7 维概率对象 / 7 维概率数组
 * @returns {{id: string, arousal: number|null, fromString: boolean}|null}
 */
function resolveEmotionInput(input) {
  // ① 字符串：直接视为情绪 id
  if (typeof input === 'string') {
    const id = input.trim().toLowerCase()
    if (!EMOTION_ORDER.includes(id)) return null
    return { id, arousal: null, fromString: true }
  }

  // ② 7 维概率数组（按 EMOTION_ORDER 顺序）
  if (Array.isArray(input)) {
    if (!input.length || !input.every((value) => typeof value === 'number')) return null
    return pickDominant(input)
  }

  if (input && typeof input === 'object') {
    // ③ 形如 { emotion: 'happy', probabilities: [...] } 的识别结果
    if (Array.isArray(input.probabilities) && input.probabilities.length) {
      const picked = pickDominant(input.probabilities)
      if (picked) {
        if (typeof input.arousal === 'number' && Number.isFinite(input.arousal)) {
          picked.arousal = input.arousal
        }
        return picked
      }
    }
    if (typeof input.emotion === 'string' && !input.probabilities) {
      const id = input.emotion.trim().toLowerCase()
      if (EMOTION_ORDER.includes(id)) return { id, arousal: null, fromString: true }
    }

    // ④ 7 维概率对象：{ happy: 0.8, sad: 0.05, ... }（也兼容包一层 scores 等）
    const source = input.emotions || input.scores || input.probabilities || input
    const hasScore = EMOTION_ORDER.some((id) => Number.isFinite(Number(source[id])))
    if (!hasScore) return null
    const picked = pickDominant(source)
    if (!picked) return null
    const arousal = Number.isFinite(Number(input.arousal)) ? Number(input.arousal) : picked.arousal
    return { ...picked, arousal }
  }

  return null
}

/**
 * 情绪输入 → 英文搜索词
 * 字符串输入直接返回固定映射；7 维概率输入取主导情绪，再根据唤醒度追加能量词。
 * @param {string|object|number[]} emotionInput 情绪 id、识别结果或 7 维概率
 * @returns {string} 英文检索词
 */
export function buildQueryForEmotion(emotionInput) {
  const picked = resolveEmotionInput(emotionInput)
  if (!picked) return EMOTION_QUERY.neutral

  const base = EMOTION_QUERY[picked.id] || EMOTION_QUERY.neutral
  if (picked.fromString || typeof picked.arousal !== 'number') return base

  if (picked.arousal >= 0.65) {
    return `${base} ${ENERGY_WORD_HIGH[picked.id] || 'energetic'}`
  }
  if (picked.arousal <= 0.3) {
    return `${base} ${ENERGY_WORD_LOW[picked.id] || 'soft'}`
  }
  return base
}

/**
 * 带 8 秒超时的 JSON 请求（在线接口专用）
 * @param {string} url 请求地址
 * @param {AbortSignal} [signal] 外部取消信号
 * @returns {Promise<any>} 解析后的 JSON
 */
async function fetchJson(url, signal) {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, REQUEST_TIMEOUT_MS)
  const onAbort = () => controller.abort()

  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) throw friendlyError(`在线接口返回异常状态（HTTP ${response.status}）`)

    const text = await response.text()
    try {
      return JSON.parse(text)
    } catch {
      throw friendlyError('在线接口返回的数据无法解析为 JSON')
    }
  } catch (error) {
    if (error?.friendly) throw error
    if (timedOut) throw friendlyError(`在线歌曲接口请求超时（${REQUEST_TIMEOUT_MS / 1000} 秒）`)
    if (signal?.aborted) throw friendlyError('在线歌曲请求已取消')
    throw friendlyError(`无法连接在线歌曲接口：${error?.message || '网络异常'}`)
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

/** 把 iTunes 原始曲目归一化为应用内歌曲对象 */
function normalizeItunesTrack(track) {
  const title = track.trackName || '未知曲目'
  const artist = track.artistName || '未知艺人'
  return {
    id: `itunes-${track.trackId || `${slugify(title)}-${slugify(artist)}`}`,
    title,
    artist,
    album: track.collectionName || '',
    artwork: track.artworkUrl100 || track.artworkUrl60 || track.artworkUrl30 || null,
    previewUrl: track.previewUrl || null,
    audioUrl: null,
    durationMs: Number(track.trackTimeMillis) || 0,
    genre: track.primaryGenreName || '',
    bpm: null,
    source: ONLINE_PROVIDER,
    license: null,
    playCount: 0,
    rating: 0,
  }
}

/** 生成 id 用的短 slug */
function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

/**
 * 在线检索（iTunes Search API）
 * @param {string} query 英文检索词
 * @param {{limit?: number, signal?: AbortSignal}} [options] 限量（1–200，默认 20）与取消信号
 * @returns {Promise<Array>} 归一化后的歌曲数组
 */
export async function searchItunes(query, options = {}) {
  const term = (
    typeof query === 'string' ? query : String(query?.term ?? query?.query ?? '')
  ).trim()
  if (!term) throw friendlyError('检索关键词不能为空')

  const limit = Math.max(1, Math.min(200, Number(options.limit) || 20))
  const cacheKey = `${term}|${limit}`
  const cached = onlineCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.songs.slice()

  const url =
    `${ITUNES_ENDPOINT}?term=${encodeURIComponent(term)}` +
    `&media=music&entity=song&limit=${limit}`

  try {
    const data = await fetchJson(url, options.signal)
    const results = Array.isArray(data?.results) ? data.results : []
    const songs = results.map(normalizeItunesTrack)
    onlineCache.set(cacheKey, { songs, ts: Date.now() })
    markOnlineAvailable()
    return songs.slice()
  } catch (error) {
    markOnlineUnavailable(error?.message)
    throw error
  }
}

/**
 * 按情绪检索在线歌曲（情绪 → 检索词 → iTunes）
 * @param {string|object|number[]} emotionInput 情绪 id / 识别结果 / 7 维概率
 * @param {{term?: string, limit?: number, signal?: AbortSignal}} [options] 可覆盖检索词
 * @returns {Promise<{songs: Array, provider: string}>}
 */
export async function searchOnline(emotionInput, options = {}) {
  const term = String(options.term || options.query || '').trim() || buildQueryForEmotion(emotionInput)
  try {
    const songs = await searchItunes(term, {
      limit: options.limit,
      signal: options.signal,
    })
    return { songs, provider: ONLINE_PROVIDER }
  } catch (error) {
    markOnlineUnavailable(error?.message)
    throw error?.friendly ? error : friendlyError(`在线歌曲检索失败：${error?.message || '未知错误'}`)
  }
}

/** 把本地曲库记录归一化为应用内歌曲对象 */
function normalizeLocalSong(item) {
  const feel = Array.isArray(item.feel)
    ? item.feel.slice()
    : item.feel
      ? String(item.feel)
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      : []

  return {
    id: item.id || `local-${slugify(item.title)}`,
    title: item.title || '未知曲目',
    artist: item.artist || 'Kevin MacLeod',
    album: item.album || '',
    genre: item.genre || '',
    artwork: resolveAsset(item.artwork),
    previewUrl: item.previewUrl || null,
    audioUrl: resolveAsset(item.audioUrl),
    durationMs: Number(item.durationMs) || 0,
    bpm: item.bpm ?? null,
    feel,
    source: item.source || 'local',
    license: item.license || null,
    licenseUrl: item.licenseUrl || null,
    playCount: item.playCount ?? 0,
    rating: item.rating ?? 0,
  }
}

/** 实际拉取本地曲库（仅由 loadLocalCatalog 调用一次） */
async function fetchLocalCatalog(url) {
  let response
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' } })
  } catch (error) {
    throw friendlyError(`无法读取本地曲库：${error?.message || '网络异常'}`)
  }
  if (!response.ok) throw friendlyError(`本地曲库加载失败（HTTP ${response.status}）`)

  let raw
  try {
    raw = await response.json()
  } catch {
    throw friendlyError('本地曲库文件不是合法的 JSON')
  }
  if (!Array.isArray(raw)) throw friendlyError('本地曲库文件结构异常（应为数组）')

  return raw.map(normalizeLocalSong)
}

/**
 * 加载本地曲库（60 首 CC BY 4.0 试听曲）
 * 结果 Promise 会被缓存：重复调用不会重复请求；失败后自动清空缓存以便重试。
 * @param {{url?: string}} [options] 可覆盖曲库地址
 * @returns {Promise<Array>} 应用内歌曲数组（副本，避免调用方改动缓存）
 */
export function loadLocalCatalog(options = {}) {
  if (!localCatalogTask) {
    const url = options.url || LOCAL_CATALOG_URL
    localCatalogTask = fetchLocalCatalog(url).catch((error) => {
      localCatalogTask = null
      throw error?.friendly ? error : friendlyError(`本地曲库加载失败：${error?.message || '未知错误'}`)
    })
  }
  return localCatalogTask.then((songs) => songs.slice())
}

/** 获取在线接口状态 */
export function getOnlineStatus() {
  return { ...onlineStatus }
}

/** 清空在线检索缓存与本地曲库缓存 */
export function clearMusicCache() {
  onlineCache.clear()
  localCatalogTask = null
}

/**
 * 毫秒时长 → "m:ss"
 * @param {number} ms 毫秒
 * @returns {string} 例：176000 → "2:56"
 */
export function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round((Number(ms) || 0) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
