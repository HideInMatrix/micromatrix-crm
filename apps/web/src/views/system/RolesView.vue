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
import { computed, onMounted, reactive, ref } from 'vue'
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

const activeTab = ref('permission')
const memberLoading = ref(false)
const memberSaving = ref(false)
const selectedRole = ref<RoleVO | null>(null)
const roleMembers = ref<MemberVO[]>([])
const memberTotal = ref(0)
const memberQuery = reactive({ page: 1, pageSize: 10, keyword: '' })
const memberOptions = ref<MemberOption[]>([])
const addingUserIds = ref<string[]>([])
const activeRole = computed(() => selectedRole.value)

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
    const currentId = selectedRole.value?.id
    selectedRole.value = roles.value.find((role) => role.id === currentId) ?? roles.value[0] ?? null
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

function selectRole(role: RoleVO) {
  selectedRole.value = role
  activeTab.value = 'permission'
  roleMembers.value = []
  memberTotal.value = 0
}

async function handleTabChange(tabName: string | number) {
  if (tabName !== 'members' || !selectedRole.value) return
  memberQuery.page = 1
  memberQuery.keyword = ''
  addingUserIds.value = []
  try {
    const [{ data: options }] = await Promise.all([memberApi.options(), loadRoleMembers()])
    memberOptions.value = options
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
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
  <div v-loading="loading" class="grid min-h-[620px] grid-cols-[280px_minmax(0,1fr)] gap-4">
    <el-card shadow="never" body-class="!p-0">
      <div class="flex-between border-b border-[var(--el-border-color-lighter)] px-4 py-4">
        <div>
          <div class="font-medium">角色</div>
          <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">按角色配置权限和成员</div>
        </div>
        <el-button v-if="auth.hasPerm('system:role:create')" type="primary" @click="openCreate">
          新建
        </el-button>
      </div>
      <button
        v-for="role in roles"
        :key="role.id"
        type="button"
        class="flex w-full items-center gap-2 border-b border-[var(--el-border-color-lighter)] px-4 py-3 text-left text-sm hover:bg-[var(--el-fill-color-light)]"
        :class="activeRole?.id === role.id ? 'bg-[var(--el-color-primary-light-9)] text-[var(--el-color-primary)]' : ''"
        @click="selectRole(role)"
      >
        <span class="min-w-0 flex-1 truncate">{{ role.name }}</span>
        <el-tag v-if="role.isSystem" size="small" type="info">内置</el-tag>
        <span class="text-xs text-[var(--el-text-color-placeholder)]">{{ role.userCount ?? 0 }}</span>
        <el-dropdown v-if="!role.isSystem" trigger="click" @click.stop>
          <span class="px-1">···</span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item
                v-if="auth.hasPerm('system:role:update')"
                @click="openEdit(role)"
              >
                编辑
              </el-dropdown-item>
              <el-dropdown-item
                v-if="auth.hasPerm('system:role:delete')"
                divided
                @click="handleDelete(role)"
              >
                删除
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </button>
    </el-card>

    <el-card v-if="activeRole" shadow="never" body-class="!p-0">
      <div class="flex-between border-b border-[var(--el-border-color-lighter)] px-6 py-4">
        <div>
          <div class="flex items-center gap-2 font-medium">
            {{ activeRole.name }}
            <el-tag v-if="activeRole.isSystem" size="small" type="info">系统内置</el-tag>
          </div>
          <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
            {{ activeRole.remark || '暂无备注' }}
          </div>
        </div>
        <el-button
          v-if="!activeRole.isSystem && auth.hasPerm('system:role:update')"
          type="primary"
          plain
          @click="openEdit(activeRole)"
        >
          编辑角色
        </el-button>
      </div>

      <el-tabs v-model="activeTab" class="role-tabs px-6" @tab-change="handleTabChange">
        <el-tab-pane label="权限" name="permission">
          <div class="pb-6 pt-2">
            <div class="mb-5 rounded bg-[var(--el-fill-color-lighter)] px-4 py-3 text-sm">
              <span class="text-[var(--el-text-color-secondary)]">数据范围：</span>
              <span class="font-medium">{{ scopeLabel(activeRole.dataScope) }}</span>
              <span
                v-if="activeRole.dataScope === 'CUSTOM'"
                class="ml-2 text-xs text-[var(--el-text-color-secondary)]"
              >
                已指定 {{ activeRole.scopeDeptIds.length }} 个部门
              </span>
            </div>
            <el-alert
              v-if="activeRole.permissions.includes('*')"
              title="该角色拥有全部功能权限"
              type="success"
              :closable="false"
              class="mb-4"
            />
            <div class="mb-2 text-sm font-medium">功能权限</div>
            <div class="max-h-[450px] overflow-auto rounded border border-[var(--el-border-color)] p-3">
              <el-tree
                :key="activeRole.id"
                :data="PERMISSION_TREE"
                :props="{ label: 'label', children: 'children', disabled: () => true }"
                node-key="code"
                show-checkbox
                check-strictly
                default-expand-all
                :default-checked-keys="activeRole.permissions"
              />
            </div>
          </div>
        </el-tab-pane>

        <el-tab-pane label="成员" name="members">
          <div class="pb-6 pt-2">
            <div class="mb-4 flex flex-wrap gap-2">
              <el-select
                v-if="auth.hasPerm('system:role:update')"
                v-model="addingUserIds"
                multiple
                filterable
                collapse-tags
                placeholder="选择要添加的成员"
                class="min-w-72 flex-1"
              >
                <el-option
                  v-for="member in availableMemberOptions()"
                  :key="member.id"
                  :label="member.name"
                  :value="member.id"
                />
              </el-select>
              <el-button
                v-if="auth.hasPerm('system:role:update')"
                type="primary"
                :disabled="addingUserIds.length === 0"
                :loading="memberSaving"
                @click="handleAddMembers"
              >
                添加成员
              </el-button>
              <el-input
                v-model="memberQuery.keyword"
                placeholder="搜索姓名 / 邮箱"
                clearable
                class="!w-60"
                @keyup.enter="memberQuery.page = 1; loadRoleMembers()"
                @clear="memberQuery.page = 1; loadRoleMembers()"
              />
            </div>
            <el-table v-loading="memberLoading" :data="roleMembers" stripe>
              <el-table-column prop="name" label="姓名" width="110" />
              <el-table-column prop="email" label="邮箱" min-width="190" show-overflow-tooltip />
              <el-table-column prop="deptName" label="部门" width="130" />
              <el-table-column label="全部角色" min-width="180">
                <template #default="{ row }">
                  <el-tag
                    v-for="role in row.roles"
                    :key="role.id"
                    size="small"
                    effect="plain"
                    class="mr-1"
                  >
                    {{ role.name }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column v-if="auth.hasPerm('system:role:update')" label="操作" width="70">
                <template #default="{ row }">
                  <el-button
                    link
                    type="danger"
                    :disabled="activeRole?.isSystem"
                    @click="handleRemoveMember(row as MemberVO)"
                  >
                    移除
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
            <div class="mt-4 flex justify-end">
              <el-pagination
                v-model:current-page="memberQuery.page"
                :page-size="memberQuery.pageSize"
                :total="memberTotal"
                layout="total, prev, pager, next"
                @current-change="loadRoleMembers"
              />
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>

  <el-drawer
    v-model="drawerVisible"
    :title="editingId ? '编辑角色' : '新建角色'"
    size="500px"
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
        <div class="max-h-96 w-full overflow-auto rounded border border-[var(--el-border-color)] p-2">
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
</template>
