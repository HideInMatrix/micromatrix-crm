<script setup lang="ts">
import { type DepartmentVO, type FieldVO, type FilterCondition } from '@micromatrix/shared'
import { computed, ref, watch } from 'vue'
import type { MemberOption } from '@/api/system'
import FilterConditionEditor from './FilterConditionEditor.vue'

defineProps<{
  fields: FieldVO[]
  members: MemberOption[]
  deptTree: DepartmentVO[]
}>()

const emit = defineEmits<{ apply: [conditions: FilterCondition[]] }>()
const model = defineModel<FilterCondition[]>({ default: () => [] })

const visible = ref(false)
const conditions = ref<FilterCondition[]>(model.value.map((condition) => ({ ...condition })))

const activeCount = computed(() => model.value.length)
const editorRef = ref<InstanceType<typeof FilterConditionEditor>>()

watch(visible, (open) => {
  if (open) conditions.value = model.value.map((condition) => ({ ...condition }))
})

watch(
  model,
  (value) => {
    if (!visible.value) conditions.value = value.map((condition) => ({ ...condition }))
  },
  { deep: true },
)

function apply() {
  const valid = editorRef.value?.getValidConditions() ?? []
  conditions.value = valid
  model.value = valid.map((condition) => ({ ...condition }))
  emit('apply', valid)
  visible.value = false
}

function reset() {
  conditions.value = []
  model.value = []
  emit('apply', [])
  visible.value = false
}
</script>

<template>
  <el-popover v-model:visible="visible" placement="bottom-start" width="640" trigger="click">
    <template #reference>
      <el-badge :value="activeCount" :hidden="activeCount === 0" type="primary">
        <el-button>高级筛选</el-button>
      </el-badge>
    </template>

    <div class="space-y-2">
      <FilterConditionEditor
        ref="editorRef"
        v-model="conditions"
        :fields="fields"
        :members="members"
        :dept-tree="deptTree"
      />
      <div class="flex-between pt-2 border-t border-[var(--el-border-color-lighter)]">
        <div />
        <div class="flex gap-2">
          <el-button size="small" @click="reset">清空</el-button>
          <el-button size="small" type="primary" @click="apply">应用</el-button>
        </div>
      </div>
    </div>
  </el-popover>
</template>
