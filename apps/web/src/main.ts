import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'

// 样式顺序：reset → Element Plus 暗黑变量 → UnoCSS 工具类 → 自定义样式
import '@unocss/reset/tailwind-compat.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import 'virtual:uno.css'
import './styles/index.css'

createApp(App).use(createPinia()).use(router).mount('#app')
