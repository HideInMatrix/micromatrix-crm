<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    title?: string
    height?: string
    maxHeight?: string
    background?: string
    headerBackground?: string
    closeOnClickOverlay?: boolean
    destroyOnClose?: boolean
    safeAreaInsetBottom?: boolean
    teleport?: string
  }>(),
  {
    title: '',
    height: '82%',
    maxHeight: undefined,
    background: '#ffffff',
    headerBackground: 'inherit',
    closeOnClickOverlay: true,
    destroyOnClose: false,
    safeAreaInsetBottom: false,
    teleport: undefined,
  },
)

const show = defineModel<boolean>('show', { required: true })
const emit = defineEmits<{ opened: []; close: [] }>()
const autoHeight = computed(() => props.height === 'auto')

const popupStyle = computed(() => ({
  height: props.height,
  maxHeight: props.maxHeight,
  overflow: 'hidden',
  '--van-popup-round-radius': '12px',
  '--van-popup-background': props.background,
}))
</script>

<template>
  <van-popup
    v-model:show="show"
    position="bottom"
    round
    :close-on-click-overlay="closeOnClickOverlay"
    :destroy-on-close="destroyOnClose"
    :safe-area-inset-bottom="safeAreaInsetBottom"
    :teleport="teleport"
    :style="popupStyle"
    @opened="emit('opened')"
    @close="emit('close')"
  >
    <div :class="['flex min-h-0 flex-col', autoHeight ? 'h-auto' : 'h-full']">
      <div
        class="relative flex h-[50px] shrink-0 items-center justify-center px-[12px]"
        :style="{ background: headerBackground }"
      >
        <span
          class="max-w-[calc(100%-96px)] truncate text-[16px] leading-[20px] font-semibold text-[#000000]"
        >
          <slot name="title">{{ title }}</slot>
        </span>
        <div class="absolute right-[12px] flex items-center gap-[8px]">
          <slot name="actions" />
          <van-button
            type="default"
            size="small"
            style="
              --van-button-border-width: 0px;
              --van-button-small-height: 34px;
              --van-button-small-padding: 0;
              --van-button-small-font-size: 14px;
              --van-button-default-background: transparent;
              --van-button-default-color: #777777;
            "
            @click="show = false"
          >
            取消
          </van-button>
        </div>
      </div>
      <div :class="autoHeight ? 'shrink-0 overflow-hidden' : 'min-h-0 flex-1 overflow-hidden'">
        <slot />
      </div>
    </div>
  </van-popup>
</template>
