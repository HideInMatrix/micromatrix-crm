<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { showFailToast } from 'vant'
import { useRouter } from 'vue-router'
import { extractErrorMessage } from '@/api/http'
import { showActionConfirm } from '@/utils/dialog'
import { showSuccessFeedback } from '@/utils/feedback'
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
const editForm = reactive({ phone: '', email: '', language: 'zh-CN' as 'zh-CN' | 'en-US' })
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
  editForm.language = info.value?.language ?? 'zh-CN'
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
      language: editForm.language,
    })
    info.value = data
    await auth.fetchMe(true)
    editVisible.value = false
    showSuccessFeedback('个人信息已更新')
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
    showSuccessFeedback('密码已修改，请重新登录')
    const tenant = auth.user?.tenantSlug
    auth.logout()
    passwordVisible.value = false
    await router.push({ name: 'mobile-login', query: tenant ? { tenant } : undefined })
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

async function handleLogout() {
  const confirmed = await showActionConfirm({ title: '退出登录', message: '确定退出当前账号？' })
  if (!confirmed) return
  const tenant = auth.user?.tenantSlug
  auth.logout()
  router.push({ name: 'mobile-login', query: tenant ? { tenant } : undefined })
}

onMounted(loadInfo)
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-[var(--text-n9)]">
    <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
      <div class="flex items-center gap-4 rounded-[12px] bg-white p-4">
        <van-image v-if="info?.avatarUrl" round width="64" height="64" :src="info.avatarUrl" />
        <div
          v-else
          class="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--primary-7)] text-xl font-semibold text-[var(--primary-8)]"
        >
          {{ info?.userName?.slice(0, 1) ?? auth.user?.name?.slice(0, 1) ?? '?' }}
        </div>
        <div class="min-w-0 flex-1">
          <div class="truncate text-base font-semibold text-[var(--text-n1)]">
            {{ info?.userName ?? auth.user?.name ?? '-' }}
          </div>
          <div
            class="mt-2 inline-flex max-w-full truncate rounded-[6px] bg-[var(--text-n9)] px-2 py-1 text-xs text-[var(--text-n1)]"
          >
            {{ info?.departmentName || '未分配部门' }}
          </div>
        </div>
      </div>

      <van-cell-group inset class="!mx-0">
        <van-cell class="!p-4" title="手机号" :value="info?.phone || '-'" is-link @click="openEdit" />
        <van-cell class="!p-4" title="邮箱" :value="info?.email || '-'" is-link @click="openEdit" />
        <van-cell
          class="!p-4"
          title="通知语言"
          :value="info?.language === 'en-US' ? 'English' : '简体中文'"
          is-link
          @click="openEdit"
        />
      </van-cell-group>

      <van-cell-group v-if="info?.passwordLoginEnabled !== false" inset class="!mx-0">
        <van-cell class="!p-4" title="修改密码" is-link @click="openPassword" />
      </van-cell-group>

      <div>
        <van-button block type="primary" :loading="loading" @click="handleLogout">退出登录</van-button>
      </div>
    </div>

    <van-popup v-model:show="editVisible" position="bottom" round>
      <div class="flex h-full flex-col bg-[var(--text-n10)]">
        <div
          class="flex min-h-12 items-center justify-center border-b-[0.5px] border-[var(--text-n8)] px-4 text-base font-medium text-[var(--text-n1)]"
        >
          编辑个人信息
        </div>
        <div class="py-4">
          <van-cell-group inset>
          <van-field
            v-model="editForm.phone"
            label="手机号"
            maxlength="11"
            placeholder="请输入手机号"
          />
          <van-field v-model="editForm.email" label="邮箱" placeholder="请输入邮箱" />
          <van-field label="通知语言" readonly>
            <template #input>
              <van-radio-group v-model="editForm.language" direction="horizontal">
                <van-radio name="zh-CN">简体中文</van-radio>
                <van-radio name="en-US">English</van-radio>
              </van-radio-group>
            </template>
          </van-field>
          </van-cell-group>
        </div>
        <div
          class="flex gap-3 border-t-[0.5px] border-[var(--text-n8)] bg-[var(--text-n10)] px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]"
        >
          <van-button block @click="editVisible = false">取消</van-button>
          <van-button block type="primary" :loading="saving" @click="saveInfo">更新</van-button>
        </div>
      </div>
    </van-popup>

    <van-popup v-model:show="passwordVisible" position="bottom" round>
      <div class="flex h-full flex-col bg-[var(--text-n10)]">
        <div
          class="flex min-h-12 items-center justify-center border-b-[0.5px] border-[var(--text-n8)] px-4 text-base font-medium text-[var(--text-n1)]"
        >
          修改密码
        </div>
        <div class="py-4">
          <van-cell-group inset>
          <van-field v-model="passwordForm.originPassword" type="password" label="当前密码" />
          <van-field v-model="passwordForm.password" type="password" label="新密码" />
          <van-field v-model="passwordForm.confirmPassword" type="password" label="确认新密码" />
          </van-cell-group>
        </div>
        <div
          class="flex gap-3 border-t-[0.5px] border-[var(--text-n8)] bg-[var(--text-n10)] px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]"
        >
          <van-button block @click="passwordVisible = false">取消</van-button>
          <van-button block type="primary" :loading="saving" @click="savePassword">保存</van-button>
        </div>
      </div>
    </van-popup>
  </div>
</template>
