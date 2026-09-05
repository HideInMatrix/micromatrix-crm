import type { CustomFormDataPageVO } from '@micromatrix/shared'
import { ref, type Ref } from 'vue'
import { customFormApi } from '@/api/custom-form'
import { extractErrorMessage } from '@/api/http'
import type { ImportType } from '@/api/import-export'

export function useCustomFormTransfer(
  activeFormId: Ref<string>,
  dataPage: Ref<CustomFormDataPageVO>,
  selectedDataIds: Ref<string[]>,
  reload: (reset?: boolean) => Promise<void>,
) {
  const importVisible = ref(false)
  const exportVisible = ref(false)
  const exportMode = ref<'all' | 'selected'>('all')
  const exportLoading = ref(false)
  const batchEditVisible = ref(false)
  const batchSaving = ref(false)

  function openImport() {
    if (!activeFormId.value || !dataPage.value.access.canCreate) return
    importVisible.value = true
  }

  function downloadImportTemplate(importType: ImportType) {
    return customFormApi.downloadTemplate(activeFormId.value, importType)
  }

  function precheckImport(file: File, importType: ImportType) {
    return customFormApi.importPrecheck(activeFormId.value, file, importType)
  }

  function executeImport(file: File, importType: ImportType) {
    return customFormApi.importXlsx(activeFormId.value, file, importType)
  }

  function openExport(mode: 'all' | 'selected') {
    if (!activeFormId.value) return
    if (mode === 'selected' && !selectedDataIds.value.length) {
      ElMessage.warning('请先选择需要导出的数据')
      return
    }
    exportMode.value = mode
    exportVisible.value = true
  }

  async function handleExport(payload: { fileName: string; headList: string[] }) {
    if (!activeFormId.value) return
    exportLoading.value = true
    try {
      if (exportMode.value === 'selected') {
        await customFormApi.exportSelected(activeFormId.value, {
          ...payload,
          ids: selectedDataIds.value,
        })
      } else {
        await customFormApi.exportAll(activeFormId.value, payload)
      }
      exportVisible.value = false
      ElMessage.success('导出任务已创建，可在页面顶部“导出任务”中下载')
    } catch (error) {
      ElMessage.error(extractErrorMessage(error))
    } finally {
      exportLoading.value = false
    }
  }

  function openBatchEdit() {
    if (!selectedDataIds.value.length) {
      ElMessage.warning('请先选择需要修改的数据')
      return
    }
    batchEditVisible.value = true
  }

  async function handleBatchEdit(payload: { fieldId: string; fieldValue: unknown }) {
    if (!activeFormId.value || !selectedDataIds.value.length) return
    batchSaving.value = true
    try {
      const { data } = await customFormApi.batchUpdateData(activeFormId.value, {
        ids: selectedDataIds.value,
        ...payload,
      })
      batchEditVisible.value = false
      ElMessage.success(`已批量修改 ${data.count} 条数据`)
      await reload()
    } catch (error) {
      ElMessage.error(extractErrorMessage(error))
    } finally {
      batchSaving.value = false
    }
  }

  async function batchDeleteSelected() {
    if (!activeFormId.value || !selectedDataIds.value.length) return
    const count = selectedDataIds.value.length
    const confirmed = await ElMessageBox.confirm(
      `确定删除选中的 ${count} 条数据？删除后无法恢复。`,
      '批量删除',
      { type: 'warning', confirmButtonText: '删除' },
    ).catch(() => false)
    if (!confirmed) return
    batchSaving.value = true
    try {
      const { data } = await customFormApi.batchDeleteData(
        activeFormId.value,
        selectedDataIds.value,
      )
      ElMessage.success(`已批量删除 ${data.count} 条数据`)
      await reload()
    } catch (error) {
      ElMessage.error(extractErrorMessage(error))
    } finally {
      batchSaving.value = false
    }
  }

  return {
    importVisible,
    exportVisible,
    exportMode,
    exportLoading,
    batchEditVisible,
    batchSaving,
    openImport,
    downloadImportTemplate,
    precheckImport,
    executeImport,
    openExport,
    handleExport,
    openBatchEdit,
    handleBatchEdit,
    batchDeleteSelected,
  }
}
