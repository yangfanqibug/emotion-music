import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Vite 配置
// - @vladmandic/face-api 通过 package.json 的 browser 字段解析到 dist/face-api.esm.js
//   （该文件已内置 TensorFlow.js，不依赖任何 CDN，模型权重全部来自 public/models）
// GitHub Pages 部署在 /<repo>/ 子路径下；本地开发仍使用根路径。
// 仓库名从 GITHUB_REPOSITORY 读取，改名后无需再改这里。
const repoName = (process.env.GITHUB_REPOSITORY || '').split('/')[1] || 'emotion-music'

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? `/${repoName}/` : '/',
  plugins: [vue()],
  define: {
    global: 'globalThis',
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@vladmandic/face-api')) return 'face-api'
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['@vladmandic/face-api'],
  },
})
