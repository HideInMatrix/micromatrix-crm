export type ClientMode = 'pc' | 'mobile'

const MOBILE_MEDIA_QUERY = '(max-width: 768px)'

export function getClientMode(): ClientMode {
  if (typeof window === 'undefined') return 'pc'
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches ? 'mobile' : 'pc'
}

export function isMobileClient(): boolean {
  return getClientMode() === 'mobile'
}

export function applyClientModeClass(): void {
  const mode = getClientMode()
  document.documentElement.classList.toggle('mobile-client', mode === 'mobile')
  document.documentElement.classList.toggle('pc-client', mode === 'pc')
}
