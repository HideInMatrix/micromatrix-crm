<script setup lang="ts">
import {
  BadgeInfo,
  Bell,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Info,
  Lightbulb,
  Megaphone,
  MessageCircle,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-vue-next'
import { computed, type Component } from 'vue'
import type { FieldVO } from '@micromatrix/shared'
import { DEFAULT_ALERT_CONFIG } from './form-presentation'

const props = defineProps<{ field: FieldVO }>()
const iconMap: Record<string, Component> = {
  info: Info,
  'badge-info': BadgeInfo,
  'circle-alert': CircleAlert,
  'triangle-alert': TriangleAlert,
  'circle-check': CircleCheck,
  'shield-check': ShieldCheck,
  'shield-alert': ShieldAlert,
  'circle-help': CircleHelp,
  lightbulb: Lightbulb,
  megaphone: Megaphone,
  bell: Bell,
  'message-circle': MessageCircle,
}
const iconComponent = computed(() => iconMap[props.field.config?.alertIcon ?? 'info'] ?? Info)
const text = computed(() => props.field.config?.alertText || DEFAULT_ALERT_CONFIG.text)
const color = computed(() => props.field.config?.alertColor || DEFAULT_ALERT_CONFIG.color)
const fontSize = computed(() => props.field.config?.alertFontSize ?? DEFAULT_ALERT_CONFIG.fontSize)
</script>

<template>
  <div
    class="flex w-full items-center gap-2 rounded-[var(--el-border-radius-base)] border border-[var(--el-color-primary-light-7)] bg-[var(--el-color-primary-light-9)] px-3 py-2.5"
    :style="{ color, fontSize: `${fontSize}px` }"
    role="note"
  >
    <component
      :is="iconComponent"
      class="shrink-0"
      :size="fontSize + 2"
      :stroke-width="1.8"
      aria-hidden="true"
    />
    <span class="min-w-0 flex-1 whitespace-pre-wrap break-words leading-6">{{ text }}</span>
  </div>
</template>
