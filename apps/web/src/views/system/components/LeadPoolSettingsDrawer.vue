<script setup lang="ts">
import type { FieldVO } from '@micromatrix/shared'
import { ref, watch } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import { resourcePoolApi, type ResourcePoolVO } from '@/api/sales'
import { useFieldRefs } from '@/composables/useFieldRefs'
import LeadPoolConfigDrawer from './LeadPoolConfigDrawer.vue'

const visible = defineModel<boolean>({ required: true })
const refs = useFieldRefs()
const loading = ref(false)
const pools = ref<ResourcePoolVO[]>([])
const fields = ref<FieldVO[]>([])
const editVisible = ref(false)
const editing = ref<ResourcePoolVO | null>(null)

function scopeLabel(tokens: string[]) {
  return tokens.map((token) => {
    const [prefix, raw] = token.includes(':') ? token.split(':', 2) : ['', token]
    const id = raw ?? token
    if (prefix === 'user' || refs.memberMap.value.has(id)) return refs.memberMap.value.get(id) ?? id
    if (prefix === 'dept' || refs.deptMap.value.has(id)) return `部门：${refs.deptMap.value.get(id) ?? id}`
    if (prefix === 'role' || refs.roleMap.value.has(id)) return `角色：${refs.roleMap.value.get(id) ?? id}`
    return token
  }).join('、') || '-'
}

async function load() {
  loading.value = true
  try {
    const [{ data }, { data: fieldList }] = await Promise.all([
      resourcePoolApi.leadSettingsPage({ pageSize: 200 }),
      metadataApi.fields('lead'),
      refs.members.value.length ? Promise.resolve(null) : refs.load(),
    ])
    pools.value = data.list
    fields.value = fieldList
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function create() { editing.value = null; editVisible.value = true }
function edit(row: ResourcePoolVO) { editing.value = row; editVisible.value = true }

async function toggle(row: ResourcePoolVO) {
  const action = row.enabled ? '禁用' : '启用'
  const ok = await ElMessageBox.confirm(`确定${action}「${row.name}」吗？`, `${action}线索池`, { type: 'warning' }).catch(() => false)
  if (!ok) return
  try { await resourcePoolApi.toggle(row.id, 'lead'); ElMessage.success(`已${action}`); await load() }
  catch (error) { ElMessage.error(extractErrorMessage(error)) }
}

async function remove(row: ResourcePoolVO) {
  try {
    const { data: hasData } = await resourcePoolApi.noPickLead(row.id)
    if (hasData) {
      await ElMessageBox.alert('当前线索池中仍有未领取线索，请先在线索池处理完数据后再删除。', '无法删除', { type: 'warning' })
      return
    }
    const ok = await ElMessageBox.confirm(`确定删除「${row.name}」吗？`, '删除线索池', { type: 'warning' }).catch(() => false)
    if (!ok) return
    await resourcePoolApi.remove(row.id, 'lead')
    ElMessage.success('已删除')
    await load()
  } catch (error) { ElMessage.error(extractErrorMessage(error)) }
}

watch(visible, (open) => { if (open) void load() })
</script>

<template>
  <el-drawer v-model="visible" title="线索池设置" size="100%" destroy-on-close data-testid="lead-pool-settings-drawer">
    <div class="mb-4"><el-button type="primary" @click="create">添加线索池</el-button></div>
    <el-table v-loading="loading" :data="pools" border>
      <el-table-column prop="name" label="名称" min-width="160" />
      <el-table-column label="状态" width="100"><template #default="{ row }"><el-switch :model-value="row.enabled" @change="toggle(row as ResourcePoolVO)" /></template></el-table-column>
      <el-table-column label="管理员" min-width="220" show-overflow-tooltip><template #default="{ row }">{{ scopeLabel(row.managerIds) }}</template></el-table-column>
      <el-table-column label="成员" min-width="220" show-overflow-tooltip><template #default="{ row }">{{ scopeLabel(row.scopeIds) }}</template></el-table-column>
      <el-table-column label="自动回收" width="100"><template #default="{ row }">{{ row.autoRecycle ? '是' : '否' }}</template></el-table-column>
      <el-table-column label="创建时间" width="180"><template #default="{ row }">{{ row.createTime ? new Date(row.createTime).toLocaleString() : '-' }}</template></el-table-column>
      <el-table-column prop="createUserName" label="创建人" width="120" />
      <el-table-column label="更新时间" width="180"><template #default="{ row }">{{ row.updateTime ? new Date(row.updateTime).toLocaleString() : '-' }}</template></el-table-column>
      <el-table-column prop="updateUserName" label="更新人" width="120" />
      <el-table-column label="操作" width="130" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="edit(row as ResourcePoolVO)">编辑</el-button><el-button link type="danger" @click="remove(row as ResourcePoolVO)">删除</el-button></template></el-table-column>
    </el-table>
    <LeadPoolConfigDrawer v-model="editVisible" :pool="editing" :fields="fields" @saved="load" />
  </el-drawer>
</template>
