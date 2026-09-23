<script setup lang="ts">
import type { FieldVO } from '@micromatrix/shared'
import { computed, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import MobileContactForm from '@/components/contact/MobileContactForm.vue'
import { useContactForm } from '@/composables/useContactForm'
import { useSearchSelectStore } from '@/stores/search-select'

const route = useRoute()
const router = useRouter()
const searchSelect = useSearchSelectStore()
const contactId = computed(() =>
  typeof route.params.id === 'string' && route.params.id ? route.params.id : undefined,
)
const form = useContactForm(contactId)
const contactFormRef = ref<InstanceType<typeof MobileContactForm> | null>(null)
const draftKey = computed(() =>
  contactId.value ? 'contact-edit:' + contactId.value : 'contact-create',
)

async function cancel() {
  searchSelect.clearDraft(draftKey.value)
  await router.back()
}

async function submit() {
  try {
    await contactFormRef.value?.validate()
  } catch {
    return
  }
  if (await form.save()) {
    searchSelect.clearDraft(draftKey.value)
    await router.back()
  }
}

async function openSearchSelect(field: FieldVO) {
  searchSelect.begin(draftKey.value, field, form.model.value)
  await router.push('/select/search')
}

async function initialize() {
  try {
    await form.init()
    const draft = searchSelect.takeDraft(draftKey.value)
    if (draft) form.model.value = draft
  } catch {
    router.back()
  }
}

watch(contactId, initialize, { immediate: true })

onBeforeRouteLeave((to) => {
  if (to.name !== 'mobile-search-select') searchSelect.clearDraft(draftKey.value)
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-[var(--text-n10)]">
    <div class="min-h-0 flex-1 overflow-auto bg-[var(--text-n10)] py-4">
      <van-loading v-if="form.loading.value" class="!flex !justify-center !py-10" />
      <MobileContactForm
        v-else
        ref="contactFormRef"
        v-model="form.model.value"
        :fields="form.fields.value"
        :members="form.fieldRefs.members.value"
        :dept-tree="form.fieldRefs.deptTree.value"
        :customer-options="form.customerOptions.value"
        @search-select="openSearchSelect"
      />
    </div>

    <div
      class="flex shrink-0 gap-4 border-t-[0.5px] border-[var(--text-n8)] bg-[var(--text-n10)] p-4 pb-[calc(16px+env(safe-area-inset-bottom))]"
    >
      <van-button block :disabled="form.saving.value" @click="cancel">取消</van-button>
      <van-button type="primary" block :loading="form.saving.value" @click="submit">
        {{ form.submitText.value }}
      </van-button>
    </div>
  </div>
</template>
