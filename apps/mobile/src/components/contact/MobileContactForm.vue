<script setup lang="ts">
import type { DepartmentVO, FieldVO } from '@micromatrix/shared'
import type { FormInstance } from 'vant'
import { computed, ref } from 'vue'
import MobileDynamicForm from '@/components/MobileDynamicForm.vue'

const props = defineProps<{
  fields: FieldVO[]
  members: Array<{ id: string; name: string }>
  deptTree: DepartmentVO[]
  customerOptions: Array<{ id: string; name: string }>
}>()
const emit = defineEmits<{
  (event: 'search-select', field: FieldVO): void
}>()

const model = defineModel<Record<string, unknown>>({ required: true })
const formRef = ref<FormInstance>()
const customerPickerShow = ref(false)

const customerField = computed(() => props.fields.find((field) => field.key === 'customerId'))
const customerColumns = computed(() =>
  props.customerOptions.map((item) => ({ text: item.name, value: item.id })),
)
const selectedCustomerName = computed(
  () =>
    props.customerOptions.find((item) => item.id === model.value.customerId)?.name ??
    '请选择',
)

function fieldFilter(field: FieldVO) {
  return field.key !== 'customerId'
}

function selectCustomer({ selectedValues }: { selectedValues: string[] }) {
  model.value.customerId = selectedValues[0] ?? ''
  customerPickerShow.value = false
}

async function validate() {
  await formRef.value?.validate()
}

defineExpose({ validate })
</script>

<template>
  <van-empty
    v-if="fields.length === 0"
    image-size="64"
    description="当前联系人模块未配置可用表单字段"
    class="!py-10"
  />
  <van-form v-else ref="formRef" required="auto">
    <van-cell-group v-if="customerField">
      <van-field
        :model-value="selectedCustomerName"
        name="customerId"
        :label="customerField.label"
        :required="customerField.required"
        :rules="
          customerField.required
            ? [{ required: true, message: '请选择' + customerField.label }]
            : undefined
        "
        readonly
        is-link
        @click="customerPickerShow = true"
      />
    </van-cell-group>

    <MobileDynamicForm
      v-model="model"
      :fields="fields"
      :members="members"
      :dept-tree="deptTree"
      :field-filter="fieldFilter"
      @search-select="emit('search-select', $event)"
    />
  </van-form>

  <van-popup v-model:show="customerPickerShow" position="bottom" round>
    <van-picker
      :columns="customerColumns"
      @confirm="selectCustomer"
      @cancel="customerPickerShow = false"
    />
  </van-popup>
</template>

