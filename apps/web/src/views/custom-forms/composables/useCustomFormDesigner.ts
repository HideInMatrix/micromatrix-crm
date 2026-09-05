import type { CustomFormDetailVO, FieldVO } from '@micromatrix/shared'
import { ref } from 'vue'
import { customFormApi } from '@/api/custom-form'
import { extractErrorMessage } from '@/api/http'
import type { FieldForm } from '@/api/metadata'

export type CustomFormConfigTab = 'design' | 'permission'

export function useCustomFormDesigner(onFormChanged: (formId: string) => Promise<void>) {
  const visible = ref(false)
  const loading = ref(false)
  const saving = ref(false)
  const tab = ref<CustomFormConfigTab>('design')
  const detail = ref<CustomFormDetailVO | null>(null)
  const fields = ref<FieldVO[]>([])
  const fieldDialogVisible = ref(false)
  const fieldSaving = ref(false)
  const editingField = ref<FieldVO | null>(null)

  async function open(id: string, targetTab: CustomFormConfigTab) {
    visible.value = true
    tab.value = targetTab
    loading.value = true
    try {
      const { data } = await customFormApi.detail(id)
      detail.value = data
      fields.value = data.fields.map((field) => ({ ...field }))
      return true
    } catch (error) {
      ElMessage.error(extractErrorMessage(error))
      visible.value = false
      return false
    } finally {
      loading.value = false
    }
  }

  async function saveBase() {
    const current = detail.value
    if (!current?.name.trim()) {
      ElMessage.warning('表单名称不能为空')
      return
    }
    saving.value = true
    try {
      const { data } = await customFormApi.update(current.id, {
        name: current.name.trim(),
        enable: current.enable,
        formProp: current.formProp,
      })
      detail.value = data
      ElMessage.success('表单设置已保存')
      await onFormChanged(current.id)
    } catch (error) {
      ElMessage.error(extractErrorMessage(error))
    } finally {
      saving.value = false
    }
  }

  async function reloadFields() {
    const id = detail.value?.id
    if (!id) return
    const { data } = await customFormApi.config(id)
    fields.value = data.fields
    if (detail.value) detail.value.fields = data.fields
  }

  function openFieldCreate() {
    editingField.value = null
    fieldDialogVisible.value = true
  }

  function openFieldEdit(field: FieldVO) {
    editingField.value = field
    fieldDialogVisible.value = true
  }

  async function saveField(payload: FieldForm) {
    const id = detail.value?.id
    if (!id) return
    fieldSaving.value = true
    try {
      if (editingField.value) {
        await customFormApi.updateField(id, editingField.value.id, payload)
      } else {
        await customFormApi.createField(id, payload)
      }
      await reloadFields()
      fieldDialogVisible.value = false
      ElMessage.success(editingField.value ? '字段已更新' : '字段已创建')
    } catch (error) {
      ElMessage.error(extractErrorMessage(error))
    } finally {
      fieldSaving.value = false
    }
  }

  async function removeField(field: FieldVO) {
    const id = detail.value?.id
    if (!id || field.system) return
    const confirmed = await ElMessageBox.confirm(
      `删除字段「${field.label}」会同时删除已保存的字段值，且无法恢复。`,
      '删除字段',
      { type: 'warning' },
    ).catch(() => false)
    if (!confirmed) return
    try {
      await customFormApi.removeField(id, field.id)
      await reloadFields()
      ElMessage.success('字段已删除')
    } catch (error) {
      ElMessage.error(extractErrorMessage(error))
    }
  }

  async function reorderFields() {
    const id = detail.value?.id
    if (!id) return
    try {
      await customFormApi.reorderFields(
        id,
        fields.value.map((field) => field.id),
      )
    } catch (error) {
      ElMessage.error(extractErrorMessage(error))
      await reloadFields()
    }
  }

  return {
    visible,
    loading,
    saving,
    tab,
    detail,
    fields,
    fieldDialogVisible,
    fieldSaving,
    editingField,
    open,
    saveBase,
    reloadFields,
    openFieldCreate,
    openFieldEdit,
    saveField,
    removeField,
    reorderFields,
  }
}
