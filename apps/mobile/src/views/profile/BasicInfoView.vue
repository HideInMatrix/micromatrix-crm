<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showFailToast } from 'vant'
import { extractErrorMessage } from '@/api/http'
import { getPersonalInfo, updatePersonalInfo, type PersonalCenterVO } from '@/api/personal-center'
import MobileProfileFormShell from '@/components/MobileProfileFormShell.vue'
import { useAuthStore } from '@/stores/auth'
import { showSuccessFeedback } from '@/utils/feedback'

const router = useRouter()
const auth = useAuthStore()
const info = ref<PersonalCenterVO | null>(null)
const loading = ref(true)
const saving = ref(false)
const form = reactive({ phone: '', email: '' })

async function load() {
  loading.value = true
  try {
    const { data } = await getPersonalInfo()
    info.value = data
    form.phone = data.phone ?? ''
    form.email = data.email ?? ''
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!info.value || saving.value) return
  const phone = form.phone.trim()
  const email = form.email.trim()
  if (!phone || phone.length > 11 || !/^\S+@\S+\.\S+$/.test(email)) {
    showFailToast('请填写正确的手机号和邮箱')
    return
  }
  saving.value = true
  try {
    const { data } = await updatePersonalInfo({ phone, email, language: info.value.language })
    info.value = data
    await auth.fetchMe(true)
    showSuccessFeedback('个人信息已更新')
    await router.back()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <van-loading v-if="loading" class="!flex !justify-center !py-12" />
  <MobileProfileFormShell v-else :saving="saving" :disabled="!info" @save="save">
    <van-field :model-value="info?.userName || '-'" label="用户名" readonly input-align="right" />
    <van-field
      v-model="form.phone"
      label="手机号"
      type="tel"
      maxlength="11"
      placeholder="请输入手机号"
      input-align="right"
    />
    <van-field
      v-model="form.email"
      label="邮箱"
      type="email"
      placeholder="请输入邮箱"
      input-align="right"
    />
    <van-field
      :model-value="info?.departmentName || '未分配部门'"
      label="所属部门"
      readonly
      input-align="right"
    />
    <van-field
      :model-value="info?.roles.map((role) => role.name).join('、') || '普通成员'"
      label="账号角色"
      readonly
      input-align="right"
    />
  </MobileProfileFormShell>
</template>
