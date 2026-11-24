<script setup>
/**
 * 底部播放条
 */
import { computed } from 'vue'

const props = defineProps({
  song: { type: Object, default: null },
  isPlaying: { type: Boolean, default: false },
  progress: { type: Number, default: 0 },
  duration: { type: Number, default: 0 },
  volume: { type: Number, default: 0.8 },
  muted: { type: Boolean, default: false },
  hasPrev: { type: Boolean, default: false },
  hasNext: { type: Boolean, default: false },
})
const emit = defineEmits(['toggle', 'seek', 'volume', 'mute', 'prev', 'next'])

function fmt(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00'
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const percent = computed(() => {
  if (!props.duration) return 0
  return Math.max(0, Math.min(100, (props.progress / props.duration) * 100))
})
const playable = computed(() => !!(props.song?.audioUrl || props.song?.previewUrl))

function onSeek(e) {
  emit('seek', Number(e.target.value) / 1000)
}
function onVolume(e) {
  emit('volume', Number(e.target.value) / 100)
}
</script>

<template>
  <footer class="player" :class="{ idle: !song }">
    <div class="player-inner">
      <div class="now">
        <div class="now-art">
          <img v-if="song?.artwork" :src="song.artwork" :alt="song?.title" />
          <span v-else>♪</span>
        </div>
        <div class="now-text">
          <div class="now-title">{{ song?.title || '未在播放' }}</div>
          <div class="now-sub">
            <template v-if="song">{{ song.artist || '未知艺人' }}<span v-if="song.source === 'itunes'"> · 在线试听</span><span v-else> · 本地曲库</span></template>
            <template v-else>选择一首推荐曲目开始播放</template>
          </div>
        </div>
      </div>

      <div class="controls">
        <div class="buttons">
          <button class="ctrl-btn" type="button" :disabled="!hasPrev" aria-label="上一首" @click="emit('prev')">⏮</button>
          <button class="ctrl-main" type="button" :disabled="!playable" :aria-label="isPlaying ? '暂停' : '播放'" @click="emit('toggle')">
            {{ isPlaying ? '⏸' : '▶' }}
          </button>
          <button class="ctrl-btn" type="button" :disabled="!hasNext" aria-label="下一首" @click="emit('next')">⏭</button>
        </div>
        <div class="progress-row">
          <span class="time mono">{{ fmt(progress) }}</span>
          <input
            class="seek"
            type="range"
            min="0"
            max="1000"
            :value="percent * 10"
            :disabled="!playable"
            :style="{ '--fill': percent + '%' }"
            aria-label="播放进度"
            @input="onSeek"
          />
          <span class="time mono">{{ fmt(duration) }}</span>
        </div>
      </div>

      <div class="extras">
        <button class="ctrl-btn" type="button" :aria-label="muted ? '取消静音' : '静音'" @click="emit('mute')">
          {{ muted || volume === 0 ? '🔇' : '🔊' }}
        </button>
        <input
          class="vol"
          type="range"
          min="0"
          max="100"
          :value="muted ? 0 : volume * 100"
          aria-label="音量"
          :style="{ '--fill': (muted ? 0 : volume * 100) + '%' }"
          @input="onVolume"
        />
        <span class="credit" title="部分音乐由 Kevin MacLeod (incompetech.com) 提供，CC BY 4.0">CC BY 音乐</span>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.player {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  background: var(--surface);
  border-top: 1px solid var(--line);
  box-shadow: var(--shadow-float);
}
.player-inner {
  display: grid;
  grid-template-columns: minmax(180px, 280px) minmax(280px, 1fr) minmax(140px, 200px);
  gap: 18px;
  align-items: center;
  max-width: 1440px;
  margin: 0 auto;
  padding: 10px 20px;
}
@media (max-width: 900px) {
  .player-inner { grid-template-columns: 1fr; gap: 8px; padding: 10px 14px; }
  .extras { display: none; }
}

.now { display: flex; align-items: center; gap: 10px; min-width: 0; }
.now-art {
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: 9px;
  background: #eef1f8;
  border: 1px solid var(--line);
  display: grid;
  place-items: center;
  overflow: hidden;
  color: #9aa6bb;
  font-size: 18px;
}
.now-art img { width: 100%; height: 100%; object-fit: cover; }
.now-text { min-width: 0; }
.now-title {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.now-sub {
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.player.idle .now-title { color: var(--text-3); font-weight: 500; }

.controls { min-width: 0; }
.buttons { display: flex; align-items: center; justify-content: center; gap: 10px; }
.ctrl-btn {
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text-2);
  font-size: 13px;
  line-height: 1;
}
.ctrl-btn:hover:not(:disabled) { background: var(--surface-2); }
.ctrl-main {
  width: 38px;
  height: 38px;
  border: 0;
  border-radius: 50%;
  background: var(--brand);
  color: #fff;
  font-size: 14px;
  line-height: 1;
  display: grid;
  place-items: center;
}
.ctrl-main:hover:not(:disabled) { background: var(--brand-dark); }

.progress-row { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.time { font-size: 11px; color: var(--text-3); flex: none; width: 34px; text-align: center; }

input[type='range'] {
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(to right, var(--brand) var(--fill, 0%), #e6eaf3 var(--fill, 0%));
  outline: none;
}
input[type='range'].seek { flex: 1; min-width: 0; }
input[type='range'].vol { width: 84px; }
input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid var(--brand);
  box-shadow: 0 1px 3px rgba(16, 24, 40, 0.2);
}

.extras { display: flex; align-items: center; gap: 8px; justify-content: flex-end; }
.credit { font-size: 10.5px; color: var(--text-3); white-space: nowrap; }
</style>
