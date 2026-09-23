<script setup lang="ts">
import type { DepartmentVO, FieldVO } from '@micromatrix/shared'
import type { FormInstance } from 'vant'
import { ref } from 'vue'
import MobileDynamicForm from '@/components/MobileDynamicForm.vue'

defineProps<{
  fields: FieldVO[]
  members: Array<{ id: string; name: string }>
  deptTree: DepartmentVO[]
}>()
const emit = defineEmits<{
  (event: 'search-select', field: FieldVO): void
}>()

const model = defineModel<Record<string, unknown>>({ required: true })
const formRef = ref<FormInstance>()

async function validate() {
  await formRef.value?.validate()
}

defineExpose({ validate })
</script>

<template>
  <van-empty
    v-if="fields.length === 0"
    image-size="64"
    description="当前客户模块未配置可用表单字段"
    class="!py-10"
  />
  <van-form v-else ref="formRef" required="auto">
    <MobileDynamicForm
      v-model="model"
      :fields="fields"
      :members="members"
      :dept-tree="deptTree"
      @search-select="emit('search-select', $event)"
    />
  </van-form>
</template>
