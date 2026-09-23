<script setup lang="ts">
import type { ContactVO, FieldVO } from '@micromatrix/shared'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showFailToast } from 'vant'
import { extractErrorMessage } from '@/api/http'
import { fetchFields } from '@/api/mobile'
import { contactApi } from '@/api/sales'
import { formatFieldValue } from '@/components/form-engine/field-display'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const fieldRefs = useFieldRefs()

const contactId = computed(() => String(route.query.id ?? ''))
const loading = ref(false)
const contact = ref<ContactVO | null>(null)
const fields = ref<FieldVO[]>([])

const descriptionFields = computed(() =>
  fields.value.filter((field) => !field.hidden && field.mobile !== false),
)

function displayField(field: FieldVO) {
  if (!contact.value) return '-'
  if (field.key === 'customerId') return contact.value.customerName ?? '-'
  return formatFieldValue(field, contact.value as unknown as Record<string, unknown>, {
    memberMap: fieldRefs.memberMap.value,
    deptMap: fieldRefs.deptMap.value,
  })
}

async function load() {
  if (!contactId.value) {
    router.replace({ path: '/customers', query: { tab: 'contact' } })
    return
  }

  loading.value = true
  try {
    const [detailRes, fieldRes] = await Promise.all([
      contactApi.get(contactId.value),
      fetchFields('contact'),
      fieldRefs.load(),
    ])
    contact.value = detailRes.data
    fields.value = [...fieldRes.data].sort((a, b) => a.sort - b.sort)
  } catch (error) {
    showFailToast(extractErrorMessage(error))
    router.replace({ path: '/customers', query: { tab: 'contact' } })
  } finally {
    loading.value = false
  }
}

function edit() {
  router.push('/contacts/' + contactId.value + '/edit')
}

onMounted(load)
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-[var(--mobile-page-background)]">
    <van-loading v-if="loading" class="!flex !justify-center !py-16" />

    <template v-else-if="contact">
      <div class="min-h-0 flex-1 overflow-auto pb-4">
        <van-cell-group inset class="!mt-4">
          <van-cell
            v-for="field in descriptionFields"
            :key="field.id"
            :title="field.label"
            :value="displayField(field)"
          />
        </van-cell-group>

        <van-cell-group v-if="descriptionFields.length === 0" inset class="!mt-4">
          <van-cell title="联系人" :value="contact.name" />
          <van-cell title="客户" :value="contact.customerName ?? '-'" />
          <van-cell title="手机号" :value="contact.phone ?? '-'" />
          <van-cell title="负责人" :value="contact.ownerName ?? '-'" />
        </van-cell-group>
      </div>

      <div
        v-if="auth.hasPerm('contact:update')"
        class="shrink-0 border-t-[0.5px] border-[var(--text-n8)] bg-[var(--text-n10)] p-4 pb-[calc(16px+env(safe-area-inset-bottom))]"
      >
        <van-button type="primary" block @click="edit">编辑联系人</van-button>
      </div>
    </template>
  </div>
</template>
