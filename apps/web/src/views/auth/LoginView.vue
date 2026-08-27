<script setup lang="ts">
import type { FormInstance, FormRules } from 'element-plus'
import { MessagesSquare } from 'lucide-vue-next'
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { extractErrorMessage } from '@/api/http'
import WeComLoginPanel from '@/components/auth/WeComLoginPanel.vue'
import { useLoginBranding } from '@/composables/useLoginBranding'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const formRef = ref<FormInstance>()
const loading = ref(false)
const qrDialogVisible = ref(false)
const tenantSlug = computed(() =>
  typeof route.query.tenant === 'string' ? route.query.tenant.trim() || undefined : undefined,
)
const form = reactive({ email: 'admin@demo.com', password: 'admin123' })
const { enterpriseUi, loginPageStyle } = useLoginBranding(tenantSlug, () => form.email)
const returnPath = computed(() =>
  typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/')
    ? route.query.redirect
    : '/',
)
const rules: FormRules = {
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '邮箱格式不正确', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码至少 6 位', trigger: 'blur' },
  ],
}

function openWeComLogin() {
  qrDialogVisible.value = true
}

async function handleWeComSuccess(path: string) {
  qrDialogVisible.value = false
  ElMessage.success('企业微信登录成功')
  await router.replace(path || '/')
}

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  try {
    await auth.login(form)
    ElMessage.success('登录成功')
    router.push((route.query.redirect as string) ?? '/')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="h-full flex-center bg-[var(--el-bg-color-page)] bg-no-repeat" :style="loginPageStyle">
    <el-card class="w-96" shadow="hover">
      <div class="text-center mb-6">
        <img
          v-if="enterpriseUi.loginLogoUrl"
          :src="enterpriseUi.loginLogoUrl"
          :alt="enterpriseUi.branding.title"
          class="mx-auto block h-auto max-h-18 w-auto max-w-full object-contain object-center"
        />
        <h1 v-else class="text-xl font-bold">{{ enterpriseUi.branding.title }}</h1>
        <p class="text-sm text-[var(--el-text-color-secondary)] mt-1">
          {{ enterpriseUi.branding.slogan }}
        </p>
      </div>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        @keyup.enter="handleSubmit"
      >
        <el-form-item label="邮箱" prop="email">
          <el-input v-model="form.email" placeholder="请输入邮箱" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            placeholder="请输入密码"
          />
        </el-form-item>
        <el-button type="primary" class="w-full mt-2" :loading="loading" @click="handleSubmit">
          登 录
        </el-button>
      </el-form>

      <el-divider>其他登录方式</el-divider>
      <div class="flex justify-center">
        <el-tooltip content="企业微信扫码登录">
          <el-button
            circle
            size="large"
            :icon="MessagesSquare"
            aria-label="企业微信扫码登录"
            data-testid="wecom-login-entry"
            @click="openWeComLogin"
          />
        </el-tooltip>
      </div>

      <p class="text-xs text-[var(--el-text-color-secondary)] mt-4 text-center">
        演示账号：admin@demo.com / admin123（需先执行种子数据）
      </p>
    </el-card>

    <el-dialog
      v-model="qrDialogVisible"
      title="企业微信扫码登录"
      width="420px"
      destroy-on-close
      align-center
    >
      <WeComLoginPanel
        v-if="qrDialogVisible"
        :tenant-slug="tenantSlug"
        :return-path="returnPath"
        @success="handleWeComSuccess"
      />
    </el-dialog>
  </div>
</template>
