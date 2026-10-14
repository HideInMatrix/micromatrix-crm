<script setup lang="ts">
import { type ContactVO, type FieldVO } from '@micromatrix/shared'
import { computed, onMounted, ref, watch } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import { contactApi } from '@/api/sales'
import { formatFieldValue } from '@/components/form-engine/field-display'
import { useFieldRefs } from '@/composables/useFieldRefs'

const props = defineProps<{
  customerId: string
  admissions?: boolean
  refreshKey?: number
}>()

const fieldRefs = useFieldRefs()
const fields = ref<FieldVO[]>([])
const contacts = ref<ContactVO[]>([])
const loading = ref(false)

const listFields = computed(() => {
  const configured = fields.value.filter(
    (field) => field.showInList && !field.hidden && field.key !== 'customerId',
  )
  return configured.length
    ? configured
    : fields.value.filter(
        (field) => !field.hidden && ['name', 'phone', 'owner', 'enable'].includes(field.key),
      )
})
const tableMinWidth = computed(() =>
  listFields.value.reduce((sum, field) => sum + (field.listWidth ?? 110), 0),
)

function displayValue(field: FieldVO, contact: ContactVO) {
  if (field.key === 'owner') return contact.ownerName ?? '-'
  return formatFieldValue(field, contact as unknown as Record<string, unknown>, {
    memberMap: fieldRefs.memberMap.value,
    deptMap: fieldRefs.deptMap.value,
  })
}

async function load() {
  if (!props.customerId) return
  loading.value = true
  try {
    const { data } = await contactApi.list(props.customerId)
    contacts.value = data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

defineExpose({ refresh: load })

watch(() => [props.customerId, props.refreshKey], load)

onMounted(async () => {
  try {
    const [{ data }] = await Promise.all([metadataApi.formConfig('contact'), fieldRefs.load()])
    fields.value = data.fields
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
})
</script>

<template>
  <div v-loading="loading" class="min-w-0">
    <h3
      class="m-0 mb-[13px] flex items-center gap-[6px] text-[14px] leading-5 font-medium text-[#333333]"
    >
      <span
        aria-hidden="true"
        class="h-4 w-[3px] shrink-0 rounded-[4px] bg-[var(--el-color-primary)]"
      />
      {{ admissions ? '家长联系人' : '联系人' }}
    </h3>

    <div class="max-w-full overflow-x-auto">
      <table
        class="w-full border-collapse text-left text-[14px]"
        :style="{ minWidth: `${tableMinWidth}px` }"
      >
        <thead class="bg-[#F5F7FA] text-[14px] text-[#606266]">
          <tr class="h-[44px]">
            <th
              v-for="field in listFields"
              :key="field.id"
              scope="col"
              class="h-[44px] whitespace-nowrap px-[14px] py-0 align-middle font-normal"
              :style="{ minWidth: `${field.listWidth ?? 110}px` }"
            >
              {{ field.label }}
            </th>
          </tr>
        </thead>
        <tbody class="bg-[#FFFFFF] text-[14px] text-[#333333]">
          <tr
            v-for="contact in contacts"
            :key="contact.id"
            class="h-[44px] border-b border-[#E9EDF2]"
          >
            <td
              v-for="field in listFields"
              :key="field.id"
              class="h-[44px] px-[14px] py-0 align-middle"
            >
              <span class="block max-w-[220px] truncate" :title="displayValue(field, contact)">
                {{ displayValue(field, contact) }}
              </span>
            </td>
          </tr>
          <tr v-if="!loading && contacts.length === 0" class="h-[44px]">
            <td
              :colspan="Math.max(listFields.length, 1)"
              class="h-[44px] py-0 text-center text-[#999999]"
            >
              暂无联系人
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p
      v-if="admissions"
      class="m-0 mt-[16px] rounded-[8px] border border-dashed border-[#DDDDDD] bg-[#F6F8FC] px-4 py-[10px] text-[14px] leading-[1.7] text-[#333333]"
    >
      <span class="block">学员 = 学生本人（姓名与学籍信息），</span>
      <span class="block">联系方式全部挂在家长联系人下，支持父/母多方同时维护。</span>
    </p>
  </div>
</template>
