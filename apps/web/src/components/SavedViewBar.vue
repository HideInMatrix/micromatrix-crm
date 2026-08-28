<script setup lang="ts">
import type { DepartmentVO, FieldVO, FilterCondition } from '@micromatrix/shared'
import { computed, reactive, ref, watch } from 'vue'
import {
  userViewConditionsToFilters,
  userViewApi,
  type UserViewPayload,
  type UserViewVO,
} from '@/api/user-views'
import type { MemberOption } from '@/api/system'
import { extractErrorMessage } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import FilterConditionEditor from '@/components/form-engine/FilterConditionEditor.vue'

const props = defineProps<{
  module: string
  fields: FieldVO[]
  members: MemberOption[]
  deptTree: DepartmentVO[]
  currentFilters: FilterCondition[]
  defaultColumnKeys: string[]
  systemViews?: { id: string; label: string }[]
  systemView?: string
}>()

const emit = defineEmits<{
  change: [viewId: string | undefined]
  systemViewChange: [viewId: string | undefined]
  clearFilters: []
  columnsChange: [columnKeys: string[]]
  ready: []
}>()

const auth = useAuthStore()
const views = ref<UserViewVO[]>([])
const loading = ref(false)
const activeViewId = ref('')

const formVisible = ref(false)
const formSaving = ref(false)
const formEditorRef = ref<InstanceType<typeof FilterConditionEditor>>()
const editingId = ref<string | null>(null)
const form = reactive<{
  name: string
  searchMode: 'AND' | 'OR'
  conditions: FilterCondition[]
}>({ name: '', searchMode: 'AND', conditions: [] })

const manageVisible = ref(false)
const columnsVisible = ref(false)
const selectedColumnKeys = ref<string[]>([])

const enabledViews = computed(() => views.value.filter((view) => view.enable))
const fixedViews = computed(() => enabledViews.value.filter((view) => view.fixed))
const columnOptions = computed(() =>
  props.fields
    .filter((field) => !field.hidden)
    .map((field) => ({ key: field.key, label: field.label })),
)

function userStorageKey(kind: 'active' | 'columns', viewId?: string) {
  const userId = auth.user?.id ?? 'anonymous'
  return `micromatrix:${kind}:${userId}:${props.module}${viewId ? `:${viewId}` : ''}`
}

function cloneFilters(filters: FilterCondition[]) {
  return filters.map((condition) => ({ ...condition }))
}

async function loadViews(emitChange = true) {
  if (!props.module) return
  loading.value = true
  try {
    const { data } = await userViewApi.list(props.module)
    views.value = data
    const stored = localStorage.getItem(userStorageKey('active')) ?? ''
    const next = data.some((view) => view.id === stored && view.enable) ? stored : ''
    activeViewId.value = next
    loadColumnPreference()
    if (emitChange) {
      emit('change', next || undefined)
      if (next) emit('systemViewChange', undefined)
      else if (props.systemViews?.length) {
        emit('systemViewChange', props.systemView || props.systemViews[0]?.id)
      }
    }
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
    if (emitChange) emit('ready')
  }
}

function selectView(viewId: string) {
  if (!viewId && props.systemViews?.length) {
    selectSystemView(props.systemView || props.systemViews[0]?.id || '')
    return
  }
  activeViewId.value = viewId
  localStorage.setItem(userStorageKey('active'), viewId)
  loadColumnPreference()
  if (viewId) emit('systemViewChange', undefined)
  emit('change', viewId || undefined)
}

function selectSystemView(viewId: string) {
  if (!viewId) return
  activeViewId.value = ''
  localStorage.removeItem(userStorageKey('active'))
  loadColumnPreference()
  emit('change', undefined)
  emit('systemViewChange', viewId)
}

function openCreate(useCurrentFilters = true) {
  editingId.value = null
  form.name = ''
  form.searchMode = 'AND'
  form.conditions = useCurrentFilters ? cloneFilters(props.currentFilters) : []
  formVisible.value = true
}

async function openEdit(view: UserViewVO) {
  try {
    const { data } = await userViewApi.detail(props.module, view.id)
    editingId.value = view.id
    form.name = data.name
    form.searchMode = data.searchMode ?? 'AND'
    form.conditions = userViewConditionsToFilters(data.conditions)
    formVisible.value = true
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function toPayload(): UserViewPayload | null {
  const name = form.name.trim()
  if (!name) {
    ElMessage.warning('请输入视图名称')
    return null
  }
  if (formEditorRef.value?.hasIncompleteCondition()) {
    ElMessage.warning('请补完整筛选条件后再保存')
    return null
  }
  const valid = formEditorRef.value?.getValidConditions() ?? []
  const fieldMap = new Map(props.fields.map((field) => [field.key, field]))
  return {
    name,
    searchMode: form.searchMode,
    conditions: valid.map((condition) => {
      const field = fieldMap.get(condition.key)
      return {
        name: condition.key,
        operator: condition.op,
        value: condition.value,
        type: field?.type,
        multipleValue: field ? ['multiselect', 'checkbox'].includes(field.type) : false,
      }
    }),
  }
}

async function saveView() {
  const payload = toPayload()
  if (!payload) return
  formSaving.value = true
  try {
    if (editingId.value) {
      await userViewApi.update(props.module, editingId.value, payload)
      ElMessage.success('视图已更新')
      formVisible.value = false
      await loadViews(false)
      if (activeViewId.value === editingId.value) emit('change', editingId.value)
    } else {
      const { data } = await userViewApi.create(props.module, payload)
      ElMessage.success('视图已创建')
      formVisible.value = false
      emit('clearFilters')
      await loadViews(false)
      selectView(data.id)
    }
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    formSaving.value = false
  }
}

async function copyView(view: UserViewVO) {
  try {
    const { data } = await userViewApi.detail(props.module, view.id)
    const nameBase = `${data.name} - 副本`
    const existingNames = new Set(views.value.map((item) => item.name))
    let name = nameBase
    let index = 2
    while (existingNames.has(name)) name = `${nameBase} ${index++}`
    await userViewApi.create(props.module, {
      name,
      searchMode: data.searchMode ?? 'AND',
      conditions: (data.conditions ?? []).map((condition) => ({
        name: condition.name,
        operator: condition.operator,
        value: condition.value,
        type: condition.type ?? undefined,
        multipleValue: condition.multipleValue,
        containChildIds: condition.containChildIds,
      })),
    })
    ElMessage.success('视图已复制')
    await loadViews(false)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function removeView(view: UserViewVO) {
  const confirmed = await ElMessageBox.confirm(`删除视图「${view.name}」？`, '删除确认', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await userViewApi.remove(props.module, view.id)
    if (activeViewId.value === view.id) {
      activeViewId.value = ''
      localStorage.removeItem(userStorageKey('active'))
      emit('change', undefined)
      if (props.systemViews?.length) emit('systemViewChange', props.systemViews[0]?.id)
    }
    localStorage.removeItem(userStorageKey('columns', view.id))
    await loadViews(false)
    ElMessage.success('视图已删除')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function toggleFixed(view: UserViewVO) {
  try {
    await userViewApi.toggleFixed(props.module, view.id)
    await loadViews(false)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function toggleEnabled(view: UserViewVO) {
  try {
    await userViewApi.toggleEnabled(props.module, view.id)
    if (activeViewId.value === view.id && view.enable) {
      activeViewId.value = ''
      localStorage.removeItem(userStorageKey('active'))
      emit('change', undefined)
    }
    await loadViews(false)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function moveView(view: UserViewVO, offset: -1 | 1) {
  const index = views.value.findIndex((item) => item.id === view.id)
  const target = index + offset
  if (index < 0 || target < 0 || target >= views.value.length) return
  const ordered = [...views.value]
  const current = ordered[index]
  ordered[index] = ordered[target]
  ordered[target] = current
  try {
    const targetView = views.value[target]
    if (!targetView || !auth.user?.tenantId) return
    await userViewApi.editPos(props.module, {
      orgId: auth.user.tenantId,
      moveId: view.id,
      targetId: targetView.id,
      moveMode: offset === 1 ? 'AFTER' : 'BEFORE',
    })
    await loadViews(false)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function loadColumnPreference() {
  const viewKey = activeViewId.value || '__default__'
  const raw = localStorage.getItem(userStorageKey('columns', viewKey))
  const validKeys = new Set(columnOptions.value.map((item) => item.key))
  let next = props.defaultColumnKeys.filter((key) => validKeys.has(key))
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        const selected = parsed.filter(
          (key): key is string => typeof key === 'string' && validKeys.has(key),
        )
        if (selected.length > 0) next = selected
      }
    } catch {
      // 无效本地偏好直接回退全局字段配置。
    }
  }
  selectedColumnKeys.value = next
  emit('columnsChange', next)
}

function saveColumnPreference() {
  if (selectedColumnKeys.value.length === 0) {
    ElMessage.warning('至少保留一列')
    return
  }
  const viewKey = activeViewId.value || '__default__'
  localStorage.setItem(userStorageKey('columns', viewKey), JSON.stringify(selectedColumnKeys.value))
  emit('columnsChange', [...selectedColumnKeys.value])
  columnsVisible.value = false
}

function moveColumn(key: string, offset: -1 | 1) {
  const index = selectedColumnKeys.value.indexOf(key)
  const target = index + offset
  if (index < 0 || target < 0 || target >= selectedColumnKeys.value.length) return
  const next = [...selectedColumnKeys.value]
  const current = next[index]
  next[index] = next[target]
  next[target] = current
  selectedColumnKeys.value = next
}

function columnLabel(key: string) {
  return columnOptions.value.find((column) => column.key === key)?.label ?? key
}

watch(
  () => props.module,
  () => loadViews(),
  { immediate: true },
)

watch(
  () => props.defaultColumnKeys,
  () => loadColumnPreference(),
  { deep: true },
)
</script>

<template>
  <div v-loading="loading" class="flex-between gap-3 flex-wrap mb-3">
    <div class="flex items-center gap-2 flex-wrap min-w-0">
      <el-button
        v-if="!systemViews?.length"
        size="small"
        :type="!activeViewId ? 'primary' : 'default'"
        plain
        @click="selectView('')"
      >
        默认视图
      </el-button>
      <el-button
        v-for="view in systemViews ?? []"
        :key="view.id"
        size="small"
        :type="!activeViewId && systemView === view.id ? 'primary' : 'default'"
        plain
        @click="selectSystemView(view.id)"
      >
        {{ view.label }}
      </el-button>
      <el-button
        v-for="view in fixedViews"
        :key="view.id"
        size="small"
        :type="activeViewId === view.id ? 'primary' : 'default'"
        plain
        @click="selectView(view.id)"
      >
        {{ view.name }}
      </el-button>
      <el-button size="small" link type="primary" @click="openCreate(true)">
        + 保存当前筛选
      </el-button>
    </div>

    <div class="flex items-center gap-2">
      <el-select
        :model-value="activeViewId"
        clearable
        filterable
        placeholder="全部个人视图"
        class="!w-48"
        @update:model-value="(value) => selectView(value ?? '')"
      >
        <el-option
          v-for="view in enabledViews"
          :key="view.id"
          :label="view.name"
          :value="view.id"
        />
      </el-select>
      <el-button size="small" @click="columnsVisible = true">列设置</el-button>
      <el-button size="small" @click="manageVisible = true">管理视图</el-button>
    </div>
  </div>

  <el-dialog
    v-model="formVisible"
    :title="editingId ? '编辑视图' : '新建视图'"
    width="720px"
    destroy-on-close
  >
    <el-form label-position="top">
      <el-form-item label="视图名称" required>
        <el-input v-model="form.name" maxlength="100" show-word-limit />
      </el-form-item>
      <el-form-item label="筛选条件">
        <div class="w-full rounded border border-[var(--el-border-color)] p-3">
          <FilterConditionEditor
            ref="formEditorRef"
            v-model="form.conditions"
            v-model:search-mode="form.searchMode"
            :fields="fields"
            :members="members"
            :dept-tree="deptTree"
            show-search-mode
          />
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="formVisible = false">取消</el-button>
      <el-button type="primary" :loading="formSaving" @click="saveView">保存</el-button>
    </template>
  </el-dialog>

  <el-drawer v-model="manageVisible" title="管理视图" size="680px">
    <div class="flex justify-end mb-3">
      <el-button type="primary" @click="openCreate(false)">新建视图</el-button>
    </div>
    <el-table :data="views" stripe>
      <el-table-column prop="name" label="视图名称" min-width="170" />
      <el-table-column label="固定" width="80">
        <template #default="{ row }">
          <el-switch :model-value="row.fixed" @change="toggleFixed(row as UserViewVO)" />
        </template>
      </el-table-column>
      <el-table-column label="启用" width="80">
        <template #default="{ row }">
          <el-switch :model-value="row.enable" @change="toggleEnabled(row as UserViewVO)" />
        </template>
      </el-table-column>
      <el-table-column label="条件" width="80">
        <template #default="{ row }">{{ row.id === activeViewId ? '使用中' : '-' }}</template>
      </el-table-column>
      <el-table-column label="排序" width="110">
        <template #default="{ row }">
          <el-button
            link
            :disabled="views[0]?.id === row.id"
            @click="moveView(row as UserViewVO, -1)"
          >
            上移
          </el-button>
          <el-button
            link
            :disabled="views[views.length - 1]?.id === row.id"
            @click="moveView(row as UserViewVO, 1)"
          >
            下移
          </el-button>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row as UserViewVO)">编辑</el-button>
          <el-button link @click="copyView(row as UserViewVO)">复制</el-button>
          <el-button link type="danger" @click="removeView(row as UserViewVO)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-drawer>

  <el-dialog v-model="columnsVisible" title="当前视图列设置" width="520px">
    <div class="text-xs text-[var(--el-text-color-secondary)] mb-3">
      列偏好保存在当前浏览器，并按当前用户、模块和视图区分；不会修改企业级字段配置。
    </div>
    <el-checkbox-group v-model="selectedColumnKeys" class="grid grid-cols-2 gap-y-2">
      <el-checkbox v-for="column in columnOptions" :key="column.key" :value="column.key">
        {{ column.label }}
      </el-checkbox>
    </el-checkbox-group>
    <el-divider content-position="left">已选列顺序</el-divider>
    <div class="space-y-1 max-h-56 overflow-auto">
      <div
        v-for="(key, index) in selectedColumnKeys"
        :key="key"
        class="flex-between rounded border border-[var(--el-border-color-lighter)] px-3 py-1.5"
      >
        <span class="text-sm">{{ index + 1 }}. {{ columnLabel(key) }}</span>
        <div>
          <el-button link :disabled="index === 0" @click="moveColumn(key, -1)">上移</el-button>
          <el-button
            link
            :disabled="index === selectedColumnKeys.length - 1"
            @click="moveColumn(key, 1)"
          >
            下移
          </el-button>
        </div>
      </div>
    </div>
    <template #footer>
      <el-button @click="columnsVisible = false">取消</el-button>
      <el-button type="primary" @click="saveColumnPreference">保存</el-button>
    </template>
  </el-dialog>
</template>
