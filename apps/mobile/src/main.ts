import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'

import '@unocss/reset/tailwind-compat.css'
import '@micromatrix/frontend-shared/styles/tokens.css'
import 'virtual:uno.css'
import './styles/index.css'

if (import.meta.env.DEV) void import('@vant/touch-emulator')

createApp(App).use(createPinia()).use(router).mount('#app')
