<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  listCustomerOptions,
  listCustomerRelations,
  replaceCustomerRelations,
  type CustomerOptionVO,
  type CustomerRelationPayload,
  type CustomerRelationVO,
} from '@/api/customers'
import { extractErrorMessage } from '@/api/http'

const props = withDefaults(
  defineProps<{
    customerId: string
    readonly?: boolean
  }>(),
  { readonly: false },
)

type RelationDraft = CustomerRelationPayload & {
  key: string
}

const router = useRouter()
const loading = ref(false)
const saving = ref(false)
const optionLoading = ref(false)
const options = ref<CustomerOptionVO[]>([])
const origin = ref<RelationDraft[]>([])
const relations = ref<RelationDraft[]>([])

const selectedIds = computed(() => new Set(relations.value.map((item) => item.customerId).filter(Boolean)))

function makeKey() {
  return `relation_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function cloneRelations(value: RelationDraft[]) {
  return value.map((item) => ({ ...item }))
}

function relationTypeOptions(item: RelationDraft) {
  const hasOtherGroup = relations.value.some(
    (relation) => relation.key !== item.key && relation.relationType === 'GROUP',
  )
  return hasOtherGroup
    ? [{ label: '子公司', value: 'SUBSIDIARY' as const }]
    : [
        { label: '集团', value: 'GROUP' as const },
        { label: '子公司', value: 'SUBSIDIARY' as const },
      ]
}

function optionDisabled(option: CustomerOptionVO, item: RelationDraft) {
  if (option.id === props.customerId) return true
  return option.id !== item.customerId && selectedIds.value.has(option.id)
}

function appendKnownOptions(rows: CustomerRelationVO[]) {
  const map = new Map(options.value.map((item) => [item.id, item]))
  for (const row of rows) {
    if (!map.has(row.customerId)) map.set(row.customerId, { id: row.customerId, name: row.customerName ?? '未知客户' })
  }
  options.value = [...map.values()]
}

async function loadOptions(keyword?: string) {
  optionLoading.value = true
  try {
    const { data } = await listCustomerOptions(keyword)
    const selectedMap = new Map(options.value.filter((item) => selectedIds.value.has(item.id)).map((item) => [item.id, item]))
    for (const item of data) selectedMap.set(item.id, item)
    options.value = [...selectedMap.values()]
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    optionLoading.value = false
  }
}

async function loadRelations() {
  if (!props.customerId) return
  loading.value = true
  try {
    const { data } = await listCustomerRelations(props.customerId)
    const next = data.map<RelationDraft>((row) => ({
      key: row.id || makeKey(),
      relationType: row.relationType,
      customerId: row.customerId,
    }))
    origin.value = cloneRelations(next)
    relations.value = cloneRelations(next)
    appendKnownOptions(data)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function addRelation() {
  if (relations.value.length >= 11) return
  relations.value.push({ key: makeKey(), relationType: 'SUBSIDIARY', customerId: '' })
}

function removeRelation(index: number) {
  relations.value.splice(index, 1)
}

function reset() {
  relations.value = cloneRelations(origin.value)
}

async function save() {
  const incomplete = relations.value.some((item) => !item.customerId || !item.relationType)
  if (incomplete) {
    ElMessage.warning('请补完整客户关系后再保存')
    return
  }
  const ids = relations.value.map((item) => item.customerId)
  if (new Set(ids).size !== ids.length) {
    ElMessage.warning('同一个客户不能重复选择')
    return
  }
  if (relations.value.filter((item) => item.relationType === 'GROUP').length > 1) {
    ElMessage.warning('一个客户只能选择一个上级集团')
    return
  }
  saving.value = true
  try {
    await replaceCustomerRelations(
      props.customerId,
      relations.value.map(({ relationType, customerId }) => ({ relationType, customerId })),
    )
    ElMessage.success('客户关系已保存')
    await loadRelations()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

function openCustomer(id: string) {
  if (!id) return
  router.push(`/customers/${id}`)
}

watch(
  () => props.customerId,
  async () => {
    await Promise.all([loadOptions(), loadRelations()])
  },
)

onMounted(async () => {
  await Promise.all([loadOptions(), loadRelations()])
})
</script>

<template>
  <div v-loading="loading" class="space-y-3">
    <div class="rounded border border-[var(--el-border-color-lighter)] p-4 space-y-2">
      <div class="grid grid-cols-[150px_1fr_90px_auto] gap-3 text-xs text-[var(--el-text-color-secondary)] px-1">
        <span>客户关系</span>
        <span>选择客户</span>
        <span>查看</span>
        <span />
      </div>

      <el-empty v-if="readonly && relations.length === 0" description="暂无客户关系" :image-size="60" />

      <div
        v-for="(item, index) in relations"
        :key="item.key"
        class="grid grid-cols-[150px_1fr_90px_auto] gap-3 items-center"
      >
        <el-select v-model="item.relationType" :disabled="readonly">
          <el-option
            v-for="option in relationTypeOptions(item)"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
        <el-select
          v-model="item.customerId"
          :disabled="readonly"
          filterable
          remote
          clearable
          :remote-method="loadOptions"
          :loading="optionLoading"
          placeholder="搜索客户"
        >
          <el-option
            v-for="option in options"
            :key="option.id"
            :label="option.name"
            :value="option.id"
            :disabled="optionDisabled(option, item)"
          />
        </el-select>
        <el-button link type="primary" :disabled="!item.customerId" @click="openCustomer(item.customerId)">
          打开客户
        </el-button>
        <el-button v-if="!readonly" link type="danger" @click="removeRelation(index)">删除</el-button>
      </div>

      <el-button
        v-if="!readonly"
        link
        type="primary"
        :disabled="relations.length >= 11"
        @click="addRelation"
      >
        + 添加关系
      </el-button>
    </div>

    <div v-if="!readonly" class="flex justify-end gap-2">
      <el-button @click="reset">重置</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存关系</el-button>
    </div>
  </div>
</template>
