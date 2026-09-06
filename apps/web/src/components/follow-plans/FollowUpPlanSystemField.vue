<script setup lang="ts">
import type { FieldVO, FollowUpPlanTargetType } from '@micromatrix/shared'
import { computed } from 'vue'
import type { MemberOption } from '@/api/system'

interface TargetOption {
  id: string
  name: string
}

const props = defineProps<{
  field: FieldVO
  modelValue: unknown
  targetType: FollowUpPlanTargetType
  targetLocked: boolean
  readonly: boolean
  loadingTargets: boolean
  targets: TargetOption[]
  contacts: TargetOption[]
  members: MemberOption[]
}>()

const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>()

function update(value: unknown) {
  emit('update:modelValue', value)
}

const stringValue = computed(() => (typeof props.modelValue === 'string' ? props.modelValue : ''))
</script>

<template>
  <el-select
    v-if="field.key === 'targetType'"
    :model-value="stringValue"
    :disabled="targetLocked || readonly"
    class="w-full"
    @update:model-value="update"
  >
    <el-option
      v-for="option in field.options ?? []"
      :key="option.value"
      :label="option.label"
      :value="option.value"
    />
  </el-select>

  <el-select
    v-else-if="field.key === 'targetId'"
    :model-value="stringValue"
    data-testid="follow-plan-target-select"
    :loading="loadingTargets"
    :disabled="targetLocked || readonly"
    filterable
    class="w-full"
    placeholder="请选择业务对象"
    @update:model-value="update"
  >
    <el-option v-for="item in targets" :key="item.id" :label="item.name" :value="item.id" />
  </el-select>

  <el-select
    v-else-if="field.key === 'contactId'"
    :model-value="stringValue"
    :disabled="readonly"
    clearable
    filterable
    class="w-full"
    placeholder="可选"
    @update:model-value="update"
  >
    <el-option v-for="item in contacts" :key="item.id" :label="item.name" :value="item.id" />
  </el-select>

  <el-date-picker
    v-else-if="field.key === 'estimatedAt'"
    :model-value="stringValue"
    :disabled="readonly"
    type="datetime"
    value-format="YYYY-MM-DDTHH:mm:ss.SSSZ"
    class="!w-full"
    placeholder="可选"
    @update:model-value="update"
  />

  <el-select
    v-else-if="field.key === 'method' || field.key === 'status'"
    :model-value="stringValue"
    :disabled="readonly"
    clearable
    class="w-full"
    @update:model-value="update"
  >
    <el-option
      v-for="option in field.options ?? []"
      :key="option.value"
      :label="option.label"
      :value="option.value"
    />
  </el-select>

  <el-select
    v-else-if="field.key === 'ownerId'"
    :model-value="stringValue"
    :disabled="readonly"
    clearable
    filterable
    class="w-full"
    placeholder="默认当前用户"
    @update:model-value="update"
  >
    <el-option v-for="item in members" :key="item.id" :label="item.name" :value="item.id" />
  </el-select>

  <el-input
    v-else-if="field.key === 'content'"
    :model-value="stringValue"
    data-testid="follow-plan-content"
    :disabled="readonly"
    type="textarea"
    :rows="4"
    maxlength="3000"
    show-word-limit
    @update:model-value="update"
  />

  <el-input
    v-else
    :model-value="stringValue"
    :disabled="readonly"
    @update:model-value="update"
  />
</template>
