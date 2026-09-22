import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'

import '@unocss/reset/tailwind-compat.css'
import '@micromatrix/frontend-shared/styles/tokens.css'
import 'virtual:uno.css'
import './styles/index.css'
import VConsole from "vconsole";

if (import.meta.env.DEV) void import('@vant/touch-emulator')
new VConsole({ theme: "dark" });

createApp(App).use(createPinia()).use(router).mount('#app')
