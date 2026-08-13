<script setup lang="ts">
import { isCustomFieldKey, type FieldVO, type ProductVO } from '@micromatrix/shared'
import { computed, onMounted, reactive, ref } from 'vue'
import { productApi } from '@/api/deal'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import DynamicForm from '@/components/form-engine/DynamicForm.vue'
import { formatFieldValue } from '@/components/form-engine/field-display'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const fieldRefs = useFieldRefs()

const fields = ref<FieldVO[]>([])
const loading = ref(false)
const items = ref<ProductVO[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 10, keyword: '', status: '' })

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const dynamicFormRef = ref<InstanceType<typeof DynamicForm>>()
const formModel = ref<Record<string, unknown>>({})

const listColumns = computed(() => fields.value.filter((f) => f.showInList && !f.hidden))

async function loadData() {
  loading.value = true
  try {
    const { data } = await productApi.list({
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword.trim() || undefined,
      status: query.status || undefined,
    })
    items.value = data.items
    total.value = data.total
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingId.value = null
  formModel.value = {}
  dialogVisible.value = true
}

function openEdit(row: ProductVO) {
  editingId.value = row.id
  formModel.value = Object.fromEntries(
    fields.value
      .filter((f) => f.type !== 'formula')
      .map((f) => [
        f.key,
        isCustomFieldKey(f.key)
          ? row.customData[f.key]
          : (row as unknown as Record<string, unknown>)[f.key],
      ]),
  )
  dialogVisible.value = true
}

async function handleSave() {
  const valid = await dynamicFormRef.value?.validate()
  if (!valid) return
  saving.value = true
  try {
    const payload: Record<string, unknown> = { customData: {} }
    for (const [key, value] of Object.entries(formModel.value)) {
      if (value === undefined || value === '') continue
      if (isCustomFieldKey(key)) (payload.customData as Record<string, unknown>)[key] = value
      else payload[key] = value
    }
    if (editingId.value) {
      await productApi.update(editingId.value, payload)
      ElMessage.success('产品已更新')
    } else {
      await productApi.create(payload)
      ElMessage.success('产品已创建')
    }
    dialogVisible.value = false
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

async function handleToggle(row: ProductVO) {
  try {
    await productApi.toggleStatus(row.id)
    ElMessage.success(row.status === 'ON' ? '已下架' : '已上架')
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleDelete(row: ProductVO) {
  const confirmed = await ElMessageBox.confirm(`确定删除产品「${row.name}」吗？`, '删除确认', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await productApi.remove(row.id)
    ElMessage.success('已删除')
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

onMounted(async () => {
  const [{ data }] = await Promise.all([metadataApi.fields('product'), fieldRefs.load()])
  fields.value = data
  loadData()
})
</script>

<template>
  <el-card shadow="never">
    <div class="flex-between flex-wrap gap-3 mb-4">
      <div class="flex gap-2">
        <el-input
          v-model="query.keyword"
          placeholder="搜索名称 / 编码 / 分类"
          clearable
          class="!w-60"
          @keyup.enter="((query.page = 1), loadData())"
          @clear="((query.page = 1), loadData())"
        />
        <el-select
          v-model="query.status"
          clearable
          placeholder="状态"
          class="!w-28"
          @change="((query.page = 1), loadData())"
        >
          <el-option label="上架" value="ON" />
          <el-option label="下架" value="OFF" />
        </el-select>
      </div>
      <el-button v-if="auth.hasPerm('product:create')" type="primary" @click="openCreate">
        新建产品
      </el-button>
    </div>

    <el-table v-loading="loading" :data="items" stripe>
      <el-table-column
        v-for="column in listColumns"
        :key="column.key"
        :label="column.label"
        :width="column.listWidth ?? undefined"
        :min-width="column.listWidth ? undefined : 140"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          {{
            formatFieldValue(column, row, {
              memberMap: fieldRefs.memberMap.value,
              deptMap: fieldRefs.deptMap.value,
            })
          }}
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 'ON' ? 'success' : 'info'" size="small">
            {{ row.status === 'ON' ? '上架' : '下架' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <el-button
            v-if="auth.hasPerm('product:update')"
            link
            type="primary"
            @click="openEdit(row as ProductVO)"
          >
            编辑
          </el-button>
          <el-button
            v-if="auth.hasPerm('product:update')"
            link
            @click="handleToggle(row as ProductVO)"
          >
            {{ row.status === 'ON' ? '下架' : '上架' }}
          </el-button>
          <el-button
            v-if="auth.hasPerm('product:delete')"
            link
            type="danger"
            @click="handleDelete(row as ProductVO)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="flex justify-end mt-4">
      <el-pagination
        v-model:current-page="query.page"
        v-model:page-size="query.pageSize"
        :total="total"
        layout="total, prev, pager, next"
        @current-change="loadData"
      />
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑产品' : '新建产品'"
      width="640px"
      destroy-on-close
    >
      <DynamicForm
        ref="dynamicFormRef"
        v-model="formModel"
        :fields="fields"
        :members="fieldRefs.members.value"
        :dept-tree="fieldRefs.deptTree.value"
      />
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>
