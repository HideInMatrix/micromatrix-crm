<script setup lang="ts">
import { FileSpreadsheet, Inbox } from 'lucide-vue-next'
import type { ImportType } from '@/api/import-export'

defineProps<{
  file: File | null
  importType: ImportType
  downloading: boolean
  moduleLabel: string
}>()
const emit = defineEmits<{
  'update:importType': [value: ImportType]
  'select-file': [value: File]
  'download-template': []
}>()

function fileSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) emit('select-file', file)
}

function dropped(e: DragEvent) {
  const file = e.dataTransfer?.files?.[0]
  if (file) emit('select-file', file)
}
</script>

<template>
  <div class="flex flex-col gap-5" data-testid="lead-import-upload-step">
    <el-radio-group
      :model-value="importType"
      class="!grid !h-auto w-full grid-cols-2 items-start gap-5 max-sm:grid-cols-1 max-sm:gap-3"
      @update:model-value="emit('update:importType', $event as ImportType)"
    >
      <div class="flex min-w-0 flex-col gap-[5px]">
        <el-radio
          value="ADD"
          class="!mr-0 !h-[22px] !items-center !leading-[22px] !whitespace-normal"
        >
          <span
            class="text-[15px] leading-[22px]"
            :class="
              importType === 'ADD'
                ? 'font-semibold text-[var(--el-color-primary)]'
                : 'font-normal text-[#263247]'
            "
            >新增{{ moduleLabel }}</span
          >
        </el-radio>
        <span class="pl-[22px] text-[13px] leading-5 text-[#8997AA]">
          重复数据将自动跳过，不覆盖已有记录
        </span>
      </div>
      <div class="flex min-w-0 flex-col gap-[5px]">
        <el-radio
          value="UPDATE"
          class="!mr-0 !h-[22px] !items-center !leading-[22px] !whitespace-normal"
        >
          <span
            class="text-[15px] leading-[22px]"
            :class="
              importType === 'UPDATE'
                ? 'font-semibold text-[var(--el-color-primary)]'
                : 'font-normal text-[#263247]'
            "
            >更新{{ moduleLabel }}</span
          >
        </el-radio>
        <span class="pl-[22px] text-[13px] leading-5 text-[#8997AA]">
          根据导出文件中的「唯一ID」更新已有{{ moduleLabel }}，不会新增记录
        </span>
      </div>
    </el-radio-group>

    <label
      class="box-border flex w-full cursor-pointer items-center gap-[18px] rounded-[8px] border border-dashed border-[#D5DEEA] bg-[#F7F9FD] px-4 py-[22px] hover:border-[var(--el-color-primary)] hover:bg-[var(--el-color-primary-light-9)] max-sm:gap-[10px]"
      :class="file ? 'justify-start' : 'justify-center'"
      @dragover.prevent
      @drop.prevent="dropped"
    >
      <input type="file" accept=".xlsx" class="hidden" @change="fileSelected" />
      <template v-if="file">
        <FileSpreadsheet class="h-10 w-10 shrink-0 text-[#22AA69]" :size="40" :stroke-width="1.7" />
        <div class="flex min-w-0 flex-1 flex-col gap-[5px]">
          <div class="truncate text-base font-medium text-black" :title="file.name">
            {{ file.name }}
          </div>
          <div class="text-sm text-[#929AA0]">文件已选择，点击“检验数据”获取识别结果</div>
        </div>
        <span
          class="shrink-0 whitespace-nowrap text-sm font-medium text-[var(--el-color-primary)] underline"
          >重新上传</span
        >
      </template>
      <template v-else>
        <Inbox
          class="h-10 w-10 shrink-0 text-[var(--el-color-primary)]"
          :size="40"
          :stroke-width="2"
        />
        <div class="flex min-w-0 flex-col gap-[5px]">
          <div class="text-base font-semibold text-[#263247]">导入 Excel 文件</div>
          <div class="text-[13px] leading-5 text-[#8997AA]">
            将 .xlsx 文件拖到此处，或点击选择文件，单个文件不超过 100 MB
          </div>
        </div>
      </template>
    </label>

    <div
      class="flex items-center justify-between gap-3 rounded-[6px] border border-[#E6EBF4] bg-[#F7F9FD] px-[18px] py-[13px] text-sm text-[#7E8A98]"
    >
      <span v-if="importType === 'UPDATE'"
        >请先导出已有{{ moduleLabel }}，保留「唯一ID」列，修改后重新上传。</span
      >
      <span v-else>导入前请下载模板，并按照模板要求填写数据。</span>
      <el-button link type="primary" :loading="downloading" @click="emit('download-template')"
        >下载模板</el-button
      >
    </div>
  </div>
</template>
