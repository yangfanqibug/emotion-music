<script setup>
/**
 * 演示人脸图库
 * ------------------------------------------------------------------
 * 47 张人工标注情绪的示例人像，按主导情绪分组，点击即可载入识别。
 */
import { computed, ref } from 'vue'
import { DEMO_FACES, groupDemoFaces } from '../data/demoFaces.js'
import { EMOTIONS, getEmotion } from '../core/emotions.js'

const emit = defineEmits(['pick'])

const groups = computed(() => groupDemoFaces(DEMO_FACES))
const active = ref('happy')

const chips = computed(() =>
  EMOTIONS.map((e) => ({ ...e, count: groups.value.get(e.id)?.length || 0 })).filter((e) => e.count > 0),
)
const list = computed(() => groups.value.get(active.value) || [])

function pickRandom() {
  const face = DEMO_FACES[Math.floor(Math.random() * DEMO_FACES.length)]
  emit('pick', face)
}

function tint(id, alpha = '22') {
  const color = getEmotion(id).color
  return color + alpha
}
</script>

<template>
  <section class="panel">
    <header class="panel-head">
      <h2 class="panel-title"><span class="emoji">😀</span>演示图库 · 真人表情样本</h2>
      <span class="badge">{{ DEMO_FACES.length }} 张</span>
      <div class="panel-head-spacer"></div>
      <button class="btn btn-sm btn-soft" type="button" @click="pickRandom">🎲 随机测试</button>
    </header>

    <div class="panel-body tight">
      <div class="chips">
        <button
          v-for="c in chips"
          :key="c.id"
          class="emo-chip"
          :class="{ active: active === c.id }"
          :style="{ background: active === c.id ? tint(c.id, '2e') : undefined, color: c.color }"
          type="button"
          @click="active = c.id"
        >
          <span>{{ c.emoji }}</span>{{ c.label }}
          <span class="emo-chip-count">{{ c.count }}</span>
        </button>
      </div>

      <div class="grid-thumbs gallery">
        <button
          v-for="face in list"
          :key="face.id"
          class="thumb"
          type="button"
          :title="face.note"
          @click="emit('pick', face)"
        >
          <img :src="face.file" :alt="face.note" loading="lazy" />
          <span class="thumb-note">{{ face.note }}</span>
        </button>
      </div>

      <p class="hint footer-hint">标注情绪为该图人工判定的主导表情，用于直观对比识别结果。</p>
    </div>
  </section>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  color: var(--text-2);
  font-size: 11.5px;
}

.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.emo-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: var(--surface-2);
  font-size: 12.5px;
  font-weight: 600;
}
.emo-chip:hover { border-color: currentColor; }
.emo-chip.active { border-color: currentColor; }
.emo-chip-count { font-size: 11px; opacity: 0.72; font-weight: 500; }

.gallery { max-height: 322px; overflow-y: auto; padding-right: 4px; }
.footer-hint { margin-top: 10px; }
</style>
