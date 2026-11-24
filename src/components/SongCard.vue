<script setup>
/**
 * 推荐歌曲卡片（列表行）
 */
import { computed } from 'vue'
import { FACTOR_LABELS } from '../recommend/index.js'

const props = defineProps({
  item: { type: Object, required: true },
  playing: { type: Boolean, default: false },
  isPlaying: { type: Boolean, default: false },
})
const emit = defineEmits(['play'])

const song = computed(() => props.item.song || {})
const factors = computed(() => props.item.factors || {})

const topFactors = computed(() =>
  Object.entries(factors.value)
    .filter(([, v]) => typeof v === 'number')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k, v]) => ({ key: k, label: FACTOR_LABELS?.[k] || k, value: v })),
)

const score = computed(() => Math.round((props.item.score || 0) * 100))
const playable = computed(() => !!(song.value.audioUrl || song.value.previewUrl))
const initial = computed(() => (song.value.title || '♪').slice(0, 1))
</script>

<template>
  <article class="song-row" :class="{ playing }">
    <div class="art">
      <img v-if="song.artwork" :src="song.artwork" :alt="song.title" loading="lazy" />
      <span v-else class="art-fallback">♪</span>
    </div>

    <div class="main">
      <div class="title-line">
        <span class="title" :title="song.title">{{ song.title || '未知曲目' }}</span>
        <span class="tag" :class="song.source === 'itunes' ? 'online' : 'local'">
          {{ song.source === 'itunes' ? '在线' : '本地' }}
        </span>
        <span v-if="!playable" class="tag muted-tag">无试听</span>
      </div>
      <div class="sub-line">
        <span>{{ song.artist || '未知艺人' }}</span>
        <span v-if="song.bpm" class="dot-sep">·</span>
        <span v-if="song.bpm">{{ song.bpm }} BPM</span>
        <span v-if="song.album" class="dot-sep">·</span>
        <span v-if="song.album" class="album">{{ song.album }}</span>
      </div>
      <p v-if="item.reason" class="reason">{{ item.reason }}</p>
      <div v-if="topFactors.length" class="factor-chips">
        <span v-for="f in topFactors" :key="f.key" class="factor-chip">
          {{ f.label }} · {{ Math.round(f.value * 100) }}%
        </span>
      </div>
    </div>

    <div class="side">
      <div class="score" :title="`综合匹配度 ${score}%`">
        <span class="score-num">{{ score }}</span>
        <span class="score-unit">分</span>
      </div>
      <button
        class="play-btn"
        type="button"
        :disabled="!playable"
        :aria-label="playing && isPlaying ? '暂停' : '播放'"
        @click="emit('play', item)"
      >{{ playing && isPlaying ? '⏸' : '▶' }}</button>
    </div>
  </article>
</template>

<style scoped>
.song-row {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr) 78px;
  gap: 12px;
  align-items: center;
  padding: 11px 4px;
  border-bottom: 1px solid var(--line);
}
.song-row:last-child { border-bottom: 0; }
.song-row.playing { background: var(--brand-soft); border-radius: 10px; padding-left: 10px; padding-right: 10px; }

.art {
  width: 52px;
  height: 52px;
  border-radius: 10px;
  overflow: hidden;
  background: #eef1f8;
  border: 1px solid var(--line);
  display: grid;
  place-items: center;
}
.art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.art-fallback { color: #9aa6bb; font-size: 22px; }

.main { min-width: 0; }
.title-line { display: flex; align-items: center; gap: 6px; min-width: 0; }
.title {
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tag {
  flex: none;
  height: 18px;
  padding: 0 6px;
  border-radius: 5px;
  font-size: 10.5px;
  line-height: 18px;
  font-weight: 600;
}
.tag.local { background: var(--brand-soft); color: var(--brand-dark); }
.tag.online { background: #e8f7ef; color: #0e7a52; }
.tag.muted-tag { background: var(--surface-2); color: var(--text-3); font-weight: 500; }

.sub-line {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.album { overflow: hidden; text-overflow: ellipsis; }
.dot-sep { opacity: 0.6; }

.reason {
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--text-2);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.factor-chips { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 5px; }
.factor-chip {
  height: 18px;
  padding: 0 6px;
  border-radius: 5px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  font-size: 10.5px;
  color: var(--text-2);
  line-height: 16px;
}

.side { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.score { display: flex; align-items: baseline; gap: 2px; color: var(--brand-dark); }
.score-num { font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums; }
.score-unit { font-size: 10.5px; color: var(--text-3); }
.play-btn {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  color: var(--brand-dark);
  font-size: 12px;
  line-height: 1;
}
.play-btn:hover:not(:disabled) { border-color: var(--brand); background: var(--brand-soft); }
</style>
