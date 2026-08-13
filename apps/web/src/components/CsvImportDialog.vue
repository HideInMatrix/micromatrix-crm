<script setup lang="ts">
import { isCustomFieldKey, type FieldVO } from '@micromatrix/shared'
import { ref } from 'vue'
import { downloadCsv, parseCsv } from '@/utils/csv'

const props = defineProps<{
  fields: FieldVO[]
  moduleLabel: string
}>()

const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ submit: [rows: Record<string, unknown>[]] }>()

const parsedRows = ref<Record<string, unknown>[]>([])
const previewHeaders = ref<string[]>([])
const submitting = ref(false)

/** 可导入的字段（排除公式/成员/部门等引用类型） */
function importableFields(): FieldVO[] {
  return props.fields.filter(
    (f) => !f.hidden && !['formula', 'member', 'dept'].includes(f.type),
  )
}

function downloadTemplate() {
  downloadCsv(
    `${props.moduleLabel}导入模板.csv`,
    importableFields().map((f) => f.label),
  )
}

function handleFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const rows = parseCsv(String(reader.result ?? ''))
    if (rows.length < 2) {
      ElMessage.warning('文件为空或缺少数据行')
      return
    }
    const headers = rows[0]
    previewHeaders.value = headers
    const labelToField = new Map(importableFields().map((f) => [f.label, f]))

    parsedRows.value = rows.slice(1).map((cells) => {
      const record: Record<string, unknown> = {}
      const customData: Record<string, unknown> = {}
      headers.forEach((header, index) => {
        const field = labelToField.get(header.trim())
        if (!field) return
        const raw = cells[index]?.trim()
        if (!raw) return
        let value: unknown = raw
        if (['number', 'currency', 'percent'].includes(field.type)) value = Number(raw)
        if (field.type === 'switch') value = raw === '是' || raw === 'true'
        if (['select', 'radio'].includes(field.type)) {
          value = field.options?.find((o) => o.label === raw)?.value ?? raw
        }
        if (isCustomFieldKey(field.key)) customData[field.key] = value
        else record[field.key] = value
      })
      if (Object.keys(customData).length) record.customData = customData
      return record
    })
    ElMessage.success(`已解析 ${parsedRows.value.length} 行`)
  }
  reader.readAsText(file, 'utf-8')
  ;(event.target as HTMLInputElement).value = ''
}

async function handleSubmit() {
  if (parsedRows.value.length === 0) {
    ElMessage.warning('请先选择 CSV 文件')
    return
  }
  submitting.value = true
  try {
    emit('submit', parsedRows.value)
  } finally {
    submitting.value = false
  }
}

function reset() {
  parsedRows.value = []
  previewHeaders.value = []
}

defineExpose({ reset })
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="`导入${props.moduleLabel}`"
    width="560px"
    destroy-on-close
    @closed="reset"
  >
    <div class="space-y-4">
      <el-alert type="info" :closable="false">
        <p class="text-xs leading-5">
          1. 下载模板 → 按列填写数据（选项列填显示名，如「高意向」）<br />
          2. 保存为 CSV（UTF-8）后上传，单次最多 500 行
        </p>
      </el-alert>

      <div class="flex gap-3">
        <el-button @click="downloadTemplate">下载模板</el-button>
        <label>
          <input type="file" accept=".csv" class="hidden" @change="handleFile" />
          <el-button type="primary" plain tag="span">选择 CSV 文件</el-button>
        </label>
      </div>

      <div v-if="parsedRows.length > 0" class="text-sm">
        已解析 <span class="font-bold text-[var(--el-color-primary)]">{{ parsedRows.length }}</span> 行数据，
        确认后开始导入。
      </div>
    </div>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button
        type="primary"
        :disabled="parsedRows.length === 0"
        :loading="submitting"
        @click="handleSubmit"
      >
        开始导入
      </el-button>
    </template>
  </el-dialog>
</template>
