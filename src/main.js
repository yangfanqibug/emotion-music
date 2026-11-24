/**
 * 应用入口
 * ------------------------------------------------------------------
 * 挂载 Vue3 根组件，并加载全局样式（明亮活力风主题）。
 */
import { createApp } from 'vue'
import App from './App.vue'
import './styles/main.css'

createApp(App).mount('#app')
