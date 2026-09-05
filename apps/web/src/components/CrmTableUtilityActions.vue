<script setup lang="ts">
import { Maximize2, Minimize2, RefreshCw, Settings2 } from 'lucide-vue-next'
import { onBeforeUnmount, onMounted, ref } from 'vue'

withDefaults(
  defineProps<{
    showColumns?: boolean
    showFullscreen?: boolean
    showRefresh?: boolean
    refreshing?: boolean
  }>(),
  {
    showColumns: true,
    showFullscreen: true,
    showRefresh: true,
    refreshing: false,
  },
)

const emit = defineEmits<{
  columns: []
  refresh: []
}>()

const fullscreen = ref(false)

function syncFullscreen() {
  fullscreen.value = Boolean(document.fullscreenElement)
}

async function toggleFullscreen(event: MouseEvent) {
  if (document.fullscreenElement) {
    await document.exitFullscreen()
    return
  }
  const source = event.currentTarget as HTMLElement | null
  const target = source?.closest('.el-card') as HTMLElement | null
  if (target?.requestFullscreen) await target.requestFullscreen()
}

onMounted(() => document.addEventListener('fullscreenchange', syncFullscreen))
onBeforeUnmount(() => document.removeEventListener('fullscreenchange', syncFullscreen))
</script>

<template>
  <div class="flex items-center gap-2" data-testid="crm-table-utility-actions">
    <el-tooltip v-if="showColumns" content="列设置" placement="top">
      <el-button
        class="!ml-0 !h-8 !w-8 !p-0"
        aria-label="列设置"
        data-table-tool="columns"
        @click="emit('columns')"
      >
        <Settings2 :size="16" :stroke-width="1.8" aria-hidden="true" />
      </el-button>
    </el-tooltip>

    <el-tooltip v-if="showFullscreen" :content="fullscreen ? '退出全屏' : '全屏'" placement="top">
      <el-button
        class="!ml-0 !h-8 !w-8 !p-0"
        :aria-label="fullscreen ? '退出全屏' : '全屏'"
        data-table-tool="fullscreen"
        @click="toggleFullscreen"
      >
        <Minimize2 v-if="fullscreen" :size="16" :stroke-width="1.8" aria-hidden="true" />
        <Maximize2 v-else :size="16" :stroke-width="1.8" aria-hidden="true" />
      </el-button>
    </el-tooltip>

    <el-tooltip v-if="showRefresh" content="刷新" placement="top">
      <el-button
        class="!ml-0 !h-8 !w-8 !p-0"
        :loading="refreshing"
        aria-label="刷新"
        data-table-tool="refresh"
        @click="emit('refresh')"
      >
        <RefreshCw v-if="!refreshing" :size="16" :stroke-width="1.8" aria-hidden="true" />
      </el-button>
    </el-tooltip>
  </div>
</template>
