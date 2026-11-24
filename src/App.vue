<script setup>
/**
 * 主组件：状态编排
 * ------------------------------------------------------------------
 * 采集（上传 / 视频 / 摄像头 / 拍照）→ 本地人脸情绪识别 → 情绪稳定判定
 * → 五因子推荐（本地曲库 + 在线曲库）→ 播放。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import CapturePanel from './components/CapturePanel.vue'
import DemoGallery from './components/DemoGallery.vue'
import EmotionPanel from './components/EmotionPanel.vue'
import RecommendPanel from './components/RecommendPanel.vue'
import PlayerBar from './components/PlayerBar.vue'
import AlgorithmModal from './components/AlgorithmModal.vue'

import { analyzeImage, createStabilizer, getEngineInfo, loadModels } from './emotion/index.js'
import { getOnlineStatus, loadLocalCatalog, searchOnline } from './api/index.js'
import { recommend } from './recommend/index.js'
import { confidenceOf, dominantOf, normalizeProb, toObject } from './core/emotions.js'

/* ---------------- 引擎状态 ---------------- */
const engine = reactive({ loading: true, ready: false, backend: '', error: '', loadMs: 0 })
const busy = ref(false)
const toast = ref('')
let toastTimer = 0

/* ---------------- 识别结果 ---------------- */
const result = ref(null)          // analyzeImage 的返回值
const snapshot = ref(null)        // 稳定器快照
const sourceLabel = ref('')
const stabilizer = createStabilizer()

/* ---------------- 推荐 ---------------- */
const items = ref([])
const recLoading = ref(false)
const strategy = ref('balanced')
const weights = ref({})
const localSongs = ref([])
const localError = ref('')
const onlineStatus = ref(getOnlineStatus())

/* ---------------- 播放 ---------------- */
const current = ref(null)
const isPlaying = ref(false)
const progress = ref(0)
const duration = ref(0)
const volume = ref(0.8)
const muted = ref(false)
const audioEl = ref(null)
const playedIds = ref([])

/* ---------------- 弹窗 ---------------- */
const showAlgo = ref(false)

/* ---------------- 派生 ---------------- */
const probabilities = computed(() => {
  const snap = snapshot.value
  if (snap?.ema) return normalizeProb(snap.ema)
  return result.value?.probabilities ? normalizeProb(result.value.probabilities) : null
})
const dominant = computed(() => (probabilities.value ? dominantOf(probabilities.value) : null))
const confidence = computed(() => (probabilities.value ? confidenceOf(probabilities.value) : 0))

const engineChip = computed(() => {
  if (engine.loading) return { cls: 'warn', text: '本地模型加载中…' }
  if (engine.error) return { cls: 'bad', text: '模型加载失败' }
  if (engine.ready) return { cls: 'ok', text: `识别引擎就绪 · ${engine.backend || 'CPU'}` }
  return { cls: '', text: '识别引擎未初始化' }
})
const onlineChip = computed(() => {
  const s = onlineStatus.value || {}
  if (s.available === true) return { cls: 'ok', text: '在线曲库已连接' }
  if (s.available === false) return { cls: 'warn', text: '在线曲库不可用 · 仅本地' }
  return { cls: '', text: '在线曲库待检测' }
})

function showToast(msg) {
  toast.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = '' }, 3200)
}

/* ---------------- 初始化 ---------------- */
onMounted(async () => {
  hideBootOverlay()
  try {
    const info = await loadModels()
    engine.backend = info?.backend || getEngineInfo().backend || ''
    engine.loadMs = info?.loadMs || 0
    engine.ready = true
  } catch (err) {
    engine.error = err?.message || '本地模型加载失败'
    showToast(`模型加载失败：${engine.error}`)
  } finally {
    engine.loading = false
  }

  try {
    localSongs.value = await loadLocalCatalog()
  } catch (err) {
    localError.value = err?.message || '本地曲库加载失败'
  }
  onlineStatus.value = getOnlineStatus()
})

onBeforeUnmount(() => {
  clearTimeout(toastTimer)
  if (audioEl.value) audioEl.value.pause()
})

function hideBootOverlay() {
  const boot = document.getElementById('boot')
  if (!boot) return
  boot.style.opacity = '0'
  setTimeout(() => boot.remove(), 420)
}

/* ---------------- 识别流程 ---------------- */
async function handleAnalyze({ el, label }) {
  if (!engine.ready) {
    showToast('识别模型尚未就绪，请稍候')
    return
  }
  if (!el) return
  busy.value = true
  sourceLabel.value = label || ''
  try {
    const res = await analyzeImage(el)
    result.value = res
    const snap = stabilizer.push(res)
    snapshot.value = snap
    const prob = snap?.ema || res.probabilities
    await buildRecommendations(prob)
  } catch (err) {
    showToast(err?.message || '识别失败，请换一张更清晰的照片')
  } finally {
    busy.value = false
  }
}

async function buildRecommendations(probInput) {
  const prob = toObject(probInput || {})
  if (!prob || !Object.values(prob).some((v) => v > 0)) return
  recLoading.value = true
  try {
    let pool = [...localSongs.value]
    try {
      const online = await searchOnline(prob, { limit: 12 })
      pool = pool.concat(online?.songs || [])
    } catch (err) {
      // 在线失败不影响本地推荐
      onlineStatus.value = getOnlineStatus()
    }
    onlineStatus.value = getOnlineStatus()
    const out = recommend(prob, pool, { limit: 12, playedIds: playedIds.value })
    strategy.value = out.strategy
    weights.value = out.weights || {}
    items.value = out.items || []
  } catch (err) {
    showToast(err?.message || '推荐生成失败')
  } finally {
    recLoading.value = false
  }
}

function resetRecognition() {
  result.value = null
  snapshot.value = null
  sourceLabel.value = ''
  stabilizer.reset()
  items.value = []
}

function handleDemoPick(face) {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => handleAnalyze({ el: img, label: `演示人脸 · ${face.note || face.id}` })
  img.onerror = () => showToast('演示图片加载失败')
  img.src = face.file
}

/* ---------------- 播放 ---------------- */
function playItem(item) {
  const song = item?.song || item
  if (!song) return
  const src = song.audioUrl || song.previewUrl
  if (!src) {
    showToast('该曲目没有可播放的音频地址')
    return
  }
  if (current.value?.song?.id === song.id) {
    togglePlay()
    return
  }
  current.value = item?.song ? item : { song, reason: '', score: 0, factors: {} }
  progress.value = 0
  duration.value = song.durationMs || 0
  if (song.id) {
    playedIds.value = [song.id, ...playedIds.value.filter((id) => id !== song.id)].slice(0, 30)
  }
}

watch(current, async (val) => {
  const audio = audioEl.value
  if (!audio || !val?.song) return
  audio.src = val.song.audioUrl || val.song.previewUrl
  audio.volume = muted.value ? 0 : volume.value
  try {
    await audio.play()
    isPlaying.value = true
  } catch {
    isPlaying.value = false
  }
})

function togglePlay() {
  const audio = audioEl.value
  if (!audio || !current.value) return
  if (audio.paused) {
    audio.play().then(() => { isPlaying.value = true }).catch(() => showToast('浏览器阻止了自动播放，请再次点击播放'))
  } else {
    audio.pause()
    isPlaying.value = false
  }
}

function seekTo(ratio) {
  const audio = audioEl.value
  if (!audio || !Number.isFinite(audio.duration)) return
  audio.currentTime = Math.max(0, Math.min(1, ratio)) * audio.duration
}

function setVolume(v) {
  volume.value = v
  muted.value = v === 0
  if (audioEl.value) audioEl.value.volume = v
}

function toggleMute() {
  muted.value = !muted.value
  if (audioEl.value) audioEl.value.volume = muted.value ? 0 : volume.value
}

function playStep(dir) {
  const list = items.value
  if (!list.length) return
  const idx = list.findIndex((it) => it.song?.id === current.value?.song?.id)
  const next = idx === -1 ? 0 : (idx + dir + list.length) % list.length
  playItem(list[next])
}

function onAudioMeta() {
  const audio = audioEl.value
  if (!audio) return
  duration.value = Number.isFinite(audio.duration) ? audio.duration * 1000 : current.value?.song?.durationMs || 0
}
function onAudioTime() {
  const audio = audioEl.value
  if (!audio) return
  progress.value = audio.currentTime * 1000
}
function onAudioEnded() {
  isPlaying.value = false
  playStep(1)
}
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">🎭</div>
        <div class="brand-text">
          <div class="brand-title">情绪音乐推荐系统</div>
          <div class="brand-sub">本地人脸表情识别 · 情绪画像 · 五因子推荐</div>
        </div>
      </div>
      <div class="topbar-spacer"></div>
      <div class="status-group">
        <span class="chip" :class="engineChip.cls"><span class="dot"></span>{{ engineChip.text }}</span>
        <span class="chip" :class="onlineChip.cls"><span class="dot"></span>{{ onlineChip.text }}</span>
        <button class="btn btn-sm" type="button" @click="showAlgo = true">算法说明</button>
      </div>
    </header>

    <div class="layout">
      <div class="col">
        <CapturePanel
          :busy="busy"
          :engine-ready="engine.ready"
          :engine-error="engine.error"
          @analyze="handleAnalyze"
          @error="showToast"
          @reset="resetRecognition"
        />
        <DemoGallery @pick="handleDemoPick" />
      </div>

      <div class="col">
        <EmotionPanel
          :result="result"
          :snapshot="snapshot"
          :busy="busy"
          :source-label="sourceLabel"
          :engine-ready="engine.ready"
        />
        <RecommendPanel
          :items="items"
          :loading="recLoading"
          :strategy="strategy"
          :weights="weights"
          :dominant="dominant"
          :confidence="confidence"
          :local-count="localSongs.length"
          :online-available="onlineStatus.available"
          :local-error="localError"
          :playing-id="current?.song?.id || ''"
          :is-playing="isPlaying"
          @play="playItem"
        />
      </div>
    </div>

    <PlayerBar
      :song="current?.song || null"
      :is-playing="isPlaying"
      :progress="progress"
      :duration="duration"
      :volume="volume"
      :muted="muted"
      :has-prev="items.length > 1"
      :has-next="items.length > 1"
      @toggle="togglePlay"
      @seek="seekTo"
      @volume="setVolume"
      @mute="toggleMute"
      @prev="playStep(-1)"
      @next="playStep(1)"
    />

    <audio
      ref="audioEl"
      preload="metadata"
      @timeupdate="onAudioTime"
      @loadedmetadata="onAudioMeta"
      @durationchange="onAudioMeta"
      @ended="onAudioEnded"
      @play="isPlaying = true"
      @pause="isPlaying = false"
    ></audio>

    <AlgorithmModal :open="showAlgo" @close="showAlgo = false" />
    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>
