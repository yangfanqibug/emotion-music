<script setup>
/**
 * 算法说明弹窗
 */
import { onBeforeUnmount, watch } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])

function onKey(e) {
  if (e.key === 'Escape') emit('close')
}
watch(
  () => props.open,
  (v) => {
    if (v) window.addEventListener('keydown', onKey)
    else window.removeEventListener('keydown', onKey)
  },
)
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div v-if="open" class="overlay" @click.self="emit('close')">
    <div class="modal" role="dialog" aria-modal="true" aria-label="算法说明">
      <header class="modal-head">
        <h2>算法说明</h2>
        <button class="btn btn-sm btn-ghost" type="button" @click="emit('close')">关闭 Esc</button>
      </header>

      <div class="modal-body">
        <section class="algo-block">
          <h3>① 人脸情绪识别</h3>
          <ul class="algo-list">
            <li>运行时：<code>face-api.js</code> + TensorFlow.js，权重位于 <code>/models</code>，优先 WebGL、失败回退 CPU。</li>
            <li>预处理：输入统一绘制到 canvas，长边缩放至 ≤ 640 px。</li>
            <li>检测级联：TinyFaceDetector 416 px / 阈值 0.35 → 320 px / 0.15 → 整幅画面兜底并标注。</li>
            <li>表情分类：FaceExpressionNet 输出 7 类 softmax 概率（开心、悲伤、愤怒、恐惧、厌恶、惊讶、平静）。</li>
            <li>稳定器：EMA 平滑 α = 0.35；连续 ≥ 4 帧主导概率 ≥ 0.45 且众数 ≥ 4 帧时判定「已稳定」。</li>
          </ul>
        </section>

        <section class="algo-block">
          <h3>② 情绪画像与歌曲画像</h3>
          <ul class="algo-list">
            <li>把 7 类概率映射到 7 维情绪向量，并按情绪元数据计算效价（Valence）与唤醒度（Arousal）。</li>
            <li>本地曲库按 mood 标签位置衰减（1 / 0.6 / 0.36）叠加 BPM 调制，得到每首歌的 7 维画像。</li>
            <li>在线曲目使用曲风先验 + 标题关键词启发式，缺少 BPM 时按中性处理。</li>
          </ul>
        </section>

        <section class="algo-block">
          <h3>③ 五因子推荐</h3>
          <div class="factor-table">
            <div class="factor-row head"><span>因子</span><span>权重</span><span>说明</span></div>
            <div class="factor-row"><span>情绪相似</span><span>0.34</span><span>用户向量与歌曲画像的余弦相似度</span></div>
            <div class="factor-row"><span>效价唤醒</span><span>0.22</span><span>VA 平面高斯核 exp(−d² / 2σ²)，σ = 0.35</span></div>
            <div class="factor-row"><span>节奏匹配</span><span>0.12</span><span>目标 BPM = 50 + 130 × 唤醒度，σ = 0.28</span></div>
            <div class="factor-row"><span>质量热度</span><span>0.12</span><span>评分与播放量对数压缩，在线曲目加试听加成</span></div>
            <div class="factor-row"><span>多样性</span><span>0.20</span><span>同艺人候选越多分越低，最终同艺人最多 2 首</span></div>
          </div>
          <ul class="algo-list">
            <li>策略切换：情绪熵 &lt; 0.45 → 聚焦匹配；0.45–0.65 → 平衡；&gt; 0.65 → 探索（温度摊平情绪分布、提高质量权重）。</li>
            <li>MMR 重排：<code>score' = score − 0.35 × max(相似度)</code>，相似度 = 0.5 × 画像余弦 + 0.5 × 同艺人。</li>
            <li>已播放曲目自动让位，未听过的优先展示。</li>
          </ul>
        </section>

        <section class="algo-block">
          <h3>④ 数据与隐私</h3>
          <ul class="algo-list">
            <li>所有图像与视频帧都在浏览器本地推理，不上传服务器。</li>
            <li>本地曲库 60 首，部分音乐由 Kevin MacLeod (incompetech.com) 提供，遵循 CC BY 4.0。</li>
            <li>在线曲目来自 iTunes Search API，仅使用 30 秒试听片段；接口不可用时自动降级为本地曲库。</li>
          </ul>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 24px 16px;
  background: rgba(17, 24, 39, 0.42);
}
.modal {
  width: min(760px, 100%);
  max-height: min(82vh, 780px);
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-radius: var(--r-lg);
  box-shadow: 0 24px 60px rgba(16, 24, 40, 0.28);
  overflow: hidden;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--line);
}
.modal-head h2 { font-size: 16px; }
.modal-body { padding: 6px 18px 20px; overflow-y: auto; }

.algo-block { padding: 12px 0; border-bottom: 1px solid var(--line); }
.algo-block:last-child { border-bottom: 0; }
.algo-block h3 { margin-bottom: 8px; font-size: 13.5px; }

.algo-list { display: flex; flex-direction: column; gap: 6px; }
.algo-list li {
  position: relative;
  padding-left: 14px;
  font-size: 12.5px;
  color: var(--text-2);
  line-height: 1.6;
}
.algo-list li::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 8px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--brand);
}

.factor-table {
  margin: 2px 0 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
}
.factor-row {
  display: grid;
  grid-template-columns: 92px 60px minmax(0, 1fr);
  gap: 8px;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--text-2);
  background: var(--surface);
}
.factor-row:nth-child(even) { background: var(--surface-2); }
.factor-row.head { font-weight: 600; color: var(--text); background: var(--surface-2); }
</style>
