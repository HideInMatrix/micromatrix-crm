<script setup lang="ts">
import {
  DATA_SCOPE_OPTIONS,
  PERMISSION_TREE,
  permissionAncestorMap,
  type DepartmentVO,
  type MemberVO,
  type PermissionNode,
  type RoleVO,
} from '@micromatrix/shared'
import type { ElTree, FormInstance, FormRules } from 'element-plus'
import { onMounted, reactive, ref } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { deptApi, memberApi, roleApi, type MemberOption, type RoleForm } from '@/api/system'
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

const memberDrawerVisible = ref(false)
const memberLoading = ref(false)
const memberSaving = ref(false)
const selectedRole = ref<RoleVO | null>(null)
const roleMembers = ref<MemberVO[]>([])
const memberTotal = ref(0)
const memberQuery = reactive({ page: 1, pageSize: 10, keyword: '' })
const memberOptions = ref<MemberOption[]>([])
const addingUserIds = ref<string[]>([])

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

async function loadRoleMembers() {
  if (!selectedRole.value) return
  memberLoading.value = true
  try {
    const { data } = await roleApi.members(selectedRole.value.id, {
      page: memberQuery.page,
      pageSize: memberQuery.pageSize,
      keyword: memberQuery.keyword.trim() || undefined,
    })
    roleMembers.value = data.items
    memberTotal.value = data.total
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    memberLoading.value = false
  }
}

async function openMembers(row: RoleVO) {
  selectedRole.value = row
  memberQuery.page = 1
  memberQuery.keyword = ''
  addingUserIds.value = []
  memberDrawerVisible.value = true
  const [{ data: options }] = await Promise.all([memberApi.options(), loadRoleMembers()])
  memberOptions.value = options
}

async function handleAddMembers() {
  if (!selectedRole.value || addingUserIds.value.length === 0) return
  memberSaving.value = true
  try {
    await roleApi.addMembers(selectedRole.value.id, addingUserIds.value)
    ElMessage.success('角色成员已添加')
    addingUserIds.value = []
    await Promise.all([loadRoleMembers(), loadData()])
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    memberSaving.value = false
  }
}

async function handleRemoveMember(member: MemberVO) {
  if (!selectedRole.value) return
  const confirmed = await ElMessageBox.confirm(
    `确定从「${selectedRole.value.name}」移除成员「${member.name}」吗？`,
    '移除确认',
    { type: 'warning' },
  ).catch(() => false)
  if (!confirmed) return
  try {
    await roleApi.removeMember(selectedRole.value.id, member.id)
    ElMessage.success('角色成员已移除')
    await Promise.all([loadRoleMembers(), loadData()])
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function availableMemberOptions() {
  const related = new Set(roleMembers.value.map((member) => member.id))
  return memberOptions.value.filter((member) => !related.has(member.id))
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
      <el-table-column label="操作" width="210" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openMembers(row as RoleVO)">成员</el-button>
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

  <el-drawer
    v-model="memberDrawerVisible"
    :title="`${selectedRole?.name ?? ''} · 成员`"
    size="640px"
    destroy-on-close
  >
    <div v-if="auth.hasPerm('system:role:update')" class="flex gap-2 mb-4">
      <el-select
        v-model="addingUserIds"
        multiple
        filterable
        collapse-tags
        placeholder="选择要添加的成员"
        class="flex-1"
      >
        <el-option
          v-for="member in availableMemberOptions()"
          :key="member.id"
          :label="member.name"
          :value="member.id"
        />
      </el-select>
      <el-button
        type="primary"
        :disabled="addingUserIds.length === 0"
        :loading="memberSaving"
        @click="handleAddMembers"
      >
        添加成员
      </el-button>
    </div>
    <el-input
      v-model="memberQuery.keyword"
      placeholder="搜索姓名 / 邮箱"
      clearable
      class="mb-3"
      @keyup.enter="memberQuery.page = 1; loadRoleMembers()"
      @clear="memberQuery.page = 1; loadRoleMembers()"
    />
    <el-table v-loading="memberLoading" :data="roleMembers" stripe>
      <el-table-column prop="name" label="姓名" width="110" />
      <el-table-column prop="email" label="邮箱" min-width="190" show-overflow-tooltip />
      <el-table-column prop="deptName" label="部门" width="120" />
      <el-table-column label="全部角色" min-width="160">
        <template #default="{ row }">
          <el-tag v-for="role in row.roles" :key="role.id" size="small" effect="plain" class="mr-1">
            {{ role.name }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column v-if="auth.hasPerm('system:role:update')" label="操作" width="70">
        <template #default="{ row }">
          <el-button
            link
            type="danger"
            :disabled="selectedRole?.isSystem"
            @click="handleRemoveMember(row as MemberVO)"
          >
            移除
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <div class="flex justify-end mt-4">
      <el-pagination
        v-model:current-page="memberQuery.page"
        :page-size="memberQuery.pageSize"
        :total="memberTotal"
        layout="total, prev, pager, next"
        @current-change="loadRoleMembers"
      />
    </div>
  </el-drawer>
</template>
