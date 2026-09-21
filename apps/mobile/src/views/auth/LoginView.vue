<script setup lang="ts">
import { showSuccessToast, showFailToast } from 'vant'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  startDingTalkWorkbenchLogin,
  startLarkMobileLogin,
  startWeComWorkbenchLogin,
} from '@/api/auth'
import { extractErrorMessage } from '@/api/http'
import { useLoginBranding } from '@/composables/useLoginBranding'
import { useAuthStore } from '@/stores/auth'
import { isDingTalkWorkbenchBrowser } from '@/utils/dingtalk'
import { isLarkBrowser } from '@/utils/lark'
import { isWeComWorkbenchBrowser } from '@/utils/wecom'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const loading = ref(false)
const thirdPartyLoading = ref(false)
const form = reactive({ email: '', password: '' })
const tenantSlug = computed(() =>
  typeof route.query.tenant === 'string' ? route.query.tenant.trim() || undefined : undefined,
)
const { enterpriseUi, loginPageStyle } = useLoginBranding(tenantSlug, () => form.email)

async function handleSubmit() {
  loading.value = true
  try {
    await auth.login(form)
    showSuccessToast('登录成功')
    router.push((route.query.redirect as string) ?? '/')
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (route.query.manual === '1') return
  const lark = isLarkBrowser()
  const dingTalk = isDingTalkWorkbenchBrowser()
  const weCom = isWeComWorkbenchBrowser()
  if (!lark && !dingTalk && !weCom) return
  thirdPartyLoading.value = true
  try {
    const payload = {
      tenantSlug: tenantSlug.value,
      returnPath: '/mobile/home',
    }
    const { data } = lark
      ? await startLarkMobileLogin(payload)
      : dingTalk
        ? await startDingTalkWorkbenchLogin(payload)
        : await startWeComWorkbenchLogin(payload)
    window.location.replace(data.authorizationUrl)
  } catch (error) {
    showFailToast(extractErrorMessage(error))
    thirdPartyLoading.value = false
  }
})
</script>

<template>
  <div
    class="min-h-screen flex flex-col justify-center px-6 pb-24 bg-[var(--mobile-page-background,var(--text-n9))]"
    :style="loginPageStyle"
  >
    <div class="text-center mb-10">
      <img
        v-if="enterpriseUi.loginLogoUrl"
        :src="enterpriseUi.loginLogoUrl"
        :alt="enterpriseUi.branding.title"
        class="mx-auto max-h-20 max-w-full object-contain"
      />
      <h1 v-else class="text-2xl font-bold">{{ enterpriseUi.branding.title }}</h1>
      <p class="text-sm text-gray-500 mt-2">{{ enterpriseUi.branding.slogan }}</p>
    </div>

    <van-form @submit="handleSubmit">
      <van-cell-group inset>
        <van-field
          v-model="form.email"
          name="email"
          label="邮箱"
          placeholder="请输入邮箱"
          :rules="[{ required: true, message: '请输入邮箱' }]"
        />
        <van-field
          v-model="form.password"
          type="password"
          name="password"
          label="密码"
          placeholder="请输入密码"
          :rules="[{ required: true, message: '请输入密码' }]"
        />
      </van-cell-group>
      <div class="mt-6 px-4">
        <van-button
          round
          block
          type="primary"
          native-type="submit"
          :loading="loading || thirdPartyLoading"
        >
          登录
        </van-button>
      </div>
    </van-form>

  </div>
</template>
