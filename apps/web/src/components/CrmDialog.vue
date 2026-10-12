<script setup lang="ts">
import { X } from 'lucide-vue-next'

defineOptions({ inheritAttrs: false })

withDefaults(defineProps<{
  title?: string
  width?: string | number
  showClose?: boolean
  /** 开启后显示默认取消/确认按钮；传入 footer 插槽则以页面自定义按钮为准。 */
  showFooter?: boolean
  cancelText?: string
  confirmText?: string
  confirmLoading?: boolean
  confirmDisabled?: boolean
}>(), {
  title: '',
  width: '520px',
  showClose: true,
  showFooter: false,
  cancelText: '取消',
  confirmText: '确定',
  confirmLoading: false,
  confirmDisabled: false,
})

const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ confirm: []; cancel: [] }>()

function cancel() {
  emit('cancel')
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    v-bind="$attrs"
    class="crm-dialog"
    :title="title"
    :width="width"
    :show-close="false"
  >
    <template #header="{ close, titleId, titleClass }">
      <slot name="header" :close="close" :title-id="titleId" :title-class="titleClass">
        <div class="flex min-h-[48px] items-center justify-between gap-3 border-b border-solid border-[#F0F0F0] px-5 py-[13px]">
          <span
            :id="titleId"
            :class="titleClass"
            class="min-w-0 flex-1 text-[18px] font-semibold leading-[22px] text-[#333333]"
          >{{ title }}</span>
          <button
            v-if="showClose"
            type="button"
            class="inline-flex h-[22px] w-[22px] shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-[#999999] hover:text-[#666666]"
            aria-label="关闭弹窗"
            @click="close"
          >
            <X :size="18" :stroke-width="2" aria-hidden="true" />
          </button>
        </div>
      </slot>
    </template>

    <slot />

    <template v-if="$slots.footer || showFooter" #footer>
      <div class="crm-dialog-actions">
        <slot name="footer">
          <el-button @click="cancel">{{ cancelText }}</el-button>
          <el-button
            type="primary"
            :loading="confirmLoading"
            :disabled="confirmDisabled"
            @click="emit('confirm')"
          >{{ confirmText }}</el-button>
        </slot>
      </div>
    </template>
  </el-dialog>
</template>
