<script setup lang="ts">
import type { EnterpriseIntegrationProvider } from '@micromatrix/shared'
import type { Component } from 'vue'
import { computed, onMounted, ref } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { enterpriseIntegrationApi } from '@/api/system'
import DingTalkIntegrationCard from './DingTalkIntegrationCard.vue'
import LarkIntegrationCard from './LarkIntegrationCard.vue'
import WeComIntegrationCard from './WeComIntegrationCard.vue'

const activePlatform = ref<EnterpriseIntegrationProvider>('WECOM')
const loading = ref(true)
const switching = ref(false)
const platformOptions = [
  { label: '企业微信', value: 'WECOM' },
  { label: '钉钉', value: 'DINGTALK' },
  { label: '飞书', value: 'LARK' },
] satisfies Array<{ label: string; value: EnterpriseIntegrationProvider }>

const platformComponents: Record<EnterpriseIntegrationProvider, Component> = {
  WECOM: WeComIntegrationCard,
  DINGTALK: DingTalkIntegrationCard,
  LARK: LarkIntegrationCard,
}

const activePlatformComponent = computed(() => platformComponents[activePlatform.value])

function platformName(provider: EnterpriseIntegrationProvider) {
  return platformOptions.find((item) => item.value === provider)?.label ?? provider
}

async function loadActivePlatform() {
  loading.value = true
  try {
    const { data } = await enterpriseIntegrationApi.getActivePlatform()
    activePlatform.value = data.syncResource
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function handlePlatformChange(value: string | number | boolean) {
  const provider = value as EnterpriseIntegrationProvider
  if (!platformComponents[provider] || provider === activePlatform.value || switching.value) return

  try {
    await ElMessageBox.confirm(
      `注意：扫码登录及消息通知会调用切换后平台（${platformName(provider)}）的配置，可能导致登录失败或消息接收异常，建议您谨慎操作！`,
      '确定切换平台吗？',
      {
        type: 'error',
        confirmButtonText: '确认',
        cancelButtonText: '取消',
      },
    )
  } catch {
    return
  }

  switching.value = true
  try {
    const { data } = await enterpriseIntegrationApi.switchActivePlatform({ provider })
    activePlatform.value = data.syncResource
    ElMessage.success('操作成功')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    switching.value = false
  }
}

onMounted(loadActivePlatform)
</script>

<template>
  <div class="max-w-[1080px]">
    <el-card shadow="never" data-testid="third-party-settings-panel">
      <section v-loading="loading || switching" aria-labelledby="collaboration-platform-title">
        <h2
          id="collaboration-platform-title"
          class="mb-4 font-medium text-[var(--el-text-color-primary)]"
        >
          企业协同软件
        </h2>
        <div class="mb-4">
          <el-segmented
            :model-value="activePlatform"
            :options="platformOptions"
            aria-label="选择企业协同平台"
            @change="handlePlatformChange"
          />
        </div>
        <component :is="activePlatformComponent" :key="activePlatform" />
      </section>
    </el-card>
  </div>
</template>
