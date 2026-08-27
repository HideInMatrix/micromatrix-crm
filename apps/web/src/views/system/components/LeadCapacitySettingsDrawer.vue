<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { resourceCapacityApi, type ResourceCapacityVO } from '@/api/sales'
import { useFieldRefs } from '@/composables/useFieldRefs'

const visible = defineModel<boolean>({ required: true })
const refs = useFieldRefs()
const loading = ref(false)
const saving = ref(false)
const rows = ref<ResourceCapacityVO[]>([])
const editingId = ref('')
const form = reactive({ scopeIds: [] as string[], capacity: null as number | null })

const scopeOptions = computed(() => [
  ...refs.members.value.map((item) => ({ label: `成员：${item.name}`, value: `user:${item.id}` })),
  ...[...refs.deptMap.value.entries()].map(([id, name]) => ({ label: `部门：${name}`, value: `dept:${id}` })),
  ...refs.roles.value.map((item) => ({ label: `角色：${item.name}`, value: `role:${item.id}` })),
])
function label(tokens: string[]) { return tokens.map((token) => scopeOptions.value.find((item) => item.value === token || item.value.endsWith(`:${token}`))?.label ?? token).join('、') }
async function load() { loading.value = true; try { if (!refs.members.value.length) await refs.load(); rows.value = (await resourceCapacityApi.list('lead')).data } catch (error) { ElMessage.error(extractErrorMessage(error)) } finally { loading.value = false } }
function reset() { editingId.value = ''; form.scopeIds = []; form.capacity = null }
function edit(row: ResourceCapacityVO) { editingId.value = row.id; form.scopeIds = [...row.scopeIds]; form.capacity = row.capacity }
async function save() {
  if (!form.scopeIds.length) return ElMessage.warning('请选择部门、成员或角色')
  saving.value = true
  try {
    const payload = { module: 'lead', scopeIds: form.scopeIds, capacity: form.capacity }
    if (editingId.value) await resourceCapacityApi.update(editingId.value, payload)
    else await resourceCapacityApi.create(payload)
    ElMessage.success(editingId.value ? '库容已更新' : '库容已添加')
    reset(); await load()
  } catch (error) { ElMessage.error(extractErrorMessage(error)) } finally { saving.value = false }
}
async function remove(row: ResourceCapacityVO) {
  const ok = await ElMessageBox.confirm('确定删除该库容规则吗？', '删除库容', { type: 'warning' }).catch(() => false)
  if (!ok) return
  try { await resourceCapacityApi.remove(row.id, 'lead'); ElMessage.success('已删除'); if (editingId.value === row.id) reset(); await load() } catch (error) { ElMessage.error(extractErrorMessage(error)) }
}
watch(visible, (open) => { if (open) { reset(); void load() } })
</script>

<template>
  <el-drawer v-model="visible" title="线索库容设置" size="800px" destroy-on-close data-testid="lead-capacity-settings-drawer">
    <el-alert class="mb-4" type="info" :closable="false" title="同一实际成员只能命中一条库容规则；部门包含下级部门，角色会展开为角色成员。库容留空表示不限制，0 表示该范围不能再持有线索。" />
    <div class="mb-4 grid grid-cols-[1fr_180px_auto] items-center gap-3">
      <el-select v-model="form.scopeIds" multiple filterable placeholder="选择部门、成员或角色">
        <el-option v-for="item in scopeOptions" :key="item.value" :label="item.label" :value="item.value" />
      </el-select>
      <el-input-number v-model="form.capacity" :min="0" :max="1000000" placeholder="不限制" class="!w-full" />
      <div><el-button v-if="editingId" @click="reset">取消</el-button><el-button type="primary" :loading="saving" @click="save">{{ editingId ? '更新' : '添加' }}</el-button></div>
    </div>
    <el-table v-loading="loading" :data="rows" border>
      <el-table-column label="部门或成员" min-width="360"><template #default="{ row }">{{ label(row.scopeIds) }}</template></el-table-column>
      <el-table-column label="库容" width="140"><template #default="{ row }">{{ row.capacity === null ? '不限制' : row.capacity }}</template></el-table-column>
      <el-table-column label="操作" width="130"><template #default="{ row }"><el-button link type="primary" @click="edit(row as ResourceCapacityVO)">编辑</el-button><el-button link type="danger" @click="remove(row as ResourceCapacityVO)">删除</el-button></template></el-table-column>
    </el-table>
  </el-drawer>
</template>
