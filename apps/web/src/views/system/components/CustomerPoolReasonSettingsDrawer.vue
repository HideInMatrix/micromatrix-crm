<script setup lang="ts">
import { ref, watch } from 'vue'
import draggable from 'vuedraggable'
import { extractErrorMessage } from '@/api/http'
import { dictionaryApi, type DictionaryItemVO } from '@/api/system'

const visible = defineModel<boolean>({ required: true })
const loading = ref(false)
const enabled = ref(false)
const rows = ref<DictionaryItemVO[]>([])
const draft = ref('')
const editingId = ref('')
const editingName = ref('')

async function load() {
  loading.value = true
  try {
    const [{ data: list }, { data: config }] = await Promise.all([
      dictionaryApi.list('CUSTOMER_POOL_RS'),
      dictionaryApi.config('CUSTOMER_POOL_RS'),
    ])
    rows.value = list
    enabled.value = config.enable
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function toggle(value: boolean) {
  try {
    await dictionaryApi.toggle('CUSTOMER_POOL_RS', value)
    enabled.value = value
    ElMessage.success('设置已保存')
  } catch (error) {
    enabled.value = !value
    ElMessage.error(extractErrorMessage(error))
  }
}

async function add() {
  const name = draft.value.trim()
  if (!name) return
  if (rows.value.length >= 50) return ElMessage.warning('最多可配置 50 条原因')
  try {
    await dictionaryApi.add('CUSTOMER_POOL_RS', name)
    draft.value = ''
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function update(row: DictionaryItemVO) {
  const name = editingName.value.trim()
  if (!name) return
  try {
    await dictionaryApi.update(row.id, name)
    editingId.value = ''
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function remove(row: DictionaryItemVO) {
  if (enabled.value && rows.value.length <= 1) {
    return ElMessage.warning('原因已启用，至少保留一条原因')
  }
  const ok = await ElMessageBox.confirm(`确定删除「${row.name}」吗？`, '删除原因', {
    type: 'warning',
    confirmButtonText: '确认删除',
    cancelButtonText: '取消',
  }).catch(() => false)
  if (!ok) return
  try {
    await dictionaryApi.remove(row.id)
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function startEdit(row: DictionaryItemVO) {
  editingId.value = row.id
  editingName.value = row.name
}

async function sort(event: { oldIndex?: number; newIndex?: number }) {
  if (event.oldIndex == null || event.newIndex == null || event.oldIndex === event.newIndex) return
  const row = rows.value[event.newIndex]
  if (!row) return
  try {
    await dictionaryApi.sort(event.oldIndex + 1, event.newIndex + 1, row.id)
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    await load()
  }
}

watch(visible, (open) => {
  if (open) void load()
})
</script>

<template>
  <el-drawer
    v-model="visible"
    size="600px"
    destroy-on-close
    data-testid="customer-pool-reason-settings-drawer"
  >
    <template #header>
      <div class="flex w-full items-center justify-between pr-4">
        <span class="font-medium">移入公海原因设置</span>
        <el-switch
          :model-value="enabled"
          :disabled="rows.length === 0"
          @change="toggle($event as boolean)"
        />
      </div>
    </template>

    <div class="mb-4 flex gap-2">
      <el-input v-model="draft" maxlength="255" placeholder="请输入原因" @keyup.enter="add" />
      <el-button type="primary" :disabled="!draft.trim() || rows.length >= 50" @click="add">
        添加
      </el-button>
    </div>
    <div class="mb-3 text-xs text-[var(--el-text-color-secondary)]">
      最多 50 条；开启后人工单个或批量移入客户公海必须选择原因。拖拽左侧手柄可调整顺序。
    </div>

    <div v-loading="loading">
      <draggable v-model="rows" item-key="id" handle=".reason-drag" @end="sort">
        <template #item="{ element: row }">
          <div class="mb-2 flex items-center gap-2 rounded border border-[var(--el-border-color)] p-3">
            <span class="reason-drag cursor-move text-[var(--el-text-color-secondary)]">⋮⋮</span>
            <el-input
              v-if="editingId === row.id"
              v-model="editingName"
              maxlength="255"
              class="flex-1"
              @keyup.enter="update(row)"
            />
            <span v-else class="min-w-0 flex-1 truncate">{{ row.name }}</span>
            <template v-if="editingId === row.id">
              <el-button link @click="editingId = ''">取消</el-button>
              <el-button link type="primary" @click="update(row)">保存</el-button>
            </template>
            <template v-else>
              <el-button link type="primary" @click="startEdit(row)">编辑</el-button>
              <el-button
                link
                type="danger"
                :disabled="enabled && rows.length <= 1"
                @click="remove(row)"
              >
                删除
              </el-button>
            </template>
          </div>
        </template>
      </draggable>
    </div>
  </el-drawer>
</template>
