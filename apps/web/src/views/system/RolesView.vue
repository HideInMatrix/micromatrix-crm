<script setup lang="ts">
import {
  DATA_SCOPE_OPTIONS,
  PERMISSION_TREE,
  permissionAncestorMap,
  type DepartmentVO,
  type PermissionNode,
  type RoleVO,
} from '@micromatrix/shared'
import type { ElTree, FormInstance, FormRules } from 'element-plus'
import { onMounted, reactive, ref } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { deptApi, roleApi, type RoleForm } from '@/api/system'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const loading = ref(false)
const roles = ref<RoleVO[]>([])
const deptTree = ref<DepartmentVO[]>([])

const drawerVisible = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const formRef = ref<FormInstance>()
const permTreeRef = ref<InstanceType<typeof ElTree>>()
const form = reactive<RoleForm>({
  name: '',
  permissions: [],
  dataScope: 'SELF',
  scopeDeptIds: [],
  remark: '',
})

const rules: FormRules = {
  name: [{ required: true, message: '请输入角色名称', trigger: 'blur' }],
}

const permissionAncestors = permissionAncestorMap()

function descendantCodes(node: PermissionNode): string[] {
  return (node.children ?? []).flatMap((child) => [child.code, ...descendantCodes(child)])
}

function handlePermissionCheck(
  node: PermissionNode,
  state: { checkedKeys: Array<string | number> },
) {
  const checked = new Set(state.checkedKeys.map(String))
  if (checked.has(node.code)) {
    permissionAncestors.get(node.code)?.forEach((code) => checked.add(code))
  } else {
    descendantCodes(node).forEach((code) => checked.delete(code))
  }
  permTreeRef.value?.setCheckedKeys([...checked])
}

async function loadData() {
  loading.value = true
  try {
    const [{ data: roleList }, { data: tree }] = await Promise.all([roleApi.list(), deptApi.tree()])
    roles.value = roleList
    deptTree.value = tree
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingId.value = null
  Object.assign(form, { name: '', permissions: [], dataScope: 'SELF', scopeDeptIds: [], remark: '' })
  drawerVisible.value = true
}

function openEdit(row: RoleVO) {
  editingId.value = row.id
  Object.assign(form, {
    name: row.name,
    permissions: [...row.permissions],
    dataScope: row.dataScope,
    scopeDeptIds: [...row.scopeDeptIds],
    remark: row.remark ?? '',
  })
  drawerVisible.value = true
}

async function handleSave() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  if (form.dataScope === 'CUSTOM' && (!form.scopeDeptIds || form.scopeDeptIds.length === 0)) {
    ElMessage.warning('自定义数据范围至少选择一个部门')
    return
  }

  // 勾选的叶子 + 半选的父节点（保证父级菜单可见）
  const checked = (permTreeRef.value?.getCheckedKeys() ?? []) as string[]
  const halfChecked = (permTreeRef.value?.getHalfCheckedKeys() ?? []) as string[]
  const permissions = [...halfChecked, ...checked]

  saving.value = true
  try {
    const payload: RoleForm = { ...form, permissions }
    if (editingId.value) {
      await roleApi.update(editingId.value, payload)
      ElMessage.success('角色已更新')
    } else {
      await roleApi.create(payload)
      ElMessage.success('角色已创建')
    }
    drawerVisible.value = false
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

async function handleDelete(row: RoleVO) {
  const confirmed = await ElMessageBox.confirm(`确定删除角色「${row.name}」吗？`, '删除确认', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await roleApi.remove(row.id)
    ElMessage.success('已删除')
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function scopeLabel(scope: string) {
  return DATA_SCOPE_OPTIONS.find((o) => o.value === scope)?.label ?? scope
}

onMounted(loadData)
</script>

<template>
  <el-card shadow="never">
    <div class="flex-between mb-4">
      <span class="text-sm text-[var(--el-text-color-secondary)]">
        角色决定成员的菜单/操作权限与数据可见范围
      </span>
      <el-button v-if="auth.hasPerm('system:role:create')" type="primary" @click="openCreate">
        新建角色
      </el-button>
    </div>

    <el-table v-loading="loading" :data="roles" stripe>
      <el-table-column label="角色名称" width="180">
        <template #default="{ row }">
          {{ row.name }}
          <el-tag v-if="row.isSystem" size="small" class="ml-1">内置</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="数据范围" width="170">
        <template #default="{ row }">{{ scopeLabel(row.dataScope) }}</template>
      </el-table-column>
      <el-table-column prop="userCount" label="成员数" width="90" />
      <el-table-column label="备注" min-width="200" show-overflow-tooltip>
        <template #default="{ row }">{{ row.remark || '-' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button
            v-if="auth.hasPerm('system:role:update')"
            link
            type="primary"
            :disabled="row.isSystem"
            @click="openEdit(row as RoleVO)"
          >
            编辑
          </el-button>
          <el-button
            v-if="auth.hasPerm('system:role:delete')"
            link
            type="danger"
            :disabled="row.isSystem"
            @click="handleDelete(row as RoleVO)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-drawer
      v-model="drawerVisible"
      :title="editingId ? '编辑角色' : '新建角色'"
      size="480px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
        <el-form-item label="角色名称" prop="name">
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="数据范围">
          <el-select v-model="form.dataScope" class="w-full">
            <el-option
              v-for="opt in DATA_SCOPE_OPTIONS"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item v-if="form.dataScope === 'CUSTOM'" label="可见部门">
          <el-tree-select
            v-model="form.scopeDeptIds"
            :data="deptTree"
            :props="{ label: 'name', children: 'children' }"
            node-key="id"
            multiple
            show-checkbox
            check-strictly
            class="w-full"
          />
          <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
            所选部门及其全部下级部门的数据均可见；本人负责的数据始终可见。
          </div>
        </el-form-item>
        <el-form-item label="功能权限">
          <div
            class="border border-[var(--el-border-color)] rounded w-full p-2 max-h-96 overflow-auto"
          >
            <el-tree
              ref="permTreeRef"
              :data="PERMISSION_TREE"
              :props="{ label: 'label', children: 'children' }"
              node-key="code"
              show-checkbox
              check-strictly
              default-expand-all
              :default-checked-keys="form.permissions"
              @check="handlePermissionCheck"
            />
          </div>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="drawerVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-drawer>
  </el-card>
</template>
