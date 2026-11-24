# 基于人脸情绪识别的歌曲推荐系统

> 拍照 / 上传 / 视频 / 摄像头 → 本地人脸表情识别 → 情绪画像 → 匹配歌曲。
> **情绪识别完全离线**（模型权重来自 `public/models/`，不调用任何云端接口），
> 音乐来源为**本地 60 首 CC BY 4.0 试听曲库 + iTunes Search API 在线接口**。

---

## 功能特性

- **4 种人脸采集方式**
  - 📁 **上传图片**：选择本地图片 → 立即识别
  - 🎬 **打开视频**：选择本地视频 → 每 350 ms 抽帧分析
  - 📷 **实时摄像头**：`getUserMedia` 取流 → 连续帧识别（需 HTTPS 或 localhost）
  - 📸 **拍照**：摄像头画面定格 → 立即识别
- **本地离线情绪识别**：`@vladmandic/face-api` + 本地权重，7 类表情
  （开心 / 悲伤 / 愤怒 / 恐惧 / 厌恶 / 惊讶 / 平静），**三级级联人脸检测**保证检出率，
  **EMA 时间平滑 + 连续帧稳定判定**消除抖动，WebGL 加速（不可用时自动回退 CPU）。
- **情绪 → 歌曲推荐**：7 维情绪画像 + **五因子加权打分**（情绪余弦 / VA 高斯 / BPM / 质量 / 多样性）
  + **MMR 多样性重排**，并按模型不确定度自动切换 `focus / balanced / explore` 策略。
- **本地曲库 + 在线接口**：本地 60 首 incompetech（Kevin MacLeod，**CC BY 4.0**）试听片段（每首约 30 秒，从完整曲目截取），
  外加 iTunes Search API 在线检索（30 秒试听，**无需 key**，浏览器直连）。
- **47 张演示人脸图库**：真实人像照片 + 7 类教科书级表情图，按情绪分组，点击即载入识别，
  可用于快速演示与效果对比。
- **算法文档**：[`docs/EMOTION_ALGORITHM.md`](docs/EMOTION_ALGORITHM.md)、
  [`docs/RECOMMENDATION_ALGORITHM.md`](docs/RECOMMENDATION_ALGORITHM.md)、
  [`docs/API.md`](docs/API.md)；界面内「算法说明」按钮也可随时查看。

---

## 快速开始

```bash
# ① 安装依赖（vue / vite / @vitejs/plugin-vue / @vladmandic/face-api）
npm install

# ② 启动开发服务器（默认 http://localhost:5173）
npm run dev

# ③ 构建生产包
npm run build

# ④ 预览构建产物（默认 http://localhost:4173）
npm run preview
```

### 素材准备脚本（仓库已自带素材，通常无需执行）

| 命令 | 作用 | 产物 |
|---|---|---|
| `npm run fetch:models` | 从 `@vladmandic/face-api` npm 包下载模型权重 | `public/models/*.bin` + `*-weights_manifest.json` |
| `npm run fetch:faces` | 从 face-api.js 官方示例仓库下载演示人脸 | `public/demo/faces/`（47 张 `.jpg` + 40 张 `.png`） |
| `npm run fetch:songs` | 完整流程：选曲下载 → 裁剪 → 生成曲库清单 | `public/songs/*.mp3` + `public/songs/catalog.json` |
| `npm run fetch:songs:full` | 完整选曲下载流程（`fetch-songs.mjs`：选曲 → HEAD 体积探测 → 下载 → 生成 catalog.json → 自检） | 同上 |
| `npm run trim:songs` | 把已下载的完整曲目裁剪成受控体积的片段 | 覆盖 `public/songs/*.mp3` |
| `node scripts/build-catalog.mjs` | **从已有 mp3 + `scripts/data/pieces.json` 重新生成 `catalog.json`** | `public/songs/catalog.json` |
| `npm test` | 推荐算法自检（`scripts/test-recommend.mjs`，44 条断言） | 控制台报告 |

> 所有素材都已随仓库提供（`public/` 下已就位），克隆后直接 `npm install && npm run dev` 即可运行。

---

## 目录结构

```
26_10_27/
├── index.html                    # 应用外壳 + 启动遮罩（模型加载中显示）
├── package.json                  # 依赖与脚本
├── vite.config.js                # Vite 配置（face-api 手动分包、define global）
├── docs/
│   ├── CONTRACT.md               # 模块边界与 UI 事件契约（各模块的唯一接口依据）
│   ├── EMOTION_ALGORITHM.md      # 情绪识别算法（模型 / 级联 / 平滑 / 准确率实测）
│   ├── RECOMMENDATION_ALGORITHM.md  # 推荐算法（画像 / 五因子 / 策略 / MMR）
│   └── API.md                    # iTunes / 本地曲库 / 模型加载接口说明
├── src/
│   ├── main.js                   # Vue3 应用入口
│   ├── App.vue                   # 主组件：状态编排、采集调度、推荐与播放
│   ├── styles/main.css           # 全局深色玻璃拟态主题
│   ├── components/
│   │   ├── CapturePanel.vue      # 4 种采集方式 Tab + 预览区
│   │   ├── EmotionPanel.vue      # 主情绪卡 + 7 条概率条 + VA 散点 + 趋势
│   │   ├── RecommendPanel.vue    # 推荐列表 + 来源切换 + 匹配分解
│   │   ├── SongCard.vue          # 单曲卡片
│   │   ├── PlayerBar.vue         # 底部固定播放器
│   │   ├── DemoGallery.vue       # 演示人脸图库（按情绪分组）
│   │   └── AlgorithmModal.vue    # 算法说明弹窗
│   ├── core/
│   │   ├── emotions.js           # 情绪词典与数学工具（VA / 熵 / temper …）
│   │   └── song.js               # 歌曲画像推断（标签 / 曲风 / 关键词 → 7 维画像）
│   ├── emotion/
│   │   ├── engine.js             # 模型加载 + 级联人脸检测 + 表情分类
│   │   ├── stabilizer.js         # EMA 时间平滑 + 连续帧稳定判定
│   │   └── index.js              # 统一出口
│   ├── recommend/
│   │   ├── engine.js             # 五因子打分 / 排序 / MMR 重排 / 推荐理由
│   │   └── index.js              # 统一出口
│   ├── api/
│   │   ├── music.js              # iTunes Search API + 本地曲库 + 缓存与降级
│   │   └── index.js              # 统一出口
│   └── data/
│       └── demoFaces.js          # 47 张演示人脸清单（人工标注情绪）
├── public/
│   ├── models/                   # 模型权重（tiny_face_detector / face_expression / landmark / ssd）
│   ├── demo/faces/               # 47 张演示人脸（.jpg + .png 各一份）
│   └── songs/                    # 60 个 mp3 + catalog.json（60 条曲库记录）
├── scripts/
│   ├── fetch-models.mjs          # 模型下载
│   ├── fetch-demo-faces.mjs      # 演示人脸下载
│   ├── fetch-songs.mjs           # 曲库下载（含选曲策略）
│   ├── fetch-songs-fast.mjs      # 曲库快速下载
│   ├── trim-songs.mjs            # 音频裁剪
│   ├── build-catalog.mjs         # 生成 public/songs/catalog.json
│   ├── test-recommend.mjs        # 推荐算法自检（npm test）
│   └── data/pieces.json          # incompetech 曲库元数据（1443 首）
└── tools/                        # 开发期自检脚本（不参与生产构建）
    ├── cdp.mjs                   # 零依赖 Chrome DevTools Protocol 驱动
    ├── e2e.mjs                   # 端到端冒烟：渲染 → 点演示图库 → 校验情绪与推荐
    ├── camera-check.mjs          # 摄像头链路自检（假摄像头设备：取流 / 拍照 / 释放轨道）
    ├── collector.mjs             # 页面结果收集器（配合自检页面上报数据）
    ├── model-check.html          # 47 张演示人脸的全量准确率回归页
    ├── audio-check.html          # 本地曲库逐首解码自检页
    ├── accuracy-report.json      # 准确率实测报告（33/47 = 70.2%）
    ├── audio-report.json         # 音频解码实测报告（60/60 通过）
    └── e2e-shot.png / camera-check.png / gallery-test.png   # 自检截图
```

---

## 算法摘要

### 情绪识别

1. 输入统一缩放到**长边 ≤ 640 px**，交给 **TinyFaceDetector** 检测人脸；
   采用**三级级联**：416/0.35 → 320/0.15 → 整幅画面兜底，实测 47 张演示人脸**检出率 47/47**。
2. 裁剪出的人脸区域送入 **FaceExpressionNet**，输出 **7 类 softmax** 概率并归一化。
3. 取**面积最大**的人脸作为主情绪（多脸时全部返回）；无脸时逐档降级并如实提示"整幅画面兜底"。
4. 连续帧做 **EMA 平滑**（α=0.35）+ **连续帧稳定判定**（≥4 帧、概率 ≥0.45、众数 ≥4 帧），
   避免歌单随帧乱跳；同时给出**归一化香农熵**与置信度。
5. 实测：47 张人工标注演示人脸逐类准确率 **33/47 = 70.2%**（happy 23/25、neutral 6/9）。
   详见 [`docs/EMOTION_ALGORITHM.md`](docs/EMOTION_ALGORITHM.md)。

### 歌曲推荐

1. 情绪概率向量 → 歌曲 **7 维情绪画像**：本地库用官方 mood 标签**位置衰减**（1 / 0.6 / 0.36）
   映射 + BPM 调节唤醒度 + 人工策展主情绪；在线库用曲风先验 + 标题关键词启发式。
2. **五因子加权打分**：`emotion`（画像余弦 0.34）+ `va`（效价-唤醒度高斯 σ=0.35，0.22）
   + `tempo`（目标 BPM = 50+130×唤醒度，σ=0.28，0.12）+ `quality`（评分/热度或稳定哈希，0.12）
   + `diversity`（艺人多样性，0.20）。
3. **不确定性处理**：归一化熵 > 0.65 → `explore`（摊平情绪分布、提高质量权重），
   > 0.45 → `balanced`，否则 `focus`（放大情绪权重）。
4. **MMR 重排**：`sim = 0.5·cos(画像) + 0.5·同艺人`，`score' = score − 0.35·max sim`，
   同一艺人最多 2 首，并输出可解释的中文推荐理由。
   详见 [`docs/RECOMMENDATION_ALGORITHM.md`](docs/RECOMMENDATION_ALGORITHM.md)。

---

## 素材来源与许可

| 类别 | 来源 | 许可 | 说明 |
|---|---|---|---|
| **模型权重** | [`@vladmandic/face-api`](https://github.com/vladmandic/face-api) npm 包 `model/` 目录（`tiny_face_detector`、`face_expression`、`face_landmark_68`、`ssd_mobilenetv1`） | **MIT** | 运行时只从 `/models` 读取，完全离线推理 |
| **演示人脸** | face-api.js 官方示例素材仓库 `examples/images/`（`justadudewhohacks/face-api.js`） | **MIT** | 47 张（7 张彩色表情图 + 8 组人像 × 5 张），逐张人工确认情绪标签 |
| **本地曲库** | [incompetech.com](https://incompetech.com/music/royalty-free/mp3-royaltyfree/) — Kevin MacLeod | **CC BY 4.0** | 60 首试听片段（每首前约 30 秒）；**署名要求**：界面与文档需保留 **Music: Kevin MacLeod - incompetech** |
| **在线曲库** | [iTunes Search API](https://performance-partners.apple.com/search-api) | Apple 公开接口，**无需 key** | 只提供 30 秒试听链接（`previewUrl`），应用不转存音频 |

* 演示人脸中的人物肖像来自 face-api.js 官方示例仓库（MIT 许可的示例素材），
  仅用于本项目的**技术演示**。
* **曲库署名**：CC BY 4.0 要求标注作者与许可。界面中的歌曲卡片会显示
  **艺人 `Kevin MacLeod`** 与 **「许可：CC BY 4.0（本地曲库来自 incompetech，已下载至本地）」**
  （`src/components/SongCard.vue:22/48`），算法说明弹窗也注明了曲库来源
  （`src/components/AlgorithmModal.vue:91`）；
  曲库每条记录的 `album` 字段即为标准署名串 **`Kevin MacLeod - incompetech`**
  （见 `public/songs/catalog.json`）。

---

## 浏览器要求

| 项 | 要求 | 说明 |
|---|---|---|
| **WebGL** | 强烈建议 | 情绪模型默认跑 **WebGL** 后端；不可用时**自动回退 CPU**（速度明显变慢，但功能完整） |
| **摄像头** | 需要 **HTTPS 或 localhost** | `getUserMedia` 在非安全上下文下不可用；`npm run dev` 的 `localhost:5173` 属于安全上下文 |
| **getUserMedia 权限** | 需用户授权 | 首次点击"开启摄像头"时浏览器会弹权限框 |
| **ES2020 + ES Modules + Canvas 2D** | Chrome/Edge 90+、Firefox 90+、Safari 15+ | Vite `build.target: 'es2020'` |
| **Web Audio / `<audio>`** | 任意现代浏览器 | 用于试听与播放 |
| **磁盘** | 约 55 MB | `public/songs`（约 45 MB）+ `public/models`（约 6.3 MB）+ `public/demo`（约 2.3 MB） |

> 首次进入页面会加载本地模型（实测约 1.5 秒），
> 加载期间显示启动遮罩；模型加载失败时顶栏会给出中文提示与排查建议。

---

## 相关文档

| 文档 | 内容 |
|---|---|
| [`docs/EMOTION_ALGORITHM.md`](docs/EMOTION_ALGORITHM.md) | 情绪识别：流程图、模型结构与真实权重大小、三级级联实测数据、数学定义、参数表、代码行号索引、局限与改进、70.2% 逐类准确率 |
| [`docs/RECOMMENDATION_ALGORITHM.md`](docs/RECOMMENDATION_ALGORITHM.md) | 推荐算法：画像推断表、五因子公式与常量、权重与策略表、不确定性处理、MMR 手算示例、七种情绪端到端真实输出 |
| [`docs/API.md`](docs/API.md) | iTunes Search API（URL/参数/字段映射/CORS/超时/缓存/降级）、本地曲库 JSON 结构、模型加载接口 |
| [`docs/CONTRACT.md`](docs/CONTRACT.md) | 模块边界与 UI 事件契约 |
