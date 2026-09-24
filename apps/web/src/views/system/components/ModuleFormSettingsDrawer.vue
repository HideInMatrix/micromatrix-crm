<script setup lang="ts">
import { MODULE_LABELS, type ModuleKey } from '@micromatrix/shared'
import { ArrowLeft } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import ModuleFormDesigner from './module-form-designer/ModuleFormDesigner.vue'

const visible = defineModel<boolean>({ required: true })

const props = defineProps<{
  module: ModuleKey | null
  title?: string
}>()

const designerRef = ref<InstanceType<typeof ModuleFormDesigner>>()
const saving = ref(false)

const drawerTitle = computed(() => {
  if (props.title) return props.title
  if (!props.module) return '表单设置'
  return `${MODULE_LABELS[props.module]}表单设置`
})

async function close() {
  if (designerRef.value?.hasUnsavedChanges()) {
    const confirmed = await ElMessageBox.confirm(
      '当前表单设置尚未保存，确定离开吗？',
      '未保存的修改',
      {
        type: 'warning',
        confirmButtonText: '离开',
        cancelButtonText: '继续编辑',
      },
    ).catch(() => false)
    if (!confirmed) return
  }
  visible.value = false
}

async function save() {
  if (!designerRef.value || saving.value) return
  saving.value = true
  try {
    const success = await designerRef.value.save()
    if (success) visible.value = false
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-drawer
    v-model="visible"
    size="100%"
    :with-header="false"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    destroy-on-close
    class="module-form-settings-drawer"
  >
    <div class="flex h-full min-h-0 flex-col bg-[var(--el-fill-color-lighter)]">
      <div
        class="flex h-14 shrink-0 items-center justify-between border-b border-[var(--el-border-color-lighter)] bg-[var(--el-bg-color)] px-4"
      >
        <div class="flex min-w-0 items-center gap-2">
          <el-button link class="!h-8 !w-8 !p-0" aria-label="返回模块设置" @click="close">
            <ArrowLeft :size="18" />
          </el-button>
          <span class="truncate text-sm font-medium text-[var(--el-text-color-primary)]">
            {{ drawerTitle }}
          </span>
        </div>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </div>

      <div class="min-h-0 flex-1 overflow-hidden">
        <ModuleFormDesigner v-if="module" ref="designerRef" :module="module" />
      </div>
    </div>
  </el-drawer>
</template>

<style scoped>
:global(.module-form-settings-drawer .el-drawer__body) {
  padding: 0;
  overflow: hidden;
}
</style>
