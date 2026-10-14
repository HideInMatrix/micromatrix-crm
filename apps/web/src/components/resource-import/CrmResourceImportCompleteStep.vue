<script setup lang="ts">
import type { ImportResultVO } from '@micromatrix/shared'
import { Check } from 'lucide-vue-next'
import { computed } from 'vue'

type LeadImportError = ImportResultVO['errorMessages'][number] & {
  category?: 'duplicate' | 'invalid'
}

const props = defineProps<{ result: ImportResultVO }>()

const duplicates = computed(
  () =>
    (props.result.errorMessages as LeadImportError[]).filter(
      (item) => item.category === 'duplicate',
    ).length,
)
const failed = computed(() => props.result.failCount - duplicates.value)
</script>

<template>
  <div class="flex flex-col items-center" data-testid="lead-import-complete-step">
    <div
      class="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-[#24A865] text-white"
    >
      <Check :size="42" :stroke-width="2.8" />
    </div>
    <div class="mb-7 mt-4 text-[20px] font-semibold text-[#333333]">导入完成</div>
    <div class="w-full overflow-hidden rounded-[4px] border border-[#DCE2EC] bg-white">
      <div class="flex items-center justify-between p-4">
        <span class="text-[15px] text-[#263247]">成功导入</span>
        <div class="inline-flex items-center gap-2">
          <strong class="text-[18px] font-semibold text-[#3867F4] tabular-nums">{{
            result.successCount
          }}</strong>
          <span class="text-[15px] text-[#263247]">条</span>
        </div>
      </div>
      <div class="flex items-center justify-between border-t border-[#DCE2EC] p-4">
        <span class="text-[15px] text-[#263247]">跳过重复数据</span>
        <div class="inline-flex items-center gap-2">
          <strong class="text-[18px] font-semibold text-[#EF8A17] tabular-nums">{{
            duplicates
          }}</strong>
          <span class="text-[15px] text-[#263247]">条</span>
        </div>
      </div>
      <div class="flex items-center justify-between border-t border-[#DCE2EC] p-4">
        <span class="text-[15px] text-[#263247]">导入失败</span>
        <div class="inline-flex items-center gap-2">
          <strong class="text-[18px] font-semibold text-[#E5484D] tabular-nums">{{
            failed
          }}</strong>
          <span class="text-[15px] text-[#263247]">条</span>
        </div>
      </div>
    </div>
  </div>
</template>
