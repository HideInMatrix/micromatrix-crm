<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { showConfirmDialog, showFailToast, showSuccessToast } from 'vant'
import { useRouter } from 'vue-router'
import { extractErrorMessage } from '@/api/http'
import {
  getPersonalInfo,
  resetPersonalPassword,
  updatePersonalInfo,
  type PersonalCenterVO,
} from '@/api/personal-center'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()
const info = ref<PersonalCenterVO | null>(null)
const loading = ref(false)
const editVisible = ref(false)
const passwordVisible = ref(false)
const saving = ref(false)
const editForm = reactive({ phone: '', email: '' })
const passwordForm = reactive({ originPassword: '', password: '', confirmPassword: '' })

async function loadInfo() {
  loading.value = true
  try {
    const { data } = await getPersonalInfo()
    info.value = data
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function openEdit() {
  editForm.phone = info.value?.phone ?? ''
  editForm.email = info.value?.email ?? ''
  editVisible.value = true
}

async function saveInfo() {
  if (!editForm.phone.trim() || !/^\S+@\S+\.\S+$/.test(editForm.email.trim())) {
    showFailToast('请填写正确的手机号和邮箱')
    return
  }
  saving.value = true
  try {
    const { data } = await updatePersonalInfo({
      phone: editForm.phone.trim(),
      email: editForm.email.trim(),
    })
    info.value = data
    await auth.fetchMe(true)
    editVisible.value = false
    showSuccessToast('个人信息已更新')
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

function openPassword() {
  Object.assign(passwordForm, { originPassword: '', password: '', confirmPassword: '' })
  passwordVisible.value = true
}

async function savePassword() {
  if (!passwordForm.originPassword) return showFailToast('请输入当前密码')
  if (!passwordForm.password || !/(?=.*[A-Za-z])(?=.*\d)/.test(passwordForm.password)) {
    return showFailToast('新密码至少包含字母和数字')
  }
  if (passwordForm.password !== passwordForm.confirmPassword) return showFailToast('两次密码不一致')
  saving.value = true
  try {
    await resetPersonalPassword({
      originPassword: passwordForm.originPassword,
      password: passwordForm.password,
    })
    showSuccessToast('密码已修改，请重新登录')
    const tenant = auth.user?.tenantSlug
    auth.logout()
    passwordVisible.value = false
    await router.push({ name: 'login', query: tenant ? { tenant } : undefined })
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

async function handleLogout() {
  const confirmed = await showConfirmDialog({ title: '退出登录', message: '确定退出当前账号？' })
    .then(() => true)
    .catch(() => false)
  if (!confirmed) return
  const tenant = auth.user?.tenantSlug
  auth.logout()
  router.push({ name: 'login', query: tenant ? { tenant } : undefined })
}

onMounted(loadInfo)
</script>

<template>
  <div class="min-h-full">
    <van-nav-bar title="我的" fixed placeholder />

    <div class="bg-white p-5 flex items-center gap-4 mb-3">
      <van-image v-if="info?.avatarUrl" round width="56" height="56" :src="info.avatarUrl" />
      <div
        v-else
        class="w-14 h-14 rounded-full bg-[var(--van-primary-color,#1989fa)] text-white flex items-center justify-center text-xl font-bold"
      >
        {{ info?.userName?.slice(0, 1) ?? auth.user?.name?.slice(0, 1) ?? '?' }}
      </div>
      <div class="min-w-0 flex-1">
        <div class="font-medium truncate">{{ info?.userName ?? auth.user?.name ?? '-' }}</div>
        <div class="text-xs text-gray-500 mt-1 truncate">{{ info?.departmentName || '未分配部门' }}</div>
      </div>
    </div>

    <van-cell-group inset>
      <van-cell title="手机号" :value="info?.phone || '-'" is-link @click="openEdit" />
      <van-cell title="邮箱" :value="info?.email || '-'" is-link @click="openEdit" />
    </van-cell-group>

    <van-cell-group v-if="info?.passwordLoginEnabled !== false" inset class="mt-3">
      <van-cell title="修改密码" is-link @click="openPassword" />
    </van-cell-group>

    <div class="p-4 mt-4">
      <van-button block :loading="loading" @click="handleLogout">退出登录</van-button>
    </div>

    <van-popup v-model:show="editVisible" position="bottom" round>
      <div class="p-4 pb-8">
        <div class="text-base font-medium mb-4">编辑个人信息</div>
        <van-cell-group inset>
          <van-field v-model="editForm.phone" label="手机号" maxlength="11" placeholder="请输入手机号" />
          <van-field v-model="editForm.email" label="邮箱" placeholder="请输入邮箱" />
        </van-cell-group>
        <div class="mt-4 flex gap-3">
          <van-button block @click="editVisible = false">取消</van-button>
          <van-button block type="primary" :loading="saving" @click="saveInfo">更新</van-button>
        </div>
      </div>
    </van-popup>

    <van-popup v-model:show="passwordVisible" position="bottom" round>
      <div class="p-4 pb-8">
        <div class="text-base font-medium mb-4">修改密码</div>
        <van-cell-group inset>
          <van-field v-model="passwordForm.originPassword" type="password" label="当前密码" />
          <van-field v-model="passwordForm.password" type="password" label="新密码" />
          <van-field v-model="passwordForm.confirmPassword" type="password" label="确认新密码" />
        </van-cell-group>
        <div class="mt-4 flex gap-3">
          <van-button block @click="passwordVisible = false">取消</van-button>
          <van-button block type="primary" :loading="saving" @click="savePassword">保存</van-button>
        </div>
      </div>
    </van-popup>
  </div>
</template>
