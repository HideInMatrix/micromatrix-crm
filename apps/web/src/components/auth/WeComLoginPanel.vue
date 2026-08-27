<script setup lang="ts">
import type { WWLoginInstance } from '@wecom/jssdk'
import {
  WWLoginPanelSizeType,
  WWLoginRedirectType,
  WWLoginType,
  createWWLoginPanel,
} from '@wecom/jssdk'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { callbackWeCom, startWeComLogin } from '@/api/auth'
import { extractErrorMessage } from '@/api/http'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{
  tenantSlug?: string
  returnPath?: string
}>()

const emit = defineEmits<{
  success: [returnPath: string]
}>()

const auth = useAuthStore()
const loading = ref(true)
const loggingIn = ref(false)
const errorMessage = ref('')
const fallbackUrl = ref('')
let instance: WWLoginInstance | null = null

async function initialize() {
  loading.value = true
  errorMessage.value = ''
  try {
    const { data } = await startWeComLogin({
      tenantSlug: props.tenantSlug,
      returnPath: props.returnPath,
    })
    fallbackUrl.value = data.authorizationUrl
    instance = createWWLoginPanel({
      el: '#micromatrix-wecom-login',
      params: {
        login_type: WWLoginType.corpApp,
        appid: data.corpId,
        agentid: data.agentId,
        redirect_uri: data.redirectUri,
        state: data.state,
        redirect_type: WWLoginRedirectType.callback,
        panel_size: WWLoginPanelSizeType.small,
      },
      async onLoginSuccess({ code }) {
        loggingIn.value = true
        errorMessage.value = ''
        try {
          const response = await callbackWeCom({ code, state: data.state })
          auth.acceptLoginResult(response.data)
          emit('success', response.data.returnPath)
        } catch (error) {
          errorMessage.value = extractErrorMessage(error)
        } finally {
          loggingIn.value = false
        }
      },
      onLoginFail(error) {
        errorMessage.value = error.errMsg || '企业微信扫码登录失败，请重试'
      },
    })
  } catch (error) {
    errorMessage.value = extractErrorMessage(error)
  } finally {
    loading.value = false
  }
}

onMounted(initialize)
onBeforeUnmount(() => instance?.unmount())
</script>

<template>
  <div v-loading="loading || loggingIn" class="wecom-login-panel">
    <div id="micromatrix-wecom-login" class="wecom-login-frame" />
    <el-alert
      v-if="errorMessage"
      :title="errorMessage"
      type="error"
      :closable="false"
      show-icon
      class="mt-3"
    />
    <div v-if="fallbackUrl && !errorMessage" class="mt-2 text-center">
      <el-link :href="fallbackUrl" type="primary" target="_self" underline="never">
        无法显示二维码？在新页面打开
      </el-link>
    </div>
  </div>
</template>

<style scoped>
.wecom-login-panel {
  min-height: 388px;
}
.wecom-login-frame {
  min-height: 350px;
  display: flex;
  justify-content: center;
}
</style>
