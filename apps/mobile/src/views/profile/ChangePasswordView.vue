<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showFailToast } from 'vant'
import { extractErrorMessage } from '@/api/http'
import { getPersonalInfo, resetPersonalPassword } from '@/api/personal-center'
import MobileProfileFormShell from '@/components/MobileProfileFormShell.vue'
import { useAuthStore } from '@/stores/auth'
import { showSuccessFeedback } from '@/utils/feedback'

const router = useRouter()
const auth = useAuthStore()
const saving = ref(false)
const loading = ref(true)
const enabled = ref(false)
const form = reactive({ originPassword: '', password: '', confirmPassword: '' })

onMounted(async () => {
  try {
    const { data } = await getPersonalInfo()
    enabled.value = data.passwordLoginEnabled
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
})

onUnmounted(() => {
  Object.assign(form, { originPassword: '', password: '', confirmPassword: '' })
})

async function save() {
  if (!enabled.value || saving.value) return
  if (!form.originPassword) return showFailToast('请输入当前密码')
  if (
    !form.password ||
    !/(?=.*[A-Za-z])(?=.*\d)/.test(form.password) ||
    form.password.length > 64
  ) {
    return showFailToast('新密码需包含字母和数字，且不超过64位')
  }
  if (form.password !== form.confirmPassword) return showFailToast('两次密码不一致')
  saving.value = true
  try {
    await resetPersonalPassword({ originPassword: form.originPassword, password: form.password })
    showSuccessFeedback('密码已修改，请重新登录')
    const tenant = auth.user?.tenantSlug
    auth.logout()
    await router.replace({ name: 'mobile-login', query: tenant ? { tenant } : undefined })
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <van-loading v-if="loading" class="!flex !justify-center !py-12" />
  <div v-else-if="!enabled" class="h-full bg-[#F5F5F5] pt-[32px]">
    <van-empty description="当前账号未启用密码登录，无法修改密码" />
  </div>
  <MobileProfileFormShell v-else :saving="saving" @save="save">
    <van-field
      v-model="form.originPassword"
      label="当前密码"
      type="password"
      autocomplete="current-password"
      placeholder="请输入当前密码"
      input-align="right"
    />
    <van-field
      v-model="form.password"
      label="新密码"
      type="password"
      autocomplete="new-password"
      placeholder="请输入新密码"
      input-align="right"
    />
    <van-field
      v-model="form.confirmPassword"
      label="确认新密码"
      type="password"
      autocomplete="new-password"
      placeholder="请再次输入新密码"
      input-align="right"
    />
  </MobileProfileFormShell>
</template>
