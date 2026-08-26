import type {
  EnterpriseUiAssetSlot,
  EnterpriseUiBrandingVO,
  EnterpriseUiSettingVO,
} from '@micromatrix/shared'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { enterpriseUiSettingApi } from '@/api/enterprise-settings'
import { applyEnterpriseUiTheme } from '@/utils/enterprise-ui-theme'

const DEFAULT_BRANDING: EnterpriseUiBrandingVO = {
  tenantSlug: '',
  theme: 'default',
  customTheme: '#008d91',
  style: 'default',
  customStyle: '#f9fbfb',
  title: 'MicroMatrix CRM',
  slogan: '让客户关系更清晰，让销售协作更高效',
  helpDoc: 'https://github.com/HideInMatrix/micromatrix-crm',
  iconConfigured: false,
  loginLogoConfigured: false,
  loginImageConfigured: false,
  platformLogoConfigured: false,
  updatedAt: null,
}

export const useEnterpriseUiStore = defineStore('enterprise-ui', () => {
  const branding = ref<EnterpriseUiBrandingVO>({ ...DEFAULT_BRANDING })
  const loadedTenantSlug = ref('')

  function configured(slot: EnterpriseUiAssetSlot) {
    if (slot === 'icon') return branding.value.iconConfigured
    if (slot === 'loginLogo') return branding.value.loginLogoConfigured
    if (slot === 'loginImage') return branding.value.loginImageConfigured
    return branding.value.platformLogoConfigured
  }

  function assetUrl(slot: EnterpriseUiAssetSlot) {
    if (!branding.value.tenantSlug || !configured(slot)) return ''
    return enterpriseUiSettingApi.brandingAssetUrl(
      branding.value.tenantSlug,
      slot,
      branding.value.updatedAt,
    )
  }

  function apply() {
    applyEnterpriseUiTheme(branding.value)
    const iconUrl = assetUrl('icon')
    let icon = document.querySelector<HTMLLinkElement>('link[data-enterprise-icon]')
    if (iconUrl) {
      if (!icon) {
        icon = document.createElement('link')
        icon.rel = 'icon'
        icon.dataset.enterpriseIcon = '1'
        document.head.appendChild(icon)
      }
      icon.href = iconUrl
    } else {
      icon?.remove()
    }
  }

  function setDocumentTitle(pageTitle?: string) {
    const productTitle = branding.value.title.trim() || DEFAULT_BRANDING.title
    document.title = pageTitle ? `${pageTitle} · ${productTitle}` : productTitle
  }

  function accept(value: EnterpriseUiBrandingVO) {
    branding.value = value
    loadedTenantSlug.value = value.tenantSlug
    apply()
  }

  function acceptSetting(value: EnterpriseUiSettingVO, tenantSlug: string) {
    accept({
      tenantSlug,
      theme: value.theme,
      customTheme: value.customTheme,
      style: value.style,
      customStyle: value.customStyle,
      title: value.title,
      slogan: value.slogan,
      helpDoc: value.helpDoc,
      iconConfigured: Boolean(value.icon),
      loginLogoConfigured: Boolean(value.loginLogo),
      loginImageConfigured: Boolean(value.loginImage),
      platformLogoConfigured: Boolean(value.platformLogo),
      updatedAt: value.updatedAt,
    })
  }

  async function load(tenantSlug: string, force = false) {
    if (!tenantSlug) return
    if (!force && loadedTenantSlug.value === tenantSlug) return
    const { data } = await enterpriseUiSettingApi.branding(tenantSlug)
    accept(data)
  }

  function reset() {
    branding.value = { ...DEFAULT_BRANDING }
    loadedTenantSlug.value = ''
    apply()
  }

  const iconUrl = computed(() => assetUrl('icon'))
  const loginLogoUrl = computed(() => assetUrl('loginLogo'))
  const loginImageUrl = computed(() => assetUrl('loginImage'))
  const platformLogoUrl = computed(() => assetUrl('platformLogo'))

  return {
    branding,
    iconUrl,
    loginLogoUrl,
    loginImageUrl,
    platformLogoUrl,
    load,
    acceptSetting,
    setDocumentTitle,
    reset,
  }
})
