<script setup lang="ts">
import { ExternalLink, Maximize2, Minimize2, Pencil, Star } from 'lucide-vue-next'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { dashboardApi, type DashboardEmbedPolicy } from '@/api/dashboard'
import { extractErrorMessage } from '@/api/http'

const props = defineProps<{
  dashboardId: string
  title: string
  favorite: boolean
  canEdit: boolean
}>()

const emit = defineEmits<{
  toggleFavorite: []
  edit: []
}>()

const containerRef = ref<HTMLElement>()
const iframeRef = ref<HTMLIFrameElement>()
const loading = ref(false)
const errorMessage = ref('')
const policy = ref<DashboardEmbedPolicy>()
const fullscreen = ref(false)
let loadTimer: number | undefined

const canOpen = computed(() => Boolean(policy.value?.resourceUrl))

function clearLoadTimer() {
  if (loadTimer) window.clearTimeout(loadTimer)
  loadTimer = undefined
}

function startLoadTimer() {
  clearLoadTimer()
  loadTimer = window.setTimeout(() => {
    if (!loading.value) return
    loading.value = false
    errorMessage.value = '仪表板加载超时，请检查目标站点是否允许 iframe 嵌入。'
  }, 15000)
}

async function loadPolicy() {
  loading.value = true
  errorMessage.value = ''
  policy.value = undefined
  startLoadTimer()
  try {
    const { data } = await dashboardApi.embedPolicy(props.dashboardId)
    policy.value = data
  } catch (error) {
    clearLoadTimer()
    loading.value = false
    errorMessage.value = extractErrorMessage(error)
  }
}

function onIframeLoad() {
  clearLoadTimer()
  loading.value = false
  errorMessage.value = ''
}

function onIframeError() {
  clearLoadTimer()
  loading.value = false
  errorMessage.value = '仪表板加载失败，请检查目标地址或站点的 iframe 策略。'
}

function openExternal() {
  if (!policy.value?.resourceUrl) return
  window.open(policy.value.resourceUrl, '_blank', 'noopener,noreferrer')
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) await containerRef.value?.requestFullscreen()
    else await document.exitFullscreen()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function onFullscreenChange() {
  fullscreen.value = document.fullscreenElement === containerRef.value
}

document.addEventListener('fullscreenchange', onFullscreenChange)

watch(
  () => props.dashboardId,
  () => void loadPolicy(),
  { immediate: true },
)

onBeforeUnmount(() => {
  clearLoadTimer()
  document.removeEventListener('fullscreenchange', onFullscreenChange)
})
</script>

<template>
  <div
    ref="containerRef"
    class="flex h-full min-h-0 flex-col bg-[var(--el-bg-color)]"
    data-testid="dashboard-preview"
  >
    <div class="flex h-14 shrink-0 items-center justify-between border-b border-[var(--el-border-color)] px-5">
      <div class="flex min-w-0 items-center gap-2">
        <el-button
          link
          :type="props.favorite ? 'warning' : 'default'"
          data-testid="dashboard-preview-favorite"
          @click="emit('toggleFavorite')"
        >
          <Star :size="18" :fill="props.favorite ? 'currentColor' : 'none'" />
        </el-button>
        <span class="truncate font-medium">{{ props.title }}</span>
      </div>
      <div class="flex items-center gap-2">
        <el-button v-if="props.canEdit" plain @click="emit('edit')">
          <Pencil :size="16" />
          编辑
        </el-button>
        <el-button :disabled="!canOpen" plain @click="openExternal">
          <ExternalLink :size="16" />
          新窗口
        </el-button>
        <el-button plain @click="toggleFullscreen">
          <Minimize2 v-if="fullscreen" :size="16" />
          <Maximize2 v-else :size="16" />
          {{ fullscreen ? '退出全屏' : '全屏' }}
        </el-button>
      </div>
    </div>

    <div v-loading="loading" class="relative min-h-0 flex-1 bg-[var(--el-fill-color-lighter)]">
      <el-result
        v-if="errorMessage"
        icon="warning"
        title="仪表板无法加载"
        :sub-title="errorMessage"
        class="absolute inset-0 flex items-center justify-center"
      >
        <template #extra>
          <div class="flex gap-2">
            <el-button @click="loadPolicy">重新加载</el-button>
            <el-button v-if="canOpen" type="primary" @click="openExternal">在新窗口打开</el-button>
          </div>
        </template>
      </el-result>
      <iframe
        v-else-if="policy"
        ref="iframeRef"
        :key="props.dashboardId"
        :src="policy.resourceUrl"
        :sandbox="policy.sandbox"
        :csp="policy.csp"
        referrerpolicy="strict-origin-when-cross-origin"
        allow="fullscreen"
        class="h-full w-full border-0 bg-white"
        data-testid="dashboard-iframe"
        @load="onIframeLoad"
        @error="onIframeError"
      />
    </div>
  </div>
</template>
