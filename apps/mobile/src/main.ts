import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'

import '@unocss/reset/tailwind-compat.css'
import '@micromatrix/frontend-shared/styles/tokens.css'
import 'vant/es/toast/style'
import 'vant/es/dialog/style'
import 'vant/es/image-preview/style'
import 'virtual:uno.css'
import './styles/index.css'
import VConsole from "vconsole";

if (import.meta.env.DEV) void import('@vant/touch-emulator')
new VConsole({ theme: "dark" });

const bootUrl = new URL(window.location.href)
const bootCode = bootUrl.searchParams.get('code') ?? ''
const bootState = bootUrl.searchParams.get('state') ?? ''
const accessToken = localStorage.getItem('mmx_access_token') ?? ''
const refreshToken = localStorage.getItem('mmx_refresh_token') ?? ''

console.info('[WECOM-DEBUG][mobile-bootstrap]', {
  pathname: window.location.pathname,
  queryKeys: [...bootUrl.searchParams.keys()],
  userAgent: window.navigator.userAgent,
  codePresent: Boolean(bootCode),
  codeLength: bootCode.length,
  statePresent: Boolean(bootState),
  statePrefix: bootState ? bootState.split('.')[0] : '',
  accessTokenPresent: Boolean(accessToken),
  accessTokenLength: accessToken.length,
  refreshTokenPresent: Boolean(refreshToken),
  refreshTokenLength: refreshToken.length,
})

createApp(App).use(createPinia()).use(router).mount('#app')
