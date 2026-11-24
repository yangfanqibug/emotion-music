<script setup>
/**
 * 情绪识别结果面板
 * ------------------------------------------------------------------
 * 主情绪卡 + 7 类 softmax 概率条 + 效价-唤醒度平面 + EMA 趋势。
 */
import { computed } from 'vue'
import {
  EMOTIONS,
  confidenceOf,
  dominantOf,
  getEmotion,
  normalizeProb,
  valenceArousalOf,
} from '../core/emotions.js'

const props = defineProps({
  result: { type: Object, default: null },
  snapshot: { type: Object, default: null },
  busy: { type: Boolean, default: false },
  sourceLabel: { type: String, default: '' },
  engineReady: { type: Boolean, default: false },
})

const prob = computed(() => {
  if (props.snapshot?.ema) return normalizeProb(props.snapshot.ema)
  if (props.result?.probabilities) return normalizeProb(props.result.probabilities)
  return null
})
const dom = computed(() => (prob.value ? dominantOf(prob.value) : null))
const conf = computed(() => (prob.value ? confidenceOf(prob.value) : 0))
const va = computed(() => (prob.value ? valenceArousalOf(prob.value) : { valence: 0, arousal: 0 }))
const bars = computed(() => EMOTIONS.map((e) => ({ ...e, p: prob.value?.[e.id] || 0 })))
const primary = computed(() => props.result?.primary || null)
const thumbnail = computed(() => primary.value?.thumbnail || props.result?.thumbnail || '')
const faceCount = computed(() => props.result?.count ?? 0)
const timing = computed(() => Math.round(props.result?.timingMs || 0))
const history = computed(() => props.snapshot?.history || [])
const frames = computed(() => props.snapshot?.frames || history.value.length)
const stable = computed(() => !!props.snapshot?.stable)

const emoColor = computed(() => getEmotion(dom.value?.id || 'neutral').color)
const emoBg = computed(() => emoColor.value + '1f')

/* ---- 效价-唤醒度散点 ---- */
const SIZE = 200
const PAD = 26

function px(valence) {
  return PAD + ((Number(valence) + 1) / 2) * (SIZE - PAD * 2)
}
function py(arousal) {
  return SIZE - PAD - Number(arousal) * (SIZE - PAD * 2)
}
/** 参考点标签位置微调，避免相近坐标的标签重叠 */
const LABEL_OFFSET = {
  happy: { dx: -8, dy: 12, anchor: 'end' },
  sad: { dx: 0, dy: 13, anchor: 'middle' },
  angry: { dx: 0, dy: -8, anchor: 'middle' },
  fearful: { dx: 0, dy: 13, anchor: 'middle' },
  disgusted: { dx: 8, dy: 11, anchor: 'start' },
  surprised: { dx: 0, dy: -8, anchor: 'middle' },
  neutral: { dx: 0, dy: 13, anchor: 'middle' },
}
const refPoints = computed(() =>
  EMOTIONS.map((e) => {
    const x = px(e.valence)
    const y = py(e.arousal)
    const off = LABEL_OFFSET[e.id] || { dx: 0, dy: -8, anchor: 'middle' }
    return { ...e, x, y, labelX: x + off.dx, labelY: y + off.dy, anchor: off.anchor }
  }),
)
const curPoint = computed(() => ({ x: px(va.value.valence), y: py(va.value.arousal) }))

/* ---- 趋势折线 ---- */
const trendPoints = computed(() => {
  const h = history.value.slice(-32)
  if (h.length < 2) return ''
  const w = 260
  const hgt = 74
  return h
    .map((item, i) => {
      const x = (i / (h.length - 1)) * w
      const y = hgt - Math.max(0, Math.min(1, item.prob || 0)) * hgt
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
})
</script>

<template>
  <section class="panel">
    <header class="panel-head">
      <h2 class="panel-title"><span class="emoji">🧠</span>情绪识别结果</h2>
      <div class="panel-head-spacer"></div>
      <span v-if="result" class="panel-sub">{{ faceCount }} 张人脸 · {{ timing }} ms</span>
      <span v-if="sourceLabel" class="src-tag">{{ sourceLabel }}</span>
    </header>

    <div class="panel-body">
      <div v-if="!result" class="empty">
        <div class="icon">🔍</div>
        <div>{{ engineReady ? '上传照片、打开视频或点击演示人脸开始识别' : '正在加载本地识别模型…' }}</div>
        <div class="hint">识别全程在浏览器本地完成，模型权重来自 /models</div>
      </div>

      <template v-else>
        <div class="primary-card" :style="{ background: emoBg, borderColor: emoColor + '55' }">
          <div class="face-thumb">
            <img v-if="thumbnail" :src="thumbnail" alt="主脸" />
            <span v-else class="face-emoji">{{ getEmotion(dom?.id).emoji }}</span>
          </div>
          <div class="primary-main">
            <div class="primary-title">
              <span class="primary-emoji">{{ getEmotion(dom?.id).emoji }}</span>
              <strong>{{ dom?.label }}</strong>
              <span class="primary-en">{{ getEmotion(dom?.id).en }}</span>
              <span v-if="stable" class="stable-tag">已稳定</span>
              <span v-else-if="busy" class="busy-tag">分析中…</span>
            </div>
            <div class="primary-nums">
              <span>概率 <b>{{ ((dom?.prob || 0) * 100).toFixed(1) }}%</b></span>
              <span>置信度 <b>{{ (conf * 100).toFixed(1) }}%</b></span>
              <span class="muted">效价 {{ va.valence.toFixed(2) }} · 唤醒 {{ va.arousal.toFixed(2) }}</span>
            </div>
            <p v-if="result.fallback" class="fallback">未检测到清晰人脸，已使用整幅画面兜底，结果仅供参考。</p>
            <p v-else-if="primary?.note" class="primary-note">{{ primary.note }}</p>
          </div>
        </div>

        <div class="block-title">情绪分布（7 类 softmax 概率）</div>
        <div class="bars">
          <div v-for="b in bars" :key="b.id" class="bar-row">
            <span class="bar-label">{{ b.emoji }} {{ b.label }}</span>
            <span class="bar-track">
              <span class="bar-fill" :style="{ width: `${(b.p * 100).toFixed(1)}%`, background: b.color }"></span>
            </span>
            <span class="bar-value">{{ (b.p * 100).toFixed(1) }}%</span>
          </div>
        </div>

        <div class="lower">
          <div class="va-box">
            <div class="block-title">效价 - 唤醒度平面</div>
            <svg :viewBox="`0 0 ${SIZE} ${SIZE}`" class="va-svg" role="img" aria-label="效价唤醒度散点">
              <rect :x="PAD" :y="PAD" :width="SIZE - PAD * 2" :height="SIZE - PAD * 2" rx="10" fill="#f8fafd" stroke="#e5e9f2" />
              <line :x1="SIZE / 2" :y1="PAD" :x2="SIZE / 2" :y2="SIZE - PAD" stroke="#e0e5f0" />
              <line :x1="PAD" :y1="SIZE / 2" :x2="SIZE - PAD" :y2="SIZE / 2" stroke="#e0e5f0" />
              <g v-for="p in refPoints" :key="p.id">
                <circle :cx="p.x" :cy="p.y" r="3.6" :fill="p.color" opacity="0.55" />
                <text :x="p.labelX" :y="p.labelY" :text-anchor="p.anchor" font-size="8.5" fill="#8d97a8">{{ p.label }}</text>
              </g>
              <circle :cx="curPoint.x" :cy="curPoint.y" r="10" :fill="emoColor" opacity="0.22" />
              <circle :cx="curPoint.x" :cy="curPoint.y" r="5" :fill="emoColor" stroke="#fff" stroke-width="1.6" />
            </svg>
            <div class="va-caption">横轴 效价 · 纵轴 唤醒度</div>
          </div>

          <div class="trend-box">
            <div class="block-title">情绪趋势（EMA 平滑后主导情绪概率）</div>
            <svg viewBox="0 0 260 74" class="trend-svg" role="img" aria-label="情绪趋势">
              <line x1="0" y1="73" x2="260" y2="73" stroke="#e5e9f2" />
              <line x1="0" y1="37" x2="260" y2="37" stroke="#eef1f8" stroke-dasharray="3 3" />
              <polyline v-if="trendPoints" :points="trendPoints" fill="none" :stroke="emoColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
              <circle v-if="history.length" :cx="260" :cy="74 - Math.max(0, Math.min(1, history[history.length - 1].prob || 0)) * 74" r="3" :fill="emoColor" />
            </svg>
            <p class="trend-meta">
              已采样 <b>{{ frames }}</b> 帧 · 当前 {{ dom?.label || '—' }} {{ ((dom?.prob || 0) * 100).toFixed(0) }}%
              <span :class="stable ? 'ok-text' : 'muted'">{{ stable ? '· 判定稳定' : '· 判定中' }}</span>
            </p>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.src-tag {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  color: var(--text-3);
}

.primary-card {
  display: flex;
  gap: 14px;
  padding: 14px;
  border: 1px solid;
  border-radius: var(--r-md);
  align-items: center;
}
.face-thumb {
  flex: none;
  width: 72px;
  height: 72px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid rgba(255, 255, 255, 0.9);
  overflow: hidden;
  display: grid;
  place-items: center;
}
.face-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.face-emoji { font-size: 34px; }

.primary-main { min-width: 0; flex: 1; }
.primary-title { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.primary-title strong { font-size: 19px; letter-spacing: 0.01em; }
.primary-emoji { font-size: 20px; }
.primary-en { font-size: 12px; color: var(--text-2); }
.stable-tag,
.busy-tag {
  height: 20px;
  padding: 0 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  line-height: 20px;
  background: var(--ok-soft);
  color: #0e7a52;
}
.busy-tag { background: var(--brand-soft); color: var(--brand-dark); }
.primary-nums {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  margin-top: 5px;
  font-size: 12.5px;
  color: var(--text-2);
}
.primary-nums b { color: var(--text); font-variant-numeric: tabular-nums; }
.primary-note,
.fallback { margin-top: 4px; font-size: 12px; color: var(--text-2); }
.fallback { color: #9a6200; }

.block-title {
  margin: 14px 0 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-2);
}
.bars { margin-top: 2px; }

.lower {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 860px) {
  .lower { grid-template-columns: minmax(0, 1fr); }
}
.va-svg { width: 200px; height: 200px; display: block; }
.va-caption { margin-top: 4px; width: 200px; font-size: 10.5px; color: var(--text-3); text-align: center; }
.trend-box { min-width: 0; }
.trend-svg { width: 100%; height: 120px; display: block; }
.trend-meta { margin-top: 6px; font-size: 12px; color: var(--text-2); }
.ok-text { color: #0e7a52; font-weight: 600; }
.muted { color: var(--text-3); }
</style>
