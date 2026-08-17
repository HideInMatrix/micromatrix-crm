<script setup lang="ts">
import type { ImportResultVO } from '@micromatrix/shared'
import type { UploadFile, UploadUserFile } from 'element-plus'
import { computed, ref, watch } from 'vue'
import type { ImportType } from '@/api/import-export'
import { extractErrorMessage } from '@/api/http'

const props = defineProps<{
  moduleLabel: string
  downloadTemplate: (importType: ImportType) => Promise<{ data: Blob }>
  precheck: (file: File, importType: ImportType) => Promise<{ data: ImportResultVO }>
  execute: (file: File, importType: ImportType) => Promise<{ data: ImportResultVO }>
}>()

const emit = defineEmits<{ success: [] }>()
const visible = defineModel<boolean>({ required: true })

const importType = ref<ImportType>('ADD')
const fileList = ref<UploadUserFile[]>([])
const result = ref<ImportResultVO | null>(null)
const stage = ref<'upload' | 'result'>('upload')
const validating = ref(false)
const importing = ref(false)
const downloading = ref(false)

const currentFile = computed(() => fileList.value[0]?.raw ?? null)

watch(visible, (show) => {
  if (!show) reset()
})

function reset() {
  importType.value = 'ADD'
  fileList.value = []
  result.value = null
  stage.value = 'upload'
}

function handleExceed() {
  ElMessage.warning('每次只能上传一个 xlsx 文件')
}

function beforeUpload(file: File) {
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    ElMessage.warning('仅支持 .xlsx 格式文件')
    return false
  }
  if (file.size > 100 * 1024 * 1024) {
    ElMessage.warning('文件不能超过 100MB')
    return false
  }
  return true
}

function handleChange(uploadFile: UploadFile) {
  if (uploadFile.raw && !beforeUpload(uploadFile.raw)) fileList.value = []
}

async function handleDownloadTemplate() {
  downloading.value = true
  try {
    const { data } = await props.downloadTemplate(importType.value)
    const url = URL.createObjectURL(data)
    const link = document.createElement('a')
    link.href = url
    link.download = `${props.moduleLabel}${importType.value === 'ADD' ? '导入新建' : '导入更新'}模板.xlsx`
    link.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    downloading.value = false
  }
}

async function handleValidate() {
  if (!currentFile.value) {
    ElMessage.warning('请先选择 xlsx 文件')
    return
  }
  validating.value = true
  try {
    const response = await props.precheck(currentFile.value, importType.value)
    result.value = response.data
    stage.value = 'result'
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    validating.value = false
  }
}

async function handleImport() {
  if (!currentFile.value) return
  importing.value = true
  try {
    const response = await props.execute(currentFile.value, importType.value)
    result.value = response.data
    if (response.data.successCount > 0) emit('success')
    if (response.data.failCount > 0) {
      ElMessage.warning(`成功 ${response.data.successCount} 条，失败 ${response.data.failCount} 条`)
    } else {
      ElMessage.success(`成功导入 ${response.data.successCount} 条`)
      visible.value = false
    }
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="`导入${moduleLabel}`"
    width="620px"
    destroy-on-close
    :close-on-click-modal="false"
  >
    <template v-if="stage === 'upload'">
      <el-alert type="info" :closable="false" class="mb-4">
        <template #title>
          <div class="flex-between w-full gap-4">
            <span>上传前请先按 Excel 模板中的格式编辑内容</span>
            <el-button link type="primary" :loading="downloading" @click="handleDownloadTemplate">
              下载模板
            </el-button>
          </div>
        </template>
      </el-alert>

      <el-radio-group v-model="importType" class="mb-4">
        <el-radio value="ADD">
          <span class="font-medium">导入新建</span>
          <span class="ml-2 text-xs text-[var(--el-text-color-secondary)]">重复数据不会覆盖已有记录</span>
        </el-radio>
        <el-radio value="UPDATE">
          <span class="font-medium">导入更新</span>
          <span class="ml-2 text-xs text-[var(--el-text-color-secondary)]">按“唯一ID”更新已有记录</span>
        </el-radio>
      </el-radio-group>

      <el-upload
        v-model:file-list="fileList"
        drag
        :auto-upload="false"
        :limit="1"
        accept=".xlsx"
        :on-change="handleChange"
        :on-exceed="handleExceed"
      >
        <div class="py-6">
          <div class="text-base font-medium">从 Excel 文件导入</div>
          <div class="mt-2 text-sm text-[var(--el-text-color-secondary)]">
            将 .xlsx 文件拖到此处，或点击选择文件；最大 100MB
          </div>
        </div>
      </el-upload>
    </template>

    <template v-else>
      <div class="grid grid-cols-2 gap-3 mb-4">
        <el-card shadow="never">
          <div class="text-sm text-[var(--el-text-color-secondary)]">校验成功</div>
          <div class="mt-1 text-2xl font-semibold">{{ result?.successCount ?? 0 }} 条</div>
        </el-card>
        <el-card shadow="never">
          <div class="text-sm text-[var(--el-text-color-secondary)]">校验失败</div>
          <div class="mt-1 text-2xl font-semibold">{{ result?.failCount ?? 0 }} 条</div>
        </el-card>
      </div>

      <el-alert
        v-if="result?.failCount"
        title="部分校验失败；失败数据可在 Excel 中修改后重新导入，也可以忽略错误继续导入合法行。"
        type="warning"
        :closable="false"
        class="mb-3"
      />

      <el-table
        v-if="result?.errorMessages.length"
        :data="result.errorMessages"
        border
        max-height="300"
      >
        <el-table-column prop="rowNum" label="Excel 行" width="90" />
        <el-table-column prop="errMsg" label="错误详情" min-width="360" show-overflow-tooltip />
      </el-table>
      <el-empty v-else description="校验通过，可以开始导入" :image-size="72" />
    </template>

    <template #footer>
      <template v-if="stage === 'upload'">
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="validating" @click="handleValidate">校验模板</el-button>
      </template>
      <template v-else>
        <el-button @click="stage = 'upload'">返回上传页</el-button>
        <el-button type="primary" :loading="importing" @click="handleImport">
          {{ result?.failCount ? '忽略错误继续导入' : '导入' }}
        </el-button>
      </template>
    </template>
  </el-dialog>
</template>
