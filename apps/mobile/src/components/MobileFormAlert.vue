<script setup lang="ts">
import type { FieldVO } from '@micromatrix/shared'
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

const props = defineProps<{ field: FieldVO }>()
const icons: Record<string, Component> = {
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
const icon = computed(() => icons[props.field.config?.alertIcon ?? 'info'] ?? Info)
</script>

<template>
  <div
    role="note"
    class="mx-3 my-2 flex items-start gap-2 rounded-[6px] p-3 text-sm leading-5"
    :style="{
      color: field.config?.alertColor || 'var(--van-text-color)',
      backgroundColor: field.config?.alertBackgroundColor || 'var(--van-background-2)',
    }"
  >
    <component :is="icon" :size="16" class="mt-0.5 shrink-0" aria-hidden="true" />
    <span class="min-w-0 flex-1 whitespace-pre-wrap break-words">{{
      field.config?.alertText
    }}</span>
  </div>
</template>
