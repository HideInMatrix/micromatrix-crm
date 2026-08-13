import { createApp } from 'vue'
// 桌面浏览器调试时将鼠标事件模拟为触摸事件（真机上自动跳过）
import '@vant/touch-emulator'
import App from './App.vue'
import router from './router'

import '@unocss/reset/tailwind-compat.css'
import 'virtual:uno.css'
import './styles/index.css'

createApp(App).use(router).mount('#app')
