<script setup lang="ts">
import type { ImportResultVO } from '@micromatrix/shared'
import { Download, LoaderCircle } from 'lucide-vue-next'
import { computed } from 'vue'

type LeadImportError = ImportResultVO['errorMessages'][number] & {
  category?: 'duplicate' | 'invalid'
  values?: Record<string, unknown>
}

const props = defineProps<{
  result: ImportResultVO | null
  loading: boolean
  downloadingErrors: boolean
  error: string
}>()
const emit = defineEmits<{
  'download-errors': []
}>()

const errors = computed(() => (props.result?.errorMessages ?? []) as LeadImportError[])
const duplicates = computed(
  () => errors.value.filter((item) => item.category === 'duplicate').length,
)
const invalid = computed(() => (props.result?.failCount ?? 0) - duplicates.value)
const total = computed(() => (props.result?.successCount ?? 0) + (props.result?.failCount ?? 0))
</script>

<template>
  <div v-loading="loading" class="lead-import-validation" data-testid="lead-import-validation-step">
    <div
      class="grid grid-cols-4 rounded-[4px] border border-[#E6EAF1] bg-[#F6F8FC] py-5 max-sm:py-3"
    >
      <div class="flex min-w-0 flex-col items-center gap-2 text-center">
        <span class="text-[14px] text-[#77839A]">数据总数</span>
        <strong class="text-[24px] font-semibold leading-none text-[#172033] tabular-nums">{{
          total
        }}</strong>
      </div>
      <div class="flex min-w-0 flex-col items-center gap-2 border-l border-[#E6EAF1] text-center">
        <span class="text-[14px] text-[#77839A]">可导入</span>
        <strong
          class="text-[24px] font-semibold leading-none text-[var(--el-color-primary)] tabular-nums"
          >{{ result?.successCount ?? 0 }}</strong
        >
      </div>
      <div class="flex min-w-0 flex-col items-center gap-2 border-l border-[#E6EAF1] text-center">
        <span class="text-[14px] text-[#77839A]">重复数据</span>
        <strong class="text-[24px] font-semibold leading-none text-[#EF8A17] tabular-nums">{{
          duplicates
        }}</strong>
      </div>
      <div class="flex min-w-0 flex-col items-center gap-2 border-l border-[#E6EAF1] text-center">
        <span class="text-[14px] text-[#77839A]">异常数据</span>
        <strong class="text-[24px] font-semibold leading-none text-[#E5484D] tabular-nums">{{
          invalid
        }}</strong>
      </div>
    </div>
    <el-alert v-if="error" type="error" :title="error" :closable="false" show-icon />
    <el-alert
      v-if="result?.ignoredHeaders?.length"
      type="warning"
      :closable="false"
      show-icon
      :title="`已忽略 ${result.ignoredHeaders.length} 列无法识别的表头`"
    >
      <template #default>
        <p class="my-1">{{ result.ignoredHeaders.join('、') }}</p>
        <p class="m-0">
          这些列的数据不会导入，其余
          {{ result.recognizedColumnCount ?? 0 }} 列已识别字段继续正常检验和导入。
        </p>
      </template>
    </el-alert>
    <el-table
      :data="errors"
      border
      max-height="260px"
      class="w-full overflow-hidden rounded-[4px] text-[14px]"
      :style="{
        '--el-table-border-color': '#DCE2EC',
        '--el-table-header-bg-color': '#F3F6FA',
        '--el-table-header-text-color': '#666666',
      }"
      :empty-text="
        loading
          ? '正在检验文件数据…'
          : error
            ? '请返回上一步修正文件后重新检验'
            : '校验通过，没有异常数据'
      "
    >
      <el-table-column label="行号" width="114">
        <template #default="{ row }">第{{ row.rowNum }}行</template>
      </el-table-column>
      <el-table-column prop="errMsg" label="异常原因" min-width="195" show-overflow-tooltip />
    </el-table>
    <div class="lead-import-error-options">
      <button
        type="button"
        class="inline-flex items-center gap-1 text-[14px] text-[#3867F4] disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="errors.length === 0 || downloadingErrors"
        @click="emit('download-errors')"
      >
        <LoaderCircle v-if="downloadingErrors" :size="16" class="animate-spin" />
        <Download v-else :size="16" />
        下载错误数据
      </button>
    </div>
  </div>
</template>

<style scoped>
.lead-import-validation {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.lead-import-error-options {
  display: flex;
  gap: 12px;
  justify-content: space-between;
  align-items: center;
}
</style>
