<script setup>
/**
 * 推荐歌单面板
 */
import { computed, ref } from 'vue'
import SongCard from './SongCard.vue'
import { FACTOR_LABELS } from '../recommend/index.js'
import { getEmotion } from '../core/emotions.js'

const props = defineProps({
  items: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  strategy: { type: String, default: 'balanced' },
  weights: { type: Object, default: () => ({}) },
  dominant: { type: Object, default: null },
  confidence: { type: Number, default: 0 },
  localCount: { type: Number, default: 0 },
  onlineAvailable: { type: [Boolean, undefined], default: undefined },
  localError: { type: String, default: '' },
  playingId: { type: String, default: '' },
  isPlaying: { type: Boolean, default: false },
})
const emit = defineEmits(['play'])

const sourceTab = ref('all')

const STRATEGY_META = {
  focus: { label: '聚焦匹配', desc: '情绪判定明确，优先推送同向曲目' },
  balanced: { label: '平衡推荐', desc: '情绪分布中等，匹配度与质量并重' },
  explore: { label: '探索扩散', desc: '情绪分布分散，提升新颖度与质量权重' },
}
const meta = computed(() => STRATEGY_META[props.strategy] || STRATEGY_META.balanced)

const localCount = computed(() => props.items.filter((i) => i.song?.source !== 'itunes').length)
const onlineCount = computed(() => props.items.filter((i) => i.song?.source === 'itunes').length)

const visible = computed(() => {
  if (sourceTab.value === 'local') return props.items.filter((i) => i.song?.source !== 'itunes')
  if (sourceTab.value === 'online') return props.items.filter((i) => i.song?.source === 'itunes')
  return props.items
})

const weightRows = computed(() =>
  Object.entries(props.weights || {}).map(([k, v]) => ({ key: k, label: FACTOR_LABELS?.[k] || k, value: v })),
)
const emoColor = computed(() => (props.dominant ? getEmotion(props.dominant.id).color : '#8d97a8'))
</script>

<template>
  <section class="panel">
    <header class="panel-head">
      <h2 class="panel-title"><span class="emoji">🎵</span>推荐歌单</h2>
      <span class="strategy-chip">{{ meta.label }}</span>
      <div class="panel-head-spacer"></div>
      <span v-if="dominant" class="dominant-tag" :style="{ background: emoColor + '1f', color: emoColor }">
        {{ getEmotion(dominant.id).emoji }} {{ dominant.label }} · 置信 {{ Math.round(confidence * 100) }}%
      </span>
      <span class="panel-sub">共 {{ items.length }} 首</span>
    </header>

    <div class="panel-body">
      <div class="toolbar">
        <div class="tabs">
          <button class="tab" :class="{ active: sourceTab === 'all' }" type="button" @click="sourceTab = 'all'">
            全部 <span class="count">{{ items.length }}</span>
          </button>
          <button class="tab" :class="{ active: sourceTab === 'local' }" type="button" @click="sourceTab = 'local'">
            本地曲库 <span class="count">{{ localCount }}</span>
          </button>
          <button class="tab" :class="{ active: sourceTab === 'online' }" type="button" @click="sourceTab = 'online'">
            在线曲库 <span class="count">{{ onlineCount }}</span>
          </button>
        </div>
        <div class="strategy-desc">{{ meta.desc }}</div>
      </div>

      <div v-if="weightRows.length" class="weights">
        <div v-for="w in weightRows" :key="w.key" class="weight-item">
          <span class="weight-label">{{ w.label }}</span>
          <span class="weight-track"><span class="weight-fill" :style="{ width: `${(w.value * 100).toFixed(0)}%` }"></span></span>
          <span class="weight-value">{{ (w.value * 100).toFixed(0) }}%</span>
        </div>
        <div class="weight-note">
          本地曲库 {{ localCount }} 首 · 在线 {{ onlineAvailable === false ? '不可用，已降级' : (onlineAvailable ? '已连接' : '待检测') }}
        </div>
      </div>

      <div v-if="localError" class="alert">{{ localError }}</div>

      <div v-if="loading" class="skeleton-list">
        <div v-for="n in 5" :key="n" class="skeleton-row">
          <span class="sk-art"></span>
          <span class="sk-lines"><span class="sk-line w70"></span><span class="sk-line w40"></span></span>
        </div>
      </div>

      <div v-else-if="!visible.length" class="empty">
        <div class="icon">🎧</div>
        <div>{{ items.length ? '该来源暂无推荐曲目' : '完成一次人脸识别后，这里会生成个性化歌单' }}</div>
        <div class="hint">推荐综合情绪画像、效价唤醒度、节奏、质量与多样性五个因子</div>
      </div>

      <div v-else class="song-list">
        <SongCard
          v-for="item in visible"
          :key="item.song.id"
          :item="item"
          :playing="item.song.id === playingId"
          :is-playing="isPlaying"
          @play="emit('play', $event)"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.strategy-chip {
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--brand-soft);
  color: var(--brand-dark);
  font-size: 11.5px;
  font-weight: 600;
  line-height: 22px;
}
.dominant-tag {
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
  line-height: 22px;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: space-between;
}
.strategy-desc { font-size: 12px; color: var(--text-3); }

.weights {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--surface-2);
  border: 1px solid var(--line);
}
.weight-item { display: inline-flex; align-items: center; gap: 6px; }
.weight-label { font-size: 11.5px; color: var(--text-2); }
.weight-track { display: inline-block; width: 54px; height: 5px; border-radius: 999px; background: #e6eaf3; overflow: hidden; }
.weight-fill { display: block; height: 100%; border-radius: 999px; background: var(--brand); }
.weight-value { font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.weight-note { flex-basis: 100%; font-size: 11px; color: var(--text-3); }

.song-list { margin-top: 6px; }
.alert {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--warn-soft);
  color: #9a6200;
  font-size: 12.5px;
}

.skeleton-list { margin-top: 10px; }
.skeleton-row { display: grid; grid-template-columns: 52px 1fr; gap: 12px; align-items: center; padding: 11px 4px; }
.sk-art {
  width: 52px; height: 52px; border-radius: 10px;
  background: #eef1f8;
}
.sk-lines { display: flex; flex-direction: column; gap: 8px; }
.sk-line { display: block; height: 10px; border-radius: 6px; background: #eef1f8; }
.w70 { width: 70%; }
.w40 { width: 40%; }
</style>
