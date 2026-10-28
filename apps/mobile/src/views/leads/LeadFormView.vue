<script setup lang="ts">
import type { FieldVO } from '@micromatrix/shared'
import { computed, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import MobileLeadForm from '@/components/lead/MobileLeadForm.vue'
import { useLeadForm } from '@/composables/useLeadForm'
import { useSearchSelectStore } from '@/stores/search-select'

const route = useRoute()
const router = useRouter()
const searchSelect = useSearchSelectStore()
const leadId = computed(() =>
  typeof route.params.id === 'string' && route.params.id ? route.params.id : undefined,
)
const form = useLeadForm(leadId)
const leadFormRef = ref<InstanceType<typeof MobileLeadForm> | null>(null)
const draftKey = computed(() => (leadId.value ? 'lead-edit:' + leadId.value : 'lead-create'))
const createMode = computed(() => !form.editing.value)
async function cancel() {
  searchSelect.clearDraft(draftKey.value)
  await router.back()
}

async function submit() {
  try {
    await leadFormRef.value?.validate()
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

watch(leadId, initialize, { immediate: true })

onBeforeRouteLeave((to) => {
  if (to.name !== 'mobile-search-select') searchSelect.clearDraft(draftKey.value)
})
</script>

<template>
  <div
    class="flex h-full min-h-0 flex-col overflow-hidden"
    :class="createMode ? 'bg-[#F5F5F5]' : 'bg-[var(--text-n10)]'"
  >
    <div class="min-h-0 flex-1 overflow-y-auto" :class="createMode ? 'pb-[20px]' : 'py-4'">
      <van-loading v-if="form.loading.value" class="!flex !justify-center !py-10" />
      <template v-else>
        <div>
          <MobileLeadForm
            ref="leadFormRef"
            v-model="form.model.value"
            :appearance="createMode ? 'create' : 'default'"
            :fields="form.fields.value"
            :form-prop="form.formProp.value"
            :members="form.fieldRefs.members.value"
            :dept-tree="form.fieldRefs.deptTree.value"
            @search-select="openSearchSelect"
          />
        </div>
      </template>
    </div>

    <div
      v-if="createMode"
      class="shrink-0 border-t-[0.5px] border-[#EAEAEA] bg-white px-[20px] pt-[8px] pb-[calc(8px+env(safe-area-inset-bottom))]"
      style="
        --van-button-default-height: 44px;
        --van-button-border-radius: 8px;
        --van-button-normal-font-size: 17px;
      "
    >
      <van-button type="primary" block :loading="form.saving.value" @click="submit">
        保存线索
      </van-button>
    </div>
    <div
      v-else
      class="flex shrink-0 gap-4 border-t-[0.5px] border-[var(--text-n8)] bg-[var(--text-n10)] p-4 pb-[calc(16px+env(safe-area-inset-bottom))]"
    >
      <van-button block :disabled="form.saving.value" @click="cancel">取消</van-button>
      <van-button type="primary" block :loading="form.saving.value" @click="submit">
        {{ form.submitText.value }}
      </van-button>
    </div>
  </div>
</template>
