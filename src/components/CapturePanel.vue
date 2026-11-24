<script setup>
/**
 * 人脸采集面板
 * ------------------------------------------------------------------
 * 支持四种方式：上传图片 / 打开视频 / 实时摄像头 / 拍照定格。
 * 通过 analyze 事件把可绘制的元素（Image / Video / Canvas）交给上层识别。
 */
import { computed, onBeforeUnmount, ref } from 'vue'

const props = defineProps({
  busy: { type: Boolean, default: false },
  engineReady: { type: Boolean, default: false },
  engineError: { type: String, default: '' },
})
const emit = defineEmits(['analyze', 'error', 'reset'])

const mode = ref('upload')
const TABS = [
  { id: 'upload', label: '上传图片', icon: '📁' },
  { id: 'video', label: '打开视频', icon: '🎬' },
  { id: 'camera', label: '实时摄像头', icon: '📷' },
]

const imageInput = ref(null)
const videoInput = ref(null)
const videoEl = ref(null)
const camEl = ref(null)

const previewUrl = ref('')
const previewName = ref('')
const dragging = ref(false)

const videoLoaded = ref(false)
const videoPlaying = ref(false)
const camActive = ref(false)
const camError = ref('')
const frozenUrl = ref('')
let camStream = null
let videoTimer = 0
let camTimer = 0
let objectUrls = []

const note = computed(() => {
  if (mode.value === 'upload') return '建议使用光线均匀、正脸清晰的照片；图片只在本地浏览器内处理，不会上传服务器。'
  if (mode.value === 'video') return '视频播放时每 350 ms 抽一帧分析；情绪连续稳定后会自动锁定并生成推荐。'
  if (mode.value === 'camera') return '摄像头画面每 250 ms 分析一次；点击「拍照分析」可定格当前画面。需要 localhost 或 HTTPS 环境。'
  return ''
})

function fail(msg) { emit('error', msg) }

function revokeAll() {
  objectUrls.forEach((u) => URL.revokeObjectURL(u))
  objectUrls = []
}
function makeUrl(blob) {
  const url = URL.createObjectURL(blob)
  objectUrls.push(url)
  return url
}

/* ---------------- 上传图片 ---------------- */
function pickImage() { imageInput.value?.click() }

function onImageChange(e) {
  const file = e.target.files?.[0]
  if (file) loadImageFile(file)
  e.target.value = ''
}

function loadImageFile(file) {
  if (!file.type.startsWith('image/')) return fail('请选择图片文件')
  revokeForPreview()
  previewUrl.value = makeUrl(file)
  previewName.value = file.name
  const img = new Image()
  img.onload = () => emit('analyze', { el: img, label: `上传图片 · ${file.name}` })
  img.onerror = () => fail('图片解码失败，请换一张试试')
  img.src = previewUrl.value
}

function revokeForPreview() {
  if (previewUrl.value?.startsWith('blob:')) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = ''
}

function onDrop(e) {
  dragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) {
    mode.value = 'upload'
    loadImageFile(file)
  }
}

/* ---------------- 视频 ---------------- */
function pickVideo() { videoInput.value?.click() }

function onVideoChange(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  if (!file.type.startsWith('video/')) return fail('请选择视频文件')
  stopTimers()
  const url = makeUrl(file)
  const v = videoEl.value
  if (!v) return
  v.src = url
  v.loop = true
  v.muted = true
  videoLoaded.value = true
  v.play().then(() => {
    videoPlaying.value = true
    startVideoTimer()
  }).catch(() => fail('视频自动播放失败，请手动点击播放'))
}

function startVideoTimer() {
  clearInterval(videoTimer)
  videoTimer = setInterval(() => {
    if (mode.value !== 'video' || !videoPlaying.value || props.busy) return
    if (videoEl.value && videoEl.value.readyState >= 2) {
      emit('analyze', { el: videoEl.value, label: '视频抽帧' })
    }
  }, 350)
}

function onVideoPlay() {
  videoPlaying.value = true
  startVideoTimer()
}
function onVideoPause() {
  videoPlaying.value = false
  clearInterval(videoTimer)
}

/* ---------------- 摄像头 ---------------- */
async function startCamera() {
  camError.value = ''
  if (!navigator.mediaDevices?.getUserMedia) {
    camError.value = '当前浏览器不支持摄像头取流'
    return
  }
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false })
    const v = camEl.value
    if (!v) return
    v.srcObject = camStream
    v.muted = true
    await v.play()
    camActive.value = true
    clearInterval(camTimer)
    camTimer = setInterval(() => {
      if (mode.value !== 'camera' || !camActive.value || props.busy) return
      if (camEl.value && camEl.value.readyState >= 2) {
        emit('analyze', { el: camEl.value, label: '摄像头实时' })
      }
    }, 250)
  } catch (err) {
    camError.value = err?.name === 'NotAllowedError' ? '摄像头权限被拒绝，请在浏览器地址栏允许后重试' : (err?.message || '摄像头启动失败')
    camActive.value = false
  }
}

function stopCamera() {
  clearInterval(camTimer)
  camTimer = 0
  if (camStream) {
    camStream.getTracks().forEach((t) => t.stop())
    camStream = null
  }
  camActive.value = false
  if (camEl.value) camEl.value.srcObject = null
}

function capture() {
  const v = camEl.value
  if (!v || !camActive.value) return
  const canvas = document.createElement('canvas')
  canvas.width = v.videoWidth || 640
  canvas.height = v.videoHeight || 480
  canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height)
  frozenUrl.value = canvas.toDataURL('image/jpeg', 0.85)
  emit('analyze', { el: canvas, label: '摄像头拍照' })
}

/* ---------------- 切换与清理 ---------------- */
function switchMode(id) {
  if (mode.value === id) return
  if (mode.value === 'camera') stopCamera()
  if (mode.value === 'video') {
    clearInterval(videoTimer)
    videoEl.value?.pause()
  }
  mode.value = id
  if (id === 'camera') startCamera()
}

function stopTimers() {
  clearInterval(videoTimer)
  clearInterval(camTimer)
  videoTimer = 0
  camTimer = 0
}

function resetAll() {
  stopTimers()
  stopCamera()
  revokeAll()
  revokeForPreview()
  previewName.value = ''
  frozenUrl.value = ''
  camError.value = ''
  videoLoaded.value = false
  videoPlaying.value = false
  if (videoEl.value) {
    videoEl.value.removeAttribute('src')
    videoEl.value.load?.()
  }
  emit('reset')
}

onBeforeUnmount(() => {
  stopTimers()
  stopCamera()
  revokeAll()
})
</script>

<template>
  <section class="panel">
    <header class="panel-head">
      <h2 class="panel-title"><span class="emoji">🧭</span>人脸采集</h2>
      <div class="panel-head-spacer"></div>
      <div class="tabs">
        <button
          v-for="t in TABS"
          :key="t.id"
          class="tab"
          :class="{ active: mode === t.id }"
          type="button"
          @click="switchMode(t.id)"
        >{{ t.label }}</button>
      </div>
    </header>

    <div class="panel-body">
      <div v-if="engineError" class="alert">{{ engineError }}</div>

      <!-- 上传图片 -->
      <div v-show="mode === 'upload'">
        <div
          class="dropzone"
          :class="{ dragging, busy }"
          @dragover.prevent="dragging = true"
          @dragleave.prevent="dragging = false"
          @drop.prevent="onDrop"
          @click="pickImage"
        >
          <template v-if="previewUrl">
            <img class="preview" :src="previewUrl" alt="待识别图片" />
            <span v-if="busy" class="busy-mask">识别中…</span>
          </template>
          <template v-else>
            <div class="dz-icon">🖼️</div>
            <div class="dz-title">点击选择一张人脸照片</div>
            <div class="dz-sub">也可以把图片拖到这里 · 全程在浏览器本地推理，图片不会上传</div>
          </template>
        </div>
        <div class="row-between">
          <span class="hint">{{ previewName || '支持 JPG / PNG / WebP' }}</span>
          <span class="row-actions">
            <button class="btn btn-sm" type="button" @click="pickImage">选择图片</button>
            <button v-if="previewUrl" class="btn btn-sm btn-ghost" type="button" @click="resetAll">清空</button>
          </span>
        </div>
      </div>

      <!-- 视频 -->
      <div v-show="mode === 'video'">
        <div class="stage">
          <video
            ref="videoEl"
            class="media"
            playsinline
            controls
            @play="onVideoPlay"
            @pause="onVideoPause"
          ></video>
          <div v-if="!videoLoaded" class="stage-empty">
            <div class="dz-icon">🎬</div>
            <div class="dz-title">选择一段人脸视频</div>
            <div class="dz-sub">边播放边抽帧分析，无需等待整段处理</div>
          </div>
        </div>
        <div class="row-between">
          <span class="hint">{{ videoPlaying ? '正在按 350 ms 间隔抽帧…' : '选择视频后会自动播放并开始分析' }}</span>
          <span class="row-actions">
            <button class="btn btn-sm" type="button" @click="pickVideo">选择视频</button>
          </span>
        </div>
      </div>

      <!-- 摄像头 -->
      <div v-show="mode === 'camera'">
        <div class="stage">
          <video ref="camEl" class="media" playsinline muted></video>
          <div v-if="!camActive" class="stage-empty">
            <div class="dz-icon">📷</div>
            <div class="dz-title">{{ camError || '开启摄像头后即可实时识别' }}</div>
            <div class="dz-sub">首次使用需要浏览器授权摄像头权限</div>
          </div>
          <span v-if="camActive" class="live-tag"><span class="live-dot"></span>LIVE</span>
        </div>
        <div class="row-between">
          <span class="hint">{{ camActive ? '实时分析中（每 250 ms 一帧）' : '摄像头未开启' }}</span>
          <span class="row-actions">
            <button v-if="!camActive" class="btn btn-sm" type="button" @click="startCamera">开启摄像头</button>
            <button v-else class="btn btn-sm" type="button" @click="stopCamera">关闭摄像头</button>
            <button class="btn btn-sm btn-primary" type="button" :disabled="!camActive || busy" @click="capture">📸 拍照分析</button>
          </span>
        </div>
        <img v-if="frozenUrl" class="frozen" :src="frozenUrl" alt="拍照定格" />
      </div>

      <p class="hint-line note">{{ note }}</p>

      <input ref="imageInput" type="file" accept="image/*" hidden @change="onImageChange" />
      <input ref="videoInput" type="file" accept="video/*" hidden @change="onVideoChange" />
    </div>
  </section>
</template>

<style scoped>
.alert {
  margin-bottom: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--danger-soft);
  color: #a52727;
  font-size: 12.5px;
}

.dropzone {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 208px;
  padding: 16px;
  border: 1.5px dashed var(--line-strong);
  border-radius: var(--r-md);
  background: var(--surface-2);
  text-align: center;
  cursor: pointer;
  overflow: hidden;
}
.dropzone:hover,
.dropzone.dragging { border-color: var(--brand); background: var(--brand-soft); }
.dropzone.busy { cursor: progress; }
.dz-icon { font-size: 34px; }
.dz-title { font-size: 13.5px; font-weight: 600; }
.dz-sub { max-width: 300px; font-size: 12px; color: var(--text-3); }

.preview { max-width: 100%; max-height: 260px; border-radius: 10px; display: block; }
.busy-mask {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.66);
  color: var(--brand-dark);
  font-size: 13px;
  font-weight: 600;
}

.row-between {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 10px;
  flex-wrap: wrap;
}
.row-actions { display: inline-flex; gap: 8px; }

.stage {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 208px;
  border-radius: var(--r-md);
  border: 1px solid var(--line);
  background: #0f1522;
  overflow: hidden;
}
.stage .media { width: 100%; max-height: 300px; display: block; }
.stage-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #b9c2d2;
  text-align: center;
  padding: 16px;
  background: #0f1522;
}
.stage-empty .dz-title { color: #e9edf5; font-size: 13.5px; }
.stage-empty .dz-sub { color: #8a96a9; }

.live-tag {
  position: absolute;
  top: 8px;
  left: 8px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(217, 58, 58, 0.92);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
}
.live-dot { width: 6px; height: 6px; border-radius: 50%; background: #fff; }

.frozen { margin-top: 10px; width: 96px; height: 96px; object-fit: cover; border-radius: 8px; border: 1px solid var(--line); }
.note { margin-top: 12px; line-height: 1.5; }
</style>
