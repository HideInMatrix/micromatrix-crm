<script setup lang="ts">
import { CircleHelp, Settings2, ShieldCheck } from 'lucide-vue-next'

defineProps<{
  title: string
  description: string
  statusLabel: string
  statusType: 'primary' | 'success' | 'warning' | 'info' | 'danger'
  loading: boolean
  canUpdate: boolean
  configured: boolean
  testing: boolean
  syncEnabled: boolean
  syncDisabled: boolean
  syncSaving: boolean
  syncTip: string
}>()

const emit = defineEmits<{
  configure: []
  test: []
  syncChange: [enabled: boolean]
}>()
</script>

<template>
  <div
    v-loading="loading"
    class="flex min-h-[140px] w-full max-w-[640px] flex-col justify-between gap-6 rounded-md border border-[var(--el-border-color-lighter)] bg-[var(--el-fill-color-blank)] p-6"
  >
    <div class="flex items-start justify-between gap-6 max-[720px]:flex-col">
      <div class="flex min-w-0 items-start gap-3">
        <div
          class="grid size-10 shrink-0 place-items-center rounded-sm bg-[var(--el-fill-color-light)] text-[var(--el-color-primary)]"
        >
          <slot name="icon" />
        </div>
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-medium text-[var(--el-text-color-primary)]">{{ title }}</span>
            <el-tag :type="statusType" size="small" effect="light">{{ statusLabel }}</el-tag>
          </div>
          <p class="mt-1 text-xs leading-5 text-[var(--el-text-color-secondary)]">
            {{ description }}
          </p>
        </div>
      </div>

      <div v-if="canUpdate" class="flex shrink-0 items-center gap-2 max-[720px]:self-end">
        <el-button size="small" :icon="Settings2" @click="emit('configure')">配置</el-button>
        <el-button
          size="small"
          :icon="ShieldCheck"
          :disabled="!configured"
          :loading="testing"
          @click="emit('test')"
        >
          测试连接
        </el-button>
      </div>
    </div>

    <div class="flex items-center gap-2">
      <el-tooltip :content="syncTip" placement="top" :disabled="!syncDisabled">
        <el-switch
          size="small"
          :model-value="syncEnabled"
          :disabled="syncDisabled"
          :loading="syncSaving"
          @change="emit('syncChange', Boolean($event))"
        />
      </el-tooltip>
      <span class="text-xs text-[var(--el-text-color-regular)]">同步用户</span>
      <el-tooltip
        content="开启后可从当前平台同步部门与成员，并为已同步成员提供统一登录和消息能力。"
        placement="top"
      >
        <CircleHelp
          :size="15"
          class="cursor-help text-[var(--el-text-color-secondary)]"
          aria-label="同步用户说明"
        />
      </el-tooltip>
    </div>
  </div>
</template>
