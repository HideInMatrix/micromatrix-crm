import type { FieldVO } from '@micromatrix/shared'
import { defineStore } from 'pinia'
import { ref, toRaw } from 'vue'

export interface MobileSearchSelectContext {
  draftKey: string
  field: FieldVO
  selectedIds: string[]
}

function clone<T>(value: T): T {
  return structuredClone(toRaw(value))
}

function selectedIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && Boolean(item))
  }
  return typeof value === 'string' && value ? [value] : []
}

export const useSearchSelectStore = defineStore('search-select', () => {
  const context = ref<MobileSearchSelectContext | null>(null)
  const drafts = ref<Record<string, Record<string, unknown>>>({})

  function begin(draftKey: string, field: FieldVO, model: Record<string, unknown>) {
    drafts.value[draftKey] = clone(model)
    context.value = {
      draftKey,
      field: clone(field),
      selectedIds: selectedIds(model[field.key]),
    }
  }

  function confirm(ids: string[]) {
    const current = context.value
    if (!current) return
    const draft = drafts.value[current.draftKey]
    if (draft) {
      draft[current.field.key] =
        current.field.type === 'data_source_multiple' ? [...ids] : ids[0]
    }
    context.value = null
  }

  function cancel() {
    context.value = null
  }

  function takeDraft(draftKey: string) {
    const draft = drafts.value[draftKey]
    if (!draft) return null
    delete drafts.value[draftKey]
    if (context.value?.draftKey === draftKey) context.value = null
    return draft
  }

  function clearDraft(draftKey: string) {
    delete drafts.value[draftKey]
    if (context.value?.draftKey === draftKey) context.value = null
  }

  return { context, begin, confirm, cancel, takeDraft, clearDraft }
})

