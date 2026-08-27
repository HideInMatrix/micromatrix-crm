import { useDebounceFn } from '@vueuse/core'
import { computed, onMounted, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { useEnterpriseUiStore } from '@/stores/enterprise-ui'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function useLoginBranding(
  tenantSlug: MaybeRefOrGetter<string | undefined>,
  email: MaybeRefOrGetter<string>,
) {
  const enterpriseUi = useEnterpriseUiStore()

  async function refreshBranding() {
    const tenant = toValue(tenantSlug)?.trim() || undefined
    const emailValue = toValue(email).trim()
    await enterpriseUi
      .loadLoginBranding({
        tenantSlug: tenant,
        email: EMAIL_PATTERN.test(emailValue) ? emailValue : undefined,
      })
      .then(() => enterpriseUi.setDocumentTitle('登录'))
      .catch(() => undefined)
  }

  const refreshBrandingDebounced = useDebounceFn(refreshBranding, 300)

  const loginPageStyle = computed(() =>
    enterpriseUi.loginImageUrl
      ? {
          backgroundImage: `url(${enterpriseUi.loginImageUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }
      : {},
  )

  onMounted(refreshBranding)
  watch(() => toValue(tenantSlug), refreshBranding)
  watch(
    () => toValue(email),
    (value, previous) => {
      if (value === previous || !EMAIL_PATTERN.test(value.trim())) return
      void refreshBrandingDebounced()
    },
  )

  return {
    enterpriseUi,
    loginPageStyle,
    refreshBranding,
  }
}
