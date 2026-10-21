<script setup lang="ts">
import { CalendarDays, Clock3 } from 'lucide-vue-next'

withDefaults(
  defineProps<{
    title?: string
    description?: string
  }>(),
  {
    title: '暂无待跟进线索',
    description: '新的跟进任务会显示在这里',
  },
)
</script>

<template>
  <div class="flex min-h-[315px] flex-col items-center justify-center">
    <div class="relative flex h-[142px] w-[174px] items-center justify-center" aria-hidden="true">
      <span class="absolute top-6 right-2 h-3 w-3 rounded-full bg-[#D6FBE7]" />
      <span class="absolute bottom-4 left-1 h-2.5 w-2.5 rounded-full bg-[#B6D0FF]" />
      <div
        class="relative flex h-[108px] w-[118px] items-center justify-center rounded-[24px] bg-[#EFF5FF]"
      >
        <CalendarDays :size="86" :stroke-width="1.5" class="text-[#5684FF]" />
        <Clock3
          :size="47"
          :stroke-width="1.5"
          class="absolute -right-2 -bottom-2 rounded-full bg-[#EFF5FF] text-[#5684FF]"
        />
      </div>
    </div>
    <div class="mt-4 flex flex-col items-center gap-[5px] text-center">
      <span class="text-[16px] font-medium text-[#000000]">{{ title }}</span>
      <span class="text-[14px] text-[#8A97AC]">{{ description }}</span>
    </div>
  </div>
</template>
