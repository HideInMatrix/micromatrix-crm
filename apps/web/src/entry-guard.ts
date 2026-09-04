import { redirectMobileDeviceToMobileApp } from '@micromatrix/frontend-shared'

const mobileOrigin = import.meta.env.DEV
  ? (import.meta.env.VITE_MOBILE_ORIGIN ?? `${location.protocol}//${location.hostname}:5174`)
  : undefined

redirectMobileDeviceToMobileApp({ targetOrigin: mobileOrigin })
