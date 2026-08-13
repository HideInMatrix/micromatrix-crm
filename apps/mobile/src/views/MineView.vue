<script setup lang="ts">
import type { CurrentUser } from '@micromatrix/shared'
import { showConfirmDialog } from 'vant'
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { fetchMe } from '@/api'
import { clearTokens } from '@/utils/token-storage'

const router = useRouter()
const user = ref<CurrentUser | null>(null)

onMounted(async () => {
  const { data } = await fetchMe()
  user.value = data
})

async function handleLogout() {
  const confirmed = await showConfirmDialog({ title: '退出登录', message: '确定退出当前账号？' })
    .then(() => true)
    .catch(() => false)
  if (!confirmed) return
  clearTokens()
  router.push('/login')
}
</script>

<template>
  <div class="min-h-full">
    <van-nav-bar title="我的" fixed placeholder />

    <div class="bg-white p-5 flex items-center gap-4 mb-3">
      <div
        class="w-14 h-14 rounded-full bg-[var(--van-primary-color,#1989fa)] text-white flex items-center justify-center text-xl font-bold"
      >
        {{ user?.name?.slice(0, 1) ?? '?' }}
      </div>
      <div>
        <div class="font-medium">{{ user?.name ?? '-' }}</div>
        <div class="text-xs text-gray-500 mt-1">
          {{ user?.deptName ?? '未分配部门' }} · {{ user?.roleName ?? '无角色' }}
        </div>
      </div>
    </div>

    <van-cell-group inset>
      <van-cell title="账号" :value="user?.email ?? '-'" />
      <van-cell title="企业" :value="user?.tenantName ?? '-'" />
    </van-cell-group>

    <div class="p-4 mt-4">
      <van-button block @click="handleLogout">退出登录</van-button>
    </div>
  </div>
</template>
