<script setup lang="ts">
import { showSuccessToast, showFailToast } from 'vant'
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { extractErrorMessage } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import { startWeComLogin } from '@/api/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const loading = ref(false)
const weComLoading = ref(false)
const showTenantInput = ref(false)
const tenantSlug = ref(typeof route.query.tenant === 'string' ? route.query.tenant : '')
const form = reactive({ email: 'admin@demo.com', password: 'admin123' })

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

async function handleWeComLogin() {
  if (!tenantSlug.value.trim()) {
    showTenantInput.value = true
    showFailToast('请先输入企业标识')
    return
  }
  weComLoading.value = true
  try {
    const { data } = await startWeComLogin({
      tenantSlug: tenantSlug.value.trim(),
      returnPath:
        typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/')
          ? route.query.redirect
          : '/',
    })
    location.assign(data.authorizationUrl)
  } catch (error) {
    showFailToast(extractErrorMessage(error))
    weComLoading.value = false
  }
}
</script>

<template>
  <div class="min-h-full flex flex-col justify-center px-6 pb-24">
    <div class="text-center mb-10">
      <h1 class="text-2xl font-bold">微矩阵 CRM</h1>
      <p class="text-sm text-gray-500 mt-2">移动端 · 客户关系管理</p>
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
        <van-button round block type="primary" native-type="submit" :loading="loading">
          登录
        </van-button>
      </div>
      <div v-if="showTenantInput || tenantSlug" class="mt-3 px-4">
        <van-field
          v-model="tenantSlug"
          label="企业标识"
          placeholder="请输入企业标识"
          maxlength="128"
          clearable
        />
      </div>
      <div class="mt-3 px-4">
        <van-button
          round
          block
          plain
          type="primary"
          :loading="weComLoading"
          @click="handleWeComLogin"
        >
          企业微信登录
        </van-button>
      </div>
    </van-form>

    <p class="text-xs text-gray-400 mt-6 text-center">演示账号：admin@demo.com / admin123</p>
  </div>
</template>
