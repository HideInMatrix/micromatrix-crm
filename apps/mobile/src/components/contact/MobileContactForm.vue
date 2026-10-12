<script setup lang="ts">
import type { DepartmentVO, FieldVO, ModuleFormProp } from '@micromatrix/shared'
import type { FormInstance } from 'vant'
import { computed, ref } from 'vue'
import MobileDynamicForm from '@/components/MobileDynamicForm.vue'

const props = defineProps<{
  fields: FieldVO[]
  formProp?: ModuleFormProp
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

const customerColumns = computed(() =>
  props.customerOptions.map((item) => ({ text: item.name, value: item.id })),
)
const selectedCustomerName = computed(
  () => props.customerOptions.find((item) => item.id === model.value.customerId)?.name ?? '',
)

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
    <MobileDynamicForm
      v-model="model"
      :fields="fields"
      :form-prop="formProp"
      :members="members"
      :dept-tree="deptTree"
      @search-select="emit('search-select', $event)"
    >
      <template #customer-field="{ field }">
        <van-field
          :model-value="selectedCustomerName"
          name="customerId"
          :label="field.label"
          :placeholder="`请选择${field.label}`"
          :required="field.required"
          :rules="field.required ? [{ required: true, message: '请选择' + field.label }] : []"
          readonly
          is-link
          @click="customerPickerShow = true"
        />
      </template>
    </MobileDynamicForm>
  </van-form>

  <van-popup v-model:show="customerPickerShow" position="bottom" round>
    <van-picker
      :columns="customerColumns"
      @confirm="selectCustomer"
      @cancel="customerPickerShow = false"
    />
  </van-popup>
</template>
