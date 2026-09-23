import { redirectDesktopDeviceToWebApp } from '@micromatrix/frontend-shared'

const webOrigin = import.meta.env.DEV
  ? (import.meta.env.VITE_WEB_ORIGIN ?? `${location.protocol}//${location.hostname}:5173`)
  : undefined

if (!import.meta.env.DEV) redirectDesktopDeviceToWebApp({ targetOrigin: webOrigin })
