<script setup lang="ts">
import {
  isCustomFieldKey,
  type FieldVO,
  type FilterCondition,
  type OpportunityStageVO,
  type OpportunityVO,
} from '@micromatrix/shared'
import { computed, onMounted, reactive, ref } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import { listCustomers } from '@/api/customers'
import { opportunityApi } from '@/api/sales'
import FollowUpDrawer from '@/components/FollowUpDrawer.vue'
import AdvancedFilter from '@/components/form-engine/AdvancedFilter.vue'
import DynamicForm from '@/components/form-engine/DynamicForm.vue'
import { formatFieldValue } from '@/components/form-engine/field-display'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const fieldRefs = useFieldRefs()

const viewMode = ref<'list' | 'kanban'>('list')
const fields = ref<FieldVO[]>([])
const stages = ref<OpportunityStageVO[]>([])

// 列表态
const loading = ref(false)
const items = ref<OpportunityVO[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 10, keyword: '', stageId: '' })
const filters = ref<FilterCondition[]>([])

// 看板态
const kanbanItems = ref<Record<string, OpportunityVO[]>>({})
const kanbanStages = ref<OpportunityStageVO[]>([])

// 表单
const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const dynamicFormRef = ref<InstanceType<typeof DynamicForm>>()
const formModel = ref<Record<string, unknown>>({})
const formCustomerId = ref<string>()
const customerOptions = ref<{ id: string; name: string }[]>([])

// 跟进 / 阶段
const followVisible = ref(false)
const followTarget = ref<OpportunityVO | null>(null)
const stageVisible = ref(false)
const stageTarget = ref<OpportunityVO | null>(null)
const stageForm = reactive({ stageId: '', lostReason: '' })

const listColumns = computed(() => fields.value.filter((f) => f.showInList && !f.hidden))
const selectedStage = computed(() => stages.value.find((s) => s.id === stageForm.stageId))

async function loadMeta() {
  const [{ data: fieldData }, { data: stageData }] = await Promise.all([
    metadataApi.fields('opportunity'),
    opportunityApi.stages(),
  ])
  fields.value = fieldData
  stages.value = stageData
}

async function loadData() {
  loading.value = true
  try {
    if (viewMode.value === 'kanban') {
      const { data } = await opportunityApi.kanban()
      kanbanStages.value = data.stages
      kanbanItems.value = data.items
    } else {
      const { data } = await opportunityApi.list({
        page: query.page,
        pageSize: query.pageSize,
        keyword: query.keyword.trim() || undefined,
        stageId: query.stageId || undefined,
        filters: filters.value.length ? JSON.stringify(filters.value) : undefined,
      })
      items.value = data.items
      total.value = data.total
    }
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function searchCustomers(keyword: string) {
  const { data } = await listCustomers({ page: 1, pageSize: 20, keyword: keyword || undefined })
  customerOptions.value = data.items.map((c) => ({ id: c.id, name: c.name }))
}

function openCreate() {
  editingId.value = null
  formModel.value = {}
  formCustomerId.value = undefined
  searchCustomers('')
  dialogVisible.value = true
}

function openEdit(row: OpportunityVO) {
  editingId.value = row.id
  formCustomerId.value = row.customerId
  customerOptions.value = [{ id: row.customerId, name: row.customerName ?? '' }]
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
  if (!formCustomerId.value) {
    ElMessage.warning('请选择关联客户')
    return
  }
  const valid = await dynamicFormRef.value?.validate()
  if (!valid) return
  saving.value = true
  try {
    const payload: Record<string, unknown> = { customData: {}, customerId: formCustomerId.value }
    for (const [key, value] of Object.entries(formModel.value)) {
      if (value === undefined || value === '') continue
      if (isCustomFieldKey(key)) (payload.customData as Record<string, unknown>)[key] = value
      else payload[key] = value
    }
    if (editingId.value) {
      await opportunityApi.update(editingId.value, payload)
      ElMessage.success('商机已更新')
    } else {
      await opportunityApi.create(payload)
      ElMessage.success('商机已创建')
    }
    dialogVisible.value = false
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

async function handleDelete(row: OpportunityVO) {
  const confirmed = await ElMessageBox.confirm(`确定删除商机「${row.name}」吗？`, '删除确认', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await opportunityApi.remove(row.id)
    ElMessage.success('已删除')
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function openStageChange(row: OpportunityVO) {
  stageTarget.value = row
  stageForm.stageId = row.stageId
  stageForm.lostReason = ''
  stageVisible.value = true
}

async function handleStageChange() {
  if (!stageTarget.value) return
  if (selectedStage.value?.isLost && !stageForm.lostReason.trim()) {
    ElMessage.warning('请填写输单原因')
    return
  }
  try {
    await opportunityApi.changeStage(
      stageTarget.value.id,
      stageForm.stageId,
      stageForm.lostReason || undefined,
    )
    ElMessage.success('阶段已更新')
    stageVisible.value = false
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function openFollow(row: OpportunityVO) {
  followTarget.value = row
  followVisible.value = true
}

function formatAmount(amount: number | null) {
  return amount === null ? '-' : `¥${amount.toLocaleString('zh-CN')}`
}

onMounted(async () => {
  await Promise.all([loadMeta(), fieldRefs.load()])
  loadData()
})
</script>

<template>
  <el-card shadow="never">
    <div class="flex-between flex-wrap gap-3 mb-4">
      <div class="flex gap-2 items-center">
        <el-radio-group v-model="viewMode" @change="loadData">
          <el-radio-button value="list">列表</el-radio-button>
          <el-radio-button value="kanban">看板</el-radio-button>
        </el-radio-group>
        <template v-if="viewMode === 'list'">
          <el-input
            v-model="query.keyword"
            placeholder="搜索商机名称"
            clearable
            class="!w-52"
            @keyup.enter="query.page = 1, loadData()"
            @clear="query.page = 1, loadData()"
          />
          <el-select
            v-model="query.stageId"
            clearable
            placeholder="阶段"
            class="!w-32"
            @change="query.page = 1, loadData()"
          >
            <el-option v-for="s in stages" :key="s.id" :label="s.name" :value="s.id" />
          </el-select>
          <AdvancedFilter
            :fields="fields"
            :members="fieldRefs.members.value"
            :dept-tree="fieldRefs.deptTree.value"
            @apply="(c) => ((filters = c), (query.page = 1), loadData())"
          />
        </template>
      </div>
      <el-button v-if="auth.hasPerm('opportunity:create')" type="primary" @click="openCreate">
        新建商机
      </el-button>
    </div>

    <!-- 列表视图 -->
    <template v-if="viewMode === 'list'">
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
        <el-table-column label="客户" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.customerName }}</template>
        </el-table-column>
        <el-table-column label="阶段" width="130">
          <template #default="{ row }">
            <el-tag
              :type="row.isWon ? 'success' : row.isLost ? 'danger' : 'primary'"
              size="small"
            >
              {{ row.stageName }} {{ row.isWon || row.isLost ? '' : `${row.stageProbability}%` }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openFollow(row as OpportunityVO)">跟进</el-button>
            <el-button
              v-if="auth.hasPerm('opportunity:stage') && !row.isWon && !row.isLost"
              link
              type="primary"
              @click="openStageChange(row as OpportunityVO)"
            >
              推进
            </el-button>
            <el-button link @click="openEdit(row as OpportunityVO)">编辑</el-button>
            <el-button
              v-if="auth.hasPerm('opportunity:delete')"
              link
              type="danger"
              @click="handleDelete(row as OpportunityVO)"
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
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          @current-change="loadData"
          @size-change="query.page = 1, loadData()"
        />
      </div>
    </template>

    <!-- 看板视图 -->
    <div v-else v-loading="loading" class="flex gap-3 overflow-x-auto pb-2">
      <div
        v-for="stage in kanbanStages"
        :key="stage.id"
        class="w-64 shrink-0 rounded-lg bg-[var(--el-fill-color-light)] p-2"
      >
        <div class="flex-between px-1 py-2">
          <span class="text-sm font-medium">
            {{ stage.name }}
            <span class="text-xs text-[var(--el-text-color-secondary)]">
              {{ stage.isWon || stage.isLost ? '' : `${stage.probability}%` }}
            </span>
          </span>
          <span class="text-xs text-[var(--el-text-color-secondary)]">
            {{ stage.count }} 个 · ¥{{ (stage.amountSum ?? 0).toLocaleString('zh-CN') }}
          </span>
        </div>
        <div class="space-y-2 min-h-24 max-h-[60vh] overflow-y-auto">
          <div
            v-for="opportunity in kanbanItems[stage.id] ?? []"
            :key="opportunity.id"
            class="rounded bg-[var(--el-bg-color)] p-3 shadow-sm cursor-pointer hover:shadow"
            @click="openStageChange(opportunity)"
          >
            <div class="text-sm font-medium truncate">{{ opportunity.name }}</div>
            <div class="text-xs text-[var(--el-text-color-secondary)] mt-1 truncate">
              {{ opportunity.customerName }}
            </div>
            <div class="flex-between mt-2">
              <span class="text-xs">{{ formatAmount(opportunity.amount) }}</span>
              <span class="text-xs text-[var(--el-text-color-secondary)]">
                {{ opportunity.ownerName ?? '-' }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 新建/编辑 -->
    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑商机' : '新建商机'"
      width="640px"
      destroy-on-close
    >
      <el-form label-position="top">
        <el-form-item label="关联客户" required>
          <el-select
            v-model="formCustomerId"
            filterable
            remote
            :remote-method="searchCustomers"
            placeholder="搜索并选择客户"
            class="w-full"
          >
            <el-option v-for="c in customerOptions" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
      </el-form>
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

    <!-- 阶段推进 -->
    <el-dialog v-model="stageVisible" :title="`推进阶段 · ${stageTarget?.name ?? ''}`" width="440px">
      <el-form label-width="90px">
        <el-form-item label="目标阶段">
          <el-select v-model="stageForm.stageId" class="w-full">
            <el-option
              v-for="s in stages"
              :key="s.id"
              :label="`${s.name}${s.isWon || s.isLost ? '' : ` (${s.probability}%)`}`"
              :value="s.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item v-if="selectedStage?.isLost" label="输单原因">
          <el-input v-model="stageForm.lostReason" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="stageVisible = false">取消</el-button>
        <el-button type="primary" @click="handleStageChange">确认</el-button>
      </template>
    </el-dialog>

    <FollowUpDrawer
      v-model="followVisible"
      target-type="opportunity"
      :target-id="followTarget?.id ?? null"
      :target-name="followTarget?.name"
      @followed="loadData"
    />
  </el-card>
</template>
