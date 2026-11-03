<script setup lang="ts">
import type { CalendarDayItem, CalendarInstance } from 'vant'
import { computed, ref, watch } from 'vue'
import MobileDrawer from '@/components/MobileDrawer.vue'

const props = defineProps<{
  label: string
  value?: string
}>()
const show = defineModel<boolean>('show', { required: true })
const emit = defineEmits<{ confirm: [date: string] }>()

// Parse the local calendar day explicitly, rather than interpreting yyyy-MM-dd as UTC.
function parseDay(value?: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '')
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const parsed = new Date(year, month, day)
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month || parsed.getDate() !== day)
    return null
  return parsed
}

const selectedDay = ref(new Date())
const calendarRef = ref<CalendarInstance | null>(null)
// Keep the visible month range bounded so scrolling remains fast on mobile.
// Anchor it on the saved date so an existing value always reopens in its month.
const minDate = computed(() => new Date(selectedDay.value.getFullYear() - 10, 0, 1))
const maxDate = computed(() => new Date(selectedDay.value.getFullYear() + 10, 11, 31))

watch(show, (opened) => {
  if (opened) selectedDay.value = parseDay(props.value) ?? new Date()
})

function formatDay(item: CalendarDayItem): CalendarDayItem {
  const today = new Date()
  if (
    item.date &&
    item.date.getFullYear() === today.getFullYear() &&
    item.date.getMonth() === today.getMonth() &&
    item.date.getDate() === today.getDate()
  ) {
    return { ...item, text: '今' }
  }
  return item
}

// Calendar's default behavior scrolls the selected day to the top, which hides
// the month's heading. The design shows a full month heading above the date grid.
function alignMonthHeading() {
  const day = selectedDay.value
  calendarRef.value?.scrollToDate(new Date(day.getFullYear(), day.getMonth(), 1))
  requestAnimationFrame(() => {
    const root = calendarRef.value?.$el as HTMLElement | undefined
    const body = root?.querySelector<HTMLElement>('.van-calendar__body')
    if (body) body.scrollTop = Math.max(0, body.scrollTop - 44)
  })
}

function confirm(date: Date) {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  emit('confirm', `${year}-${month}-${day}`)
  show.value = false
}
</script>

<template>
  <MobileDrawer
    v-model:show="show"
    :title="label"
    height="min(480px, 60dvh)"
    max-height="calc(100dvh - 88px)"
    background="#ffffff"
    header-background="#F5F5F5"
    @opened="alignMonthHeading"
  >
    <div class="flex h-full min-h-0 flex-col bg-white">
      <van-calendar
        v-if="show"
        ref="calendarRef"
        class="min-h-0 flex-1"
        type="single"
        :poppable="false"
        :show-title="false"
        :show-subtitle="false"
        :show-mark="false"
        :show-confirm="false"
        :first-day-of-week="1"
        :safe-area-inset-bottom="false"
        :min-date="minDate"
        :max-date="maxDate"
        :default-date="selectedDay"
        :formatter="formatDay"
        :color="'var(--van-primary-color)'"
        style="
          --van-calendar-background: #ffffff;
          --van-calendar-header-shadow: 0 1px 0 #f0f1f3;
          --van-calendar-weekdays-height: 38px;
          --van-calendar-weekdays-font-size: 14px;
          --van-calendar-month-title-font-size: 16px;
          --van-calendar-day-height: 44px;
          --van-calendar-day-font-size: 15px;
          --van-calendar-day-margin-bottom: 4px;
          --van-calendar-selected-day-size: 32px;
          --van-calendar-selected-day-background: var(--van-primary-color);
          --van-calendar-selected-day-color: #ffffff;
          --van-radius-md: 6px;
        "
        @confirm="confirm"
      />
      <div class="shrink-0 bg-white pb-[env(safe-area-inset-bottom)]" />
    </div>
  </MobileDrawer>
</template>
