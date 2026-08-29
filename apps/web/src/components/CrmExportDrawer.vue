<script setup lang="ts">
import type { FieldVO } from '@micromatrix/shared'
import { computed, ref, watch } from 'vue'

export interface ExportDisplayField {
  key: string
  label: string
}

const props = defineProps<{
  moduleLabel: string
  cacheKey: string
  fields: FieldVO[]
  displayFields?: ExportDisplayField[]
  mode: 'all' | 'selected'
  selectedCount?: number
  loading?: boolean
}>()

const emit = defineEmits<{
  confirm: [payload: { fileName: string; headList: string[] }]
}>()

const visible = defineModel<boolean>({ required: true })
const fileName = ref('')
const selectedKeys = ref<string[]>([])
const dragIndex = ref<number | null>(null)

const systemFields = computed<ExportDisplayField[]>(() =>
  props.fields
    .filter((field) => !field.hidden && field.system && field.type !== 'picture')
    .map((field) => ({ key: field.key, label: field.label })),
)
const customFields = computed<ExportDisplayField[]>(() =>
  props.fields
    .filter(
      (field) =>
        !field.hidden && !field.system && !['formula', 'picture'].includes(field.type),
    )
    .map((field) => ({ key: field.key, label: field.label })),
)
const showFields = computed(() => props.displayFields ?? [])
const allFields = computed(() => [...systemFields.value, ...customFields.value, ...showFields.value])
const fieldMap = computed(() => new Map(allFields.value.map((field) => [field.key, field])))
const selectedFields = computed(() =>
  selectedKeys.value.map((key) => fieldMap.value.get(key)).filter((field): field is ExportDisplayField => !!field),
)

watch(visible, (show) => {
  if (!show) return
  const now = new Date()
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('')
  fileName.value = `${stamp}-${props.moduleLabel}`
  const available = new Set(allFields.value.map((field) => field.key))
  const cached = JSON.parse(localStorage.getItem(`mmx-export:${props.cacheKey}`) ?? '[]') as string[]
  const validCached = cached.filter((key) => available.has(key))
  selectedKeys.value = validCached.length
    ? validCached
    : props.fields.filter((field) => field.showInList && !field.hidden).map((field) => field.key)
  if (selectedKeys.value.length === 0) selectedKeys.value = allFields.value.map((field) => field.key)
})

function toggleField(key: string, checked: boolean) {
  if (checked) {
    if (!selectedKeys.value.includes(key)) selectedKeys.value.push(key)
  } else {
    selectedKeys.value = selectedKeys.value.filter((item) => item !== key)
  }
}

function toggleGroup(fields: ExportDisplayField[], checked: boolean) {
  const keys = new Set(fields.map((field) => field.key))
  if (checked) {
    for (const field of fields) if (!selectedKeys.value.includes(field.key)) selectedKeys.value.push(field.key)
  } else {
    selectedKeys.value = selectedKeys.value.filter((key) => !keys.has(key))
  }
}

function groupChecked(fields: ExportDisplayField[]) {
  return fields.length > 0 && fields.every((field) => selectedKeys.value.includes(field.key))
}

function handleDrop(index: number) {
  if (dragIndex.value === null || dragIndex.value === index) return
  const list = [...selectedKeys.value]
  const [item] = list.splice(dragIndex.value, 1)
  list.splice(index, 0, item)
  selectedKeys.value = list
  dragIndex.value = null
}

function handleConfirm() {
  const name = fileName.value.trim().replace(/\.xlsx$/i, '')
  if (!name) {
    ElMessage.warning('请输入导出文件名')
    return
  }
  if (!selectedKeys.value.length) {
    ElMessage.warning('请至少选择一个导出字段')
    return
  }
  localStorage.setItem(`mmx-export:${props.cacheKey}`, JSON.stringify(selectedKeys.value))
  emit('confirm', { fileName: name, headList: selectedKeys.value })
}
</script>

<template>
  <el-drawer v-model="visible" title="导出" size="800px" destroy-on-close>
    <el-alert
      v-if="mode === 'selected'"
      :title="`将导出当前选中的 ${selectedCount ?? 0} 条${moduleLabel}数据`"
      type="info"
      :closable="false"
      class="mb-4"
    />

    <el-form label-position="left" label-width="80px" class="mb-4">
      <el-form-item label="名称" required>
        <el-input v-model="fileName" maxlength="50">
          <template #append>.xlsx</template>
        </el-input>
        <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
          导出文件会进入“导出任务”，24 小时内可下载。
        </div>
      </el-form-item>
    </el-form>

    <div class="grid grid-cols-2 min-h-[430px] border border-[var(--el-border-color)] rounded overflow-hidden">
      <div class="border-r border-[var(--el-border-color)] overflow-auto">
        <div class="px-4 py-3 font-semibold bg-[var(--el-fill-color-light)]">选择字段</div>

        <div
          v-for="group in [
            { title: '系统字段', items: systemFields },
            { title: '表单字段', items: customFields },
            { title: '展示字段', items: showFields },
          ]"
          v-show="group.items.length"
          :key="group.title"
          class="border-t border-[var(--el-border-color-lighter)]"
        >
          <div class="flex-between px-4 py-2 bg-[var(--el-fill-color-lighter)]">
            <span class="text-sm font-medium">{{ group.title }}</span>
            <el-checkbox
              :model-value="groupChecked(group.items)"
              @change="(checked) => toggleGroup(group.items, Boolean(checked))"
            >全选</el-checkbox>
          </div>
          <div class="px-4 py-2 grid grid-cols-2 gap-y-2">
            <el-checkbox
              v-for="field in group.items"
              :key="field.key"
              :model-value="selectedKeys.includes(field.key)"
              @change="(checked) => toggleField(field.key, Boolean(checked))"
            >
              {{ field.label }}
            </el-checkbox>
          </div>
        </div>
      </div>

      <div class="flex flex-col overflow-hidden">
        <div class="flex-between px-4 py-3 bg-[var(--el-fill-color-light)]">
          <span class="font-semibold">已选字段 <span class="font-normal text-[var(--el-text-color-secondary)]">({{ selectedFields.length }})</span></span>
          <el-button link type="primary" @click="selectedKeys = []">清空</el-button>
        </div>
        <div class="p-4 overflow-auto flex-1">
          <div
            v-for="(field, index) in selectedFields"
            :key="field.key"
            draggable="true"
            class="mb-2 flex-between rounded bg-[var(--el-fill-color-light)] px-3 py-2 cursor-move"
            @dragstart="dragIndex = index"
            @dragover.prevent
            @drop="handleDrop(index)"
          >
            <div class="flex items-center gap-2">
              <span class="text-xs text-[var(--el-text-color-placeholder)]">拖动</span>
              <span>{{ field.label }}</span>
            </div>
            <el-button link @click.stop="toggleField(field.key, false)">移除</el-button>
          </div>
          <el-empty v-if="!selectedFields.length" description="请从左侧选择导出字段" :image-size="72" />
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="loading" @click="handleConfirm">导出</el-button>
    </template>
  </el-drawer>
</template>
