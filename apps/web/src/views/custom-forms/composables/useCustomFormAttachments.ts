import type {
  AttachmentVO,
  CustomFormDataDetailVO,
  CustomFormDataVO,
  FieldVO,
} from '@micromatrix/shared'
import { ref, type Ref } from 'vue'
import { attachmentApi } from '@/api/attachments'
import { customFormApi } from '@/api/custom-form'

export function useCustomFormAttachments(
  activeFormId: Ref<string>,
  editingData: Readonly<Ref<CustomFormDataVO | null>>,
  fields: Ref<FieldVO[]> | Readonly<Ref<FieldVO[]>>,
  values: Ref<Record<string, unknown>>,
) {
  const attachmentMap = ref<Record<string, AttachmentVO[]>>({})
  const initialAttachmentIds = ref<Set<string>>(new Set())
  const committed = ref(false)

  function resetForCreate() {
    attachmentMap.value = {}
    initialAttachmentIds.value = new Set()
    committed.value = false
  }

  function loadFromData(data: CustomFormDataDetailVO) {
    attachmentMap.value = data.attachmentMap
    initialAttachmentIds.value = new Set(
      Object.values(data.attachmentMap).flatMap((files) => files.map((file) => file.id)),
    )
    committed.value = false
  }

  function markCommitted() {
    committed.value = true
  }

  function currentAttachmentIds() {
    const ids = new Set<string>()
    for (const field of fields.value) {
      if (field.type !== 'attachment') continue
      const value = values.value[field.key]
      if (!Array.isArray(value)) continue
      for (const id of value) if (typeof id === 'string' && id) ids.add(id)
    }
    return ids
  }

  async function cleanupTemporaryAttachments() {
    const pending = [...currentAttachmentIds()].filter((id) => !initialAttachmentIds.value.has(id))
    await Promise.all(pending.map((id) => attachmentApi.remove(id).catch(() => undefined)))
  }

  async function beforeClose(done: () => void) {
    if (!committed.value) await cleanupTemporaryAttachments()
    done()
  }

  function download(file: AttachmentVO) {
    if (!activeFormId.value || !editingData.value || !file.targetType) {
      return attachmentApi.download(file.id, file.name)
    }
    return customFormApi.downloadDataAttachment(
      activeFormId.value,
      editingData.value.id,
      file.id,
      file.name,
    )
  }

  return {
    attachmentMap,
    committed,
    resetForCreate,
    loadFromData,
    markCommitted,
    cleanupTemporaryAttachments,
    beforeClose,
    download,
  }
}
