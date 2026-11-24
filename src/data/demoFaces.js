/**
 * 演示人脸数据
 * ------------------------------------------------------------------
 * 共 47 张 AI 生成真人表情头像，按 7 类情绪分组：
 * happy 7 / sad 7 / angry 7 / fearful 6 / disgusted 6 / surprised 7 / neutral 7。
 * 每张都是统一灰色影棚背景的正脸半身像，便于本地表情模型稳定识别。
 * 情绪标签为人工逐张核对（7 类：happy / sad / angry / fearful /
 * disgusted / surprised / neutral），图片资源位于 public/demo/faces/。
 * 用途：演示图库，点击任意一张即可直接载入识别并与实时检测结果对比。
 */

const FACE_SEEDS = [
  // ---------------------------------------------------------------- happy 7
  { id: 'ai-happy-01', file: 'demo/faces/ai-happy-01.jpg', emotion: 'happy', note: '开怀大笑' },
  { id: 'ai-happy-02', file: 'demo/faces/ai-happy-02.jpg', emotion: 'happy', note: '露齿微笑' },
  { id: 'ai-happy-03', file: 'demo/faces/ai-happy-03.jpg', emotion: 'happy', note: '眼角弯起的笑' },
  { id: 'ai-happy-04', file: 'demo/faces/ai-happy-04.jpg', emotion: 'happy', note: '爽朗大笑' },
  { id: 'ai-happy-05', file: 'demo/faces/ai-happy-05.jpg', emotion: 'happy', note: '温暖浅笑' },
  { id: 'ai-happy-06', file: 'demo/faces/ai-happy-06.jpg', emotion: 'happy', note: '开心眯眼笑' },
  { id: 'ai-happy-07', file: 'demo/faces/ai-happy-07.jpg', emotion: 'happy', note: '嘴角上扬的灿烂笑容' },

  // ------------------------------------------------------------------ sad 7
  { id: 'ai-sad-01', file: 'demo/faces/ai-sad-01.jpg', emotion: 'sad', note: '眉眼低垂，神情失落' },
  { id: 'ai-sad-02', file: 'demo/faces/ai-sad-02.jpg', emotion: 'sad', note: '亚裔女性 · 长发垂泪' },
  { id: 'ai-sad-03', file: 'demo/faces/ai-sad-03.jpg', emotion: 'sad', note: '黑人男性 · 络腮胡 · 目光低垂' },
  { id: 'ai-sad-04', file: 'demo/faces/ai-sad-04.jpg', emotion: 'sad', note: '银发老妇 · 忧郁凝视' },
  { id: 'ai-sad-05', file: 'demo/faces/ai-sad-05.jpg', emotion: 'sad', note: '南亚少年 · 眉心微蹙' },
  { id: 'ai-sad-06', file: 'demo/faces/ai-sad-06.jpg', emotion: 'sad', note: '拉丁裔女性 · 眼眶泛红' },
  { id: 'ai-sad-07', file: 'demo/faces/ai-sad-07.jpg', emotion: 'sad', note: '亚裔男性 · 戴眼镜 · 神情疲惫' },

  // ---------------------------------------------------------------- angry 7
  { id: 'ai-angry-01', file: 'demo/faces/ai-angry-01.jpg', emotion: 'angry', note: '亚裔男性 · 眉头紧压 · 咬牙' },
  { id: 'ai-angry-02', file: 'demo/faces/ai-angry-02.jpg', emotion: 'angry', note: '黑人女性 · 编发 · 下颌绷紧' },
  { id: 'ai-angry-03', file: 'demo/faces/ai-angry-03.jpg', emotion: 'angry', note: '白人中年男性 · 涨红脸 · 张口怒吼' },
  { id: 'ai-angry-04', file: 'demo/faces/ai-angry-04.jpg', emotion: 'angry', note: '拉丁裔女性 · 挑眉 · 满脸不悦' },
  { id: 'ai-angry-05', file: 'demo/faces/ai-angry-05.jpg', emotion: 'angry', note: '亚裔老者 · 目光严厉' },
  { id: 'ai-angry-06', file: 'demo/faces/ai-angry-06.jpg', emotion: 'angry', note: '南亚女性 · 怒目上视' },
  { id: 'ai-angry-07', file: 'demo/faces/ai-angry-07.jpg', emotion: 'angry', note: '白人男性 · 络腮胡 · 怒目圆睁' },

  // -------------------------------------------------------------- fearful 6
  { id: 'ai-fearful-01', file: 'demo/faces/ai-fearful-01.jpg', emotion: 'fearful', note: '亚裔女性 · 双眼惊恐圆睁' },
  { id: 'ai-fearful-02', file: 'demo/faces/ai-fearful-02.jpg', emotion: 'fearful', note: '白人男性 · 瞳孔放大 · 张口' },
  { id: 'ai-fearful-03', file: 'demo/faces/ai-fearful-03.jpg', emotion: 'fearful', note: '黑人少女 · 卷发 · 双手护脸' },
  { id: 'ai-fearful-04', file: 'demo/faces/ai-fearful-04.jpg', emotion: 'fearful', note: '南亚男性 · 八字胡 · 额头紧皱' },
  { id: 'ai-fearful-05', file: 'demo/faces/ai-fearful-05.jpg', emotion: 'fearful', note: '白人老妇 · 白色卷发 · 忧惧' },
  { id: 'ai-fearful-06', file: 'demo/faces/ai-fearful-06.jpg', emotion: 'fearful', note: '拉丁裔女性 · 咬唇 · 紧张' },

  // ------------------------------------------------------------ disgusted 6
  { id: 'ai-disgusted-01', file: 'demo/faces/ai-disgusted-01.jpg', emotion: 'disgusted', note: '亚裔男性 · 皱鼻 · 上唇上提' },
  { id: 'ai-disgusted-02', file: 'demo/faces/ai-disgusted-02.jpg', emotion: 'disgusted', note: '白人女性 · 金发 · 撇嘴' },
  { id: 'ai-disgusted-03', file: 'demo/faces/ai-disgusted-03.jpg', emotion: 'disgusted', note: '黑人男性 · 板寸 · 皱眉嫌恶' },
  { id: 'ai-disgusted-04', file: 'demo/faces/ai-disgusted-04.jpg', emotion: 'disgusted', note: '亚裔女性 · 短发 · 抿唇厌恶' },
  { id: 'ai-disgusted-05', file: 'demo/faces/ai-disgusted-05.jpg', emotion: 'disgusted', note: '黑人老者 · 戴眼镜 · 侧头皱眉' },
  { id: 'ai-disgusted-06', file: 'demo/faces/ai-disgusted-06.jpg', emotion: 'disgusted', note: '白人红发青年 · 雀斑 · 做鬼脸' },

  // ------------------------------------------------------------ surprised 7
  { id: 'ai-surprised-01', file: 'demo/faces/ai-surprised-01.jpg', emotion: 'surprised', note: '亚裔女性 · 张口成 O 形' },
  { id: 'ai-surprised-02', file: 'demo/faces/ai-surprised-02.jpg', emotion: 'surprised', note: '白人男性 · 瞠目结舌' },
  { id: 'ai-surprised-03', file: 'demo/faces/ai-surprised-03.jpg', emotion: 'surprised', note: '黑人女性 · 盘发 · 惊喜倒吸气' },
  { id: 'ai-surprised-04', file: 'demo/faces/ai-surprised-04.jpg', emotion: 'surprised', note: '南亚女性 · 手掩面颊 · 惊讶' },
  { id: 'ai-surprised-05', file: 'demo/faces/ai-surprised-05.jpg', emotion: 'surprised', note: '亚裔老妇 · 戴眼镜 · 惊喜' },
  { id: 'ai-surprised-06', file: 'demo/faces/ai-surprised-06.jpg', emotion: 'surprised', note: '拉丁裔青年 · 卷发 · 双手抬起' },
  { id: 'ai-surprised-07', file: 'demo/faces/ai-surprised-07.jpg', emotion: 'surprised', note: '白人女性 · 马尾 · 惊愕后退' },

  // -------------------------------------------------------------- neutral 7
  { id: 'ai-neutral-01', file: 'demo/faces/ai-neutral-01.jpg', emotion: 'neutral', note: '亚裔男性 · 平静直视' },
  { id: 'ai-neutral-02', file: 'demo/faces/ai-neutral-02.jpg', emotion: 'neutral', note: '黑人女性 · 短发 · 神情从容' },
  { id: 'ai-neutral-03', file: 'demo/faces/ai-neutral-03.jpg', emotion: 'neutral', note: '白人男性 · 鬓角斑白 · 表情沉稳' },
  { id: 'ai-neutral-04', file: 'demo/faces/ai-neutral-04.jpg', emotion: 'neutral', note: '南亚女性 · 长发 · 安静注视' },
  { id: 'ai-neutral-05', file: 'demo/faces/ai-neutral-05.jpg', emotion: 'neutral', note: '黑人男性 · 灰白胡须 · 西装 · 沉稳' },
  { id: 'ai-neutral-06', file: 'demo/faces/ai-neutral-06.jpg', emotion: 'neutral', note: '白人女性 · 金发 · 浅色毛衣 · 淡然' },
  { id: 'ai-neutral-07', file: 'demo/faces/ai-neutral-07.jpg', emotion: 'neutral', note: '亚裔老妇 · 短卷发 · 戴眼镜 · 慈和' },
]

/** 静态资源根路径：本地为 '/'，GitHub Pages 部署为 '/<repo>/' */
const BASE = import.meta.env.BASE_URL

export const DEMO_FACES = FACE_SEEDS.map((face) => ({ ...face, file: BASE + face.file }))

/** 演示人脸总数（47 张） */
export const DEMO_COUNT = DEMO_FACES.length

/**
 * 按情绪分组
 * @param {Array<{emotion: string}>} list 待分组的人脸清单，默认全部演示人脸
 * @returns {Map<string, Array>} key 为情绪 id，分组顺序按清单中首次出现的顺序
 */
export function groupDemoFaces(list = DEMO_FACES) {
  const groups = new Map()
  for (const face of list || []) {
    if (!groups.has(face.emotion)) groups.set(face.emotion, [])
    groups.get(face.emotion).push(face)
  }
  return groups
}

/**
 * 按 id 取单张演示人脸
 * @param {string} id 人脸 id（如 'ai-happy-01'）
 * @returns {object|null} 未找到时返回 null
 */
export function getDemoFace(id) {
  const key = String(id ?? '')
  return DEMO_FACES.find((face) => face.id === key) || null
}
