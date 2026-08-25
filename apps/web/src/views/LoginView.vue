<script setup lang="ts">
import type { FormInstance, FormRules } from 'element-plus'
import { MessagesSquare } from 'lucide-vue-next'
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { extractErrorMessage } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import WeComLoginPanel from '@/components/WeComLoginPanel.vue'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const formRef = ref<FormInstance>()
const loading = ref(false)
const tenantDialogVisible = ref(false)
const qrDialogVisible = ref(false)
const tenantSlug = ref(typeof route.query.tenant === 'string' ? route.query.tenant : '')
const form = reactive({ email: 'admin@demo.com', password: 'admin123' })
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
  if (!tenantSlug.value.trim()) {
    tenantDialogVisible.value = true
    return
  }
  qrDialogVisible.value = true
}

function confirmTenant() {
  if (!tenantSlug.value.trim()) {
    ElMessage.warning('请输入企业标识')
    return
  }
  tenantSlug.value = tenantSlug.value.trim()
  tenantDialogVisible.value = false
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
  <div class="h-full flex-center bg-[var(--el-bg-color-page)]">
    <el-card class="w-96" shadow="hover">
      <div class="text-center mb-6">
        <h1 class="text-xl font-bold">微矩阵 CRM</h1>
        <p class="text-sm text-[var(--el-text-color-secondary)] mt-1">客户关系管理系统</p>
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

    <el-dialog v-model="tenantDialogVisible" title="企业微信登录" width="420px">
      <el-form label-position="top" @submit.prevent="confirmTenant">
        <el-form-item label="企业标识" required>
          <el-input
            v-model="tenantSlug"
            maxlength="128"
            placeholder="请输入管理员提供的企业标识"
            @keyup.enter="confirmTenant"
          />
          <div class="mt-2 text-xs text-[var(--el-text-color-secondary)]">
            企业专属登录地址中的 tenant 参数即为企业标识。
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="tenantDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmTenant">下一步</el-button>
      </template>
    </el-dialog>

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
