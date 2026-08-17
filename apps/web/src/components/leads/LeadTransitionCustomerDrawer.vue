<script setup lang="ts">
import type { FieldVO, FilterCondition } from '@micromatrix/shared'
import { computed, ref, watch } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import { leadApi } from '@/api/sales'
import AdvancedFilter from '@/components/form-engine/AdvancedFilter.vue'
import { formatFieldValue } from '@/components/form-engine/field-display'
import { useFieldRefs } from '@/composables/useFieldRefs'

type Candidate = Awaited<ReturnType<typeof leadApi.transitionCustomerList>>['data']['items'][number]

const props = defineProps<{ clueIds: string[] }>()
const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ finish: [] }>()

const fieldRefs = useFieldRefs()
const fields = ref<FieldVO[]>([])
const filters = ref<FilterCondition[]>([])
const keyword = ref('')
const loading = ref(false)
const saving = ref(false)
const rows = ref<Candidate[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const selectedId = ref('')
const listFields = computed(() =>
  fields.value.filter(
    (field) => field.showInList && !field.hidden && !['name', 'ownerId'].includes(field.key),
  ),
)

function displayValue(field: FieldVO, row: Candidate) {
  return formatFieldValue(field, row as unknown as Record<string, unknown>, {
    memberMap: fieldRefs.memberMap.value,
    deptMap: fieldRefs.deptMap.value,
  })
}

async function ensureRefs() {
  if (fields.value.length === 0) {
    const [{ data }] = await Promise.all([metadataApi.fields('customer'), fieldRefs.load()])
    fields.value = data.filter((field) => !field.hidden)
  }
}

async function load() {
  loading.value = true
  try {
    await ensureRefs()
    const { data } = await leadApi.transitionCustomerList({
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value.trim() || undefined,
      filters: filters.value.length ? JSON.stringify(filters.value) : undefined,
    })
    rows.value = data.items
    total.value = data.total
    if (!rows.value.some((row) => row.id === selectedId.value)) selectedId.value = ''
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function search() {
  page.value = 1
  load()
}

async function confirm() {
  if (!selectedId.value || props.clueIds.length === 0) return
  saving.value = true
  try {
    const { data } = await leadApi.retransitionCustomer({
      clueIds: props.clueIds,
      customerId: selectedId.value,
    })
    ElMessage.success(
      data.skippedIds.length
        ? `关联成功 ${data.success} 条，跳过无负责人线索 ${data.skippedIds.length} 条`
        : '关联客户成功',
    )
    visible.value = false
    emit('finish')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

watch(visible, (open) => {
  if (open) {
    selectedId.value = ''
    keyword.value = ''
    filters.value = []
    page.value = 1
    load()
  }
})
</script>

<template>
  <el-drawer
    v-model="visible"
    title="关联客户"
    size="100%"
    destroy-on-close
    :close-on-click-modal="false"
  >
    <div class="flex h-full flex-col px-2">
      <div class="mb-4 flex items-center justify-end gap-3">
        <el-input
          v-model="keyword"
          class="!w-[240px]"
          clearable
          placeholder="搜索客户名称"
          @keyup.enter="search"
          @clear="search"
        />
        <AdvancedFilter
          v-model="filters"
          :fields="fields"
          :members="fieldRefs.members.value"
          :dept-tree="fieldRefs.deptTree.value"
          @apply="search"
        />
      </div>

      <el-table v-loading="loading" :data="rows" border row-key="id" class="flex-1">
        <el-table-column width="56" align="center">
          <template #default="{ row }">
            <el-radio
              :model-value="selectedId"
              :value="row.id"
              :disabled="!row.selectable"
              @change="selectedId = row.id"
            >
              <span />
            </el-radio>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="客户名称" min-width="220" show-overflow-tooltip />
        <el-table-column prop="ownerName" label="负责人" min-width="120" />
        <el-table-column
          v-for="field in listFields"
          :key="field.id"
          :label="field.label"
          :width="field.listWidth ?? undefined"
          :min-width="field.listWidth ? undefined : 140"
          show-overflow-tooltip
        >
          <template #default="{ row }">
            {{ displayValue(field, row as Candidate) }}
          </template>
        </el-table-column>
        <el-table-column label="客户状态" width="120">
          <template #default="{ row }">
            <el-tag v-if="row.inSea" type="warning" size="small">公海</el-tag>
            <el-tag v-else-if="row.collaborationType === 'READ_ONLY'" type="info" size="small">
              只读协作
            </el-tag>
            <el-tag v-else-if="row.collaborationType === 'COLLABORATION'" size="small">协作</el-tag>
            <span v-else>正常</span>
          </template>
        </el-table-column>
        <el-table-column label="说明" min-width="220">
          <template #default="{ row }">
            <span v-if="row.collaborationType === 'READ_ONLY' && !row.selectable" class="text-[var(--el-text-color-secondary)]">
              只读协作客户不可关联
            </span>
            <span v-else-if="row.inSea" class="text-[var(--el-text-color-secondary)]">
              关联前将按公海规则领取
            </span>
          </template>
        </el-table-column>
      </el-table>

      <div class="mt-4 flex items-center justify-between">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          @change="load"
        />
        <div class="flex gap-3">
          <el-button @click="visible = false">取消</el-button>
          <el-button type="primary" :disabled="!selectedId" :loading="saving" @click="confirm">
            关联客户
          </el-button>
        </div>
      </div>
    </div>
  </el-drawer>
</template>
