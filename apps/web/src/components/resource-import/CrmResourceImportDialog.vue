<script setup lang="ts">
import type { ImportResultVO } from '@micromatrix/shared'
import { ref, shallowRef, watch } from 'vue'
import CrmDialog from '@/components/CrmDialog.vue'
import type { ImportType } from '@/api/import-export'
import { extractErrorMessage } from '@/api/http'
import CrmResourceImportUploadStep from './CrmResourceImportUploadStep.vue'
import CrmResourceImportValidationStep from './CrmResourceImportValidationStep.vue'
import CrmResourceImportCompleteStep from './CrmResourceImportCompleteStep.vue'

const props = defineProps<{
  moduleLabel: string
  downloadTemplate: (type: ImportType) => Promise<{ data: Blob }>
  downloadErrorRows: (file: File, rowNumbers: number[]) => Promise<{ data: Blob }>
  precheck: (file: File, type: ImportType) => Promise<{ data: ImportResultVO }>
  execute: (file: File, type: ImportType) => Promise<{ data: ImportResultVO }>
}>()
const emit = defineEmits<{ success: [] }>()
const visible = defineModel<boolean>({ required: true })
const stage = ref<'upload' | 'validation' | 'complete'>('upload')
const importType = ref<ImportType>('ADD')
const file = shallowRef<File | null>(null)
const check = ref<ImportResultVO | null>(null)
const validationError = ref('')
const done = ref<ImportResultVO | null>(null)
const validating = ref(false)
const importing = ref(false)
const downloading = ref(false)
const downloadingErrors = ref(false)
let revision = 0

function reset() {
  revision++
  stage.value = 'upload'
  importType.value = 'ADD'
  file.value = null
  check.value = null
  validationError.value = ''
  done.value = null
  validating.value = false
  downloading.value = false
  downloadingErrors.value = false
}
watch(visible, (value) => {
  if (!value) reset()
})

function selectFile(value: File) {
  if (!value.name.toLowerCase().endsWith('.xlsx')) return ElMessage.warning('仅支持 .xlsx 文件')
  if (value.size > 100 * 1024 * 1024) return ElMessage.warning('文件不能超过 100MB')
  file.value = value
  check.value = null
  validationError.value = ''
  validating.value = false
  downloadingErrors.value = false
  revision++
}
function setType(value: ImportType) {
  importType.value = value
  check.value = null
  validationError.value = ''
  downloadingErrors.value = false
  revision++
}
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function template() {
  downloading.value = true
  try {
    const response = await props.downloadTemplate(importType.value)
    saveBlob(response.data, `${props.moduleLabel}导入模板.xlsx`)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    downloading.value = false
  }
}
async function validate() {
  if (!file.value || validating.value) return
  const version = revision
  check.value = null
  validationError.value = ''
  // 先切换到校验页面；接口返回的数据或错误都在同一个步骤中展示。
  stage.value = 'validation'
  validating.value = true
  try {
    const response = await props.precheck(file.value, importType.value)
    if (!visible.value || version !== revision) return
    check.value = response.data
  } catch (error) {
    if (visible.value && version === revision) validationError.value = extractErrorMessage(error)
  } finally {
    if (version === revision) validating.value = false
  }
}
async function downloadErrors() {
  if (!file.value || !check.value?.errorMessages.length || downloadingErrors.value) return
  const sourceFile = file.value
  const rowNumbers = [...new Set(check.value.errorMessages.map((item) => item.rowNum))]
  const version = revision
  downloadingErrors.value = true
  try {
    const response = await props.downloadErrorRows(sourceFile, rowNumbers)
    if (visible.value && version === revision) {
      saveBlob(response.data, `${props.moduleLabel}导入错误数据.xlsx`)
    }
  } catch (error) {
    if (visible.value && version === revision) ElMessage.error(extractErrorMessage(error))
  } finally {
    if (version === revision) downloadingErrors.value = false
  }
}
async function executeImport() {
  if (!file.value || !check.value?.successCount) return
  const version = revision
  importing.value = true
  try {
    const response = await props.execute(file.value, importType.value)
    if (!visible.value || version !== revision) return
    done.value = response.data
    stage.value = 'complete'
    if (response.data.successCount) emit('success')
  } catch (error) {
    if (version === revision) ElMessage.error(extractErrorMessage(error))
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <CrmDialog
    v-model="visible"
    :title="`导入${moduleLabel}`"
    width="820px"
    class="lead-import-dialog"
    destroy-on-close
    :show-close="!importing"
    :close-on-click-modal="false"
    :close-on-press-escape="!importing"
  >
    <CrmResourceImportUploadStep
      v-if="stage === 'upload'"
      :file="file"
      :module-label="moduleLabel"
      :import-type="importType"
      :downloading="downloading"
      @update:import-type="setType"
      @select-file="selectFile"
      @download-template="template"
    />
    <CrmResourceImportValidationStep
      v-else-if="stage === 'validation'"
      :result="check"
      :loading="validating"
      :error="validationError"
      :downloading-errors="downloadingErrors"
      @download-errors="downloadErrors"
    />
    <CrmResourceImportCompleteStep v-else-if="stage === 'complete' && done" :result="done" />
    <template #footer>
      <div class="lead-import-actions">
        <template v-if="stage === 'upload'">
          <el-button @click="visible = false">取消</el-button>
          <el-button type="primary" :disabled="!file" :loading="validating" @click="validate"
            >检验数据</el-button
          >
        </template>
        <template v-else-if="stage === 'validation'">
          <el-button :disabled="importing || validating" @click="stage = 'upload'"
            >上一步</el-button
          >
          <el-button
            type="primary"
            :loading="importing"
            :disabled="!check?.successCount"
            @click="executeImport"
            >确认导入</el-button
          >
        </template>
        <template v-else>
          <el-button @click="reset">继续导入</el-button>
          <el-button type="primary" @click="visible = false">查看{{ moduleLabel }}</el-button>
        </template>
      </div>
    </template>
  </CrmDialog>
</template>

<style>
.lead-import-dialog {
  max-width: calc(100vw - 32px);
}
.lead-import-dialog .el-dialog__body {
  padding: 20px;
}
.lead-import-dialog .lead-import-actions {
  display: flex;
  justify-content: center;
  gap: 16px;
}
.lead-import-dialog .lead-import-actions .el-button {
  min-width: 88px;
  margin: 0;
}
.lead-import-dialog .lead-import-actions .el-button--primary {
  --el-button-bg-color: var(--el-color-primary);
  --el-button-border-color: var(--el-color-primary);
}
</style>
