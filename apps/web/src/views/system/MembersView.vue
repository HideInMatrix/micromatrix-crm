<script setup lang="ts">
import type {
  DepartmentVO,
  ExternalIdentityVO,
  MemberVO,
  OrganizationSyncGateVO,
} from '@micromatrix/shared'
import type { FormInstance, FormRules } from 'element-plus'
import { computed, onMounted, reactive, ref } from 'vue'
import { extractErrorMessage } from '@/api/http'
import {
  deptApi,
  externalIdentityApi,
  memberApi,
  organizationSyncApi,
  roleApi,
  type DepartmentForm,
  type MemberForm,
  type MemberOption,
  type RoleOption,
} from '@/api/system'
import { useAuthStore } from '@/stores/auth'
import OrganizationSyncDrawer from './OrganizationSyncDrawer.vue'

const auth = useAuthStore()

const loading = ref(false)
const items = ref<MemberVO[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 10, keyword: '', deptId: '', status: '' })

const deptTree = ref<DepartmentVO[]>([])
const roles = ref<RoleOption[]>([])
const memberOptions = ref<MemberOption[]>([])
const syncDrawerVisible = ref(false)
const syncGateLoading = ref(false)
const syncGate = ref<OrganizationSyncGateVO | null>(null)
const canSync = computed(() => auth.hasPerm('system:dept:sync'))
const selectedDepartment = ref<DepartmentVO | null>(null)
const syncTargetDepartment = computed(() => selectedDepartment.value ?? deptTree.value[0] ?? null)

const identityDialogVisible = ref(false)
const identityLoading = ref(false)
const identitySaving = ref(false)
const identityMember = ref<MemberVO | null>(null)
const externalIdentity = ref<ExternalIdentityVO | null>(null)

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const formRef = ref<FormInstance>()
const form = reactive<MemberForm>({
  email: '',
  name: '',
  password: '',
  roleIds: [],
  deptId: null,
  leaderId: null,
  position: '',
  phone: '',
})

const memberRules: FormRules = {
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '邮箱格式不正确', trigger: 'blur' },
  ],
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  password: [{ required: true, min: 6, message: '密码至少 6 位', trigger: 'blur' }],
  deptId: [{ required: true, message: '请选择所属部门', trigger: 'change' }],
  roleIds: [
    { required: true, type: 'array', min: 1, message: '至少选择一个角色', trigger: 'change' },
  ],
}

const deptDialogVisible = ref(false)
const deptEditingId = ref<string | null>(null)
const deptSaving = ref(false)
const deptFormRef = ref<FormInstance>()
const deptForm = reactive<DepartmentForm>({
  name: '',
  parentId: null,
  leaderId: null,
  sort: 0,
})
const deptRules: FormRules = {
  name: [{ required: true, message: '请输入部门名称', trigger: 'blur' }],
}
const deptLeaderOptions = computed(() =>
  deptEditingId.value
    ? memberOptions.value.filter((member) => member.deptId === deptEditingId.value)
    : [],
)

async function loadData() {
  loading.value = true
  try {
    const { data } = await memberApi.list({
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword.trim() || undefined,
      deptId: query.deptId || undefined,
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

function handleFilterChange() {
  query.page = 1
  void loadData()
}

async function loadRefs() {
  const [{ data: tree }, { data: roleList }, { data: options }] = await Promise.all([
    deptApi.tree(),
    roleApi.options(),
    memberApi.options(),
  ])
  deptTree.value = tree
  roles.value = roleList
  memberOptions.value = options
}

async function loadSyncGate() {
  if (!canSync.value) return
  syncGateLoading.value = true
  try {
    const { data } = await organizationSyncApi.status()
    syncGate.value = data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    syncGateLoading.value = false
  }
}

async function handleSyncCompleted() {
  await Promise.all([loadRefs(), loadData(), loadSyncGate()])
}

function handleDeptSelect(dept: DepartmentVO | null) {
  selectedDepartment.value = dept
  query.deptId = dept?.id ?? ''
  query.page = 1
  loadData()
}

function openDeptCreate(parentId?: string) {
  deptEditingId.value = null
  Object.assign(deptForm, {
    name: '',
    parentId: parentId ?? null,
    leaderId: null,
    sort: 0,
  })
  deptDialogVisible.value = true
}

function openDeptEdit(dept: DepartmentVO) {
  deptEditingId.value = dept.id
  Object.assign(deptForm, {
    name: dept.name,
    parentId: dept.parentId,
    leaderId: dept.leaderId,
    sort: dept.sort,
  })
  deptDialogVisible.value = true
}

async function handleDeptSave() {
  const valid = await deptFormRef.value?.validate().catch(() => false)
  if (!valid) return
  deptSaving.value = true
  try {
    if (deptEditingId.value) {
      await deptApi.update(deptEditingId.value, deptForm)
      ElMessage.success('部门已更新')
    } else {
      await deptApi.create(deptForm)
      ElMessage.success('部门已创建')
    }
    deptDialogVisible.value = false
    await Promise.all([loadRefs(), loadData()])
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    deptSaving.value = false
  }
}

async function handleDeptDelete(dept: DepartmentVO) {
  const confirmed = await ElMessageBox.confirm(
    `确定删除部门「${dept.name}」及其空的下级部门吗？部门下存在成员时不可删除。`,
    '删除部门',
    { type: 'warning' },
  ).catch(() => false)
  if (!confirmed) return
  try {
    await deptApi.remove(dept.id)
    if (query.deptId === dept.id) query.deptId = ''
    ElMessage.success('部门已删除')
    await Promise.all([loadRefs(), loadData()])
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function handleDeptCommand(command: string, dept: DepartmentVO) {
  if (command === 'add') openDeptCreate(dept.id)
  if (command === 'edit') openDeptEdit(dept)
  if (command === 'delete') void handleDeptDelete(dept)
}

function openCreate() {
  editingId.value = null
  Object.assign(form, {
    email: '',
    name: '',
    password: '',
    roleIds: [],
    deptId: query.deptId || null,
    leaderId: null,
    position: '',
    phone: '',
  })
  dialogVisible.value = true
}

function openEdit(row: MemberVO) {
  editingId.value = row.id
  Object.assign(form, {
    email: row.email,
    name: row.name,
    password: undefined,
    roleIds: [...row.roleIds],
    deptId: row.deptId,
    leaderId: row.leaderId,
    position: row.position ?? '',
    phone: row.phone ?? '',
  })
  dialogVisible.value = true
}

async function handleSave() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  saving.value = true
  try {
    const payload: MemberForm = {
      name: form.name.trim(),
      roleIds: [...form.roleIds],
      deptId: form.deptId,
      leaderId: form.leaderId,
      position: form.position?.trim() || undefined,
      phone: form.phone?.trim() || undefined,
    }
    if (editingId.value) {
      await memberApi.update(editingId.value, payload)
      ElMessage.success('成员已更新')
    } else {
      await memberApi.create({ ...payload, email: form.email, password: form.password })
      ElMessage.success('成员已创建')
    }
    dialogVisible.value = false
    loadData()
    loadRefs()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

async function handleResetPassword(row: MemberVO) {
  const result = await ElMessageBox.prompt(`为「${row.name}」设置新密码`, '重置密码', {
    inputPattern: /^.{6,}$/,
    inputErrorMessage: '密码至少 6 位',
    inputType: 'password',
  }).catch(() => null)
  if (!result) return
  try {
    await memberApi.resetPassword(row.id, result.value)
    ElMessage.success('密码已重置')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleToggleStatus(row: MemberVO) {
  const action = row.status === 'ACTIVE' ? '禁用' : '启用'
  const confirmed = await ElMessageBox.confirm(
    `确定${action}「${row.name}」吗？`,
    `${action}确认`,
    {
      type: 'warning',
    },
  ).catch(() => false)
  if (!confirmed) return
  try {
    await memberApi.toggleStatus(row.id)
    ElMessage.success(`已${action}`)
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleDelete(row: MemberVO) {
  const confirmed = await ElMessageBox.confirm(
    `确定删除成员「${row.name}」吗？仅无业务引用的成员可以删除。`,
    '删除确认',
    { type: 'warning' },
  ).catch(() => false)
  if (!confirmed) return
  try {
    await memberApi.remove(row.id)
    ElMessage.success('成员已删除')
    loadData()
    loadRefs()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function openIdentity(row: MemberVO) {
  identityMember.value = row
  externalIdentity.value = null
  identityDialogVisible.value = true
  identityLoading.value = true
  try {
    const { data } = await externalIdentityApi.getWeCom(row.id)
    externalIdentity.value = data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    identityDialogVisible.value = false
  } finally {
    identityLoading.value = false
  }
}

async function bindIdentity() {
  if (!identityMember.value) return
  identitySaving.value = true
  try {
    const { data } = await externalIdentityApi.bindWeCom(identityMember.value.id)
    externalIdentity.value = data
    ElMessage.success(data.status === 'ACTIVE' ? '企业微信登录身份已绑定' : '操作已完成')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    identitySaving.value = false
  }
}

async function unbindIdentity() {
  if (!identityMember.value) return
  const confirmed = await ElMessageBox.confirm(
    `解绑后，「${identityMember.value.name}」将不能再使用企业微信扫码登录。确定继续？`,
    '解绑企业微信身份',
    { type: 'warning' },
  ).catch(() => false)
  if (!confirmed) return
  identitySaving.value = true
  try {
    const { data } = await externalIdentityApi.unbindWeCom(identityMember.value.id)
    externalIdentity.value = data
    ElMessage.success('企业微信登录身份已解绑')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    identitySaving.value = false
  }
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-'
}

onMounted(() => {
  loadData()
  loadRefs()
  loadSyncGate()
})
</script>

<template>
  <div class="flex gap-4 h-full">
    <el-card shadow="never" class="w-60 shrink-0">
      <div class="flex-between mb-3">
        <div class="text-sm font-medium">部门</div>
        <el-button
          v-if="auth.hasPerm('system:dept:create')"
          link
          type="primary"
          @click="openDeptCreate()"
        >
          新建
        </el-button>
      </div>
      <el-tree
        :data="deptTree"
        :props="{ label: 'name', children: 'children' }"
        node-key="id"
        default-expand-all
        highlight-current
        @current-change="handleDeptSelect"
      >
        <template #default="{ data }">
          <div class="flex min-w-0 flex-1 items-center gap-1">
            <span class="min-w-0 flex-1 truncate">{{ data.name }}</span>
            <el-dropdown
              v-if="auth.hasPerm('system:dept:create') || auth.hasPerm('system:dept:update')"
              trigger="click"
              @command="handleDeptCommand($event, data as DepartmentVO)"
            >
              <el-button link size="small" @click.stop>···</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-if="auth.hasPerm('system:dept:create')" command="add">
                    添加下级
                  </el-dropdown-item>
                  <el-dropdown-item v-if="auth.hasPerm('system:dept:update')" command="edit">
                    编辑部门
                  </el-dropdown-item>
                  <el-dropdown-item
                    v-if="data.parentId && auth.hasPerm('system:dept:delete')"
                    command="delete"
                    divided
                  >
                    删除部门
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </template>
      </el-tree>
      <el-button link size="small" class="mt-2" @click="handleDeptSelect(null)">
        清除部门筛选
      </el-button>
    </el-card>

    <el-card shadow="never" class="flex-1 min-w-0">
      <div class="flex-between flex-wrap gap-3 mb-4">
        <div class="flex gap-2">
          <el-input
            v-model="query.keyword"
            placeholder="搜索姓名 / 邮箱 / 电话"
            clearable
            class="!w-64"
            @keyup.enter="handleFilterChange"
            @clear="handleFilterChange"
          />
          <el-select
            v-model="query.status"
            clearable
            placeholder="全部状态"
            class="!w-32"
            @change="handleFilterChange"
          >
            <el-option label="启用" value="ACTIVE" />
            <el-option label="禁用" value="DISABLED" />
          </el-select>
        </div>
        <div class="flex gap-2">
          <el-tooltip
            v-if="canSync"
            :disabled="!syncGate?.disabledReason"
            :content="syncGate?.disabledReason || ''"
            placement="top"
          >
            <span>
              <el-button
                :disabled="Boolean(syncGate?.disabledReason)"
                :loading="syncGateLoading"
                @click="syncDrawerVisible = true"
              >
                企业微信同步
              </el-button>
            </span>
          </el-tooltip>
          <el-button v-if="auth.hasPerm('system:member:create')" type="primary" @click="openCreate">
            新建成员
          </el-button>
        </div>
      </div>

      <el-table v-loading="loading" :data="items" stripe>
        <el-table-column prop="name" label="姓名" width="110" />
        <el-table-column prop="email" label="邮箱" min-width="200" show-overflow-tooltip />
        <el-table-column label="部门" width="130">
          <template #default="{ row }">{{ row.deptName || '-' }}</template>
        </el-table-column>
        <el-table-column label="角色" min-width="180">
          <template #default="{ row }">
            <div class="flex flex-wrap gap-1">
              <el-tag v-for="role in row.roles" :key="role.id" size="small" effect="plain">
                {{ role.name }}
              </el-tag>
              <span v-if="row.roles.length === 0">-</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="职位" width="120">
          <template #default="{ row }">{{ row.position || '-' }}</template>
        </el-table-column>
        <el-table-column label="直属上级" width="110">
          <template #default="{ row }">{{ row.leaderName || '-' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 'ACTIVE' ? 'success' : 'danger'" size="small">
              {{ row.status === 'ACTIVE' ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="340" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="auth.hasPerm('system:member')"
              link
              @click="openIdentity(row as MemberVO)"
            >
              登录身份
            </el-button>
            <el-button
              v-if="auth.hasPerm('system:member:update')"
              link
              type="primary"
              @click="openEdit(row as MemberVO)"
            >
              编辑
            </el-button>
            <el-button
              v-if="auth.hasPerm('system:member:resetPassword')"
              link
              @click="handleResetPassword(row as MemberVO)"
            >
              重置密码
            </el-button>
            <el-button
              v-if="row.id !== auth.user?.id && auth.hasPerm('system:member:status')"
              link
              :type="row.status === 'ACTIVE' ? 'danger' : 'success'"
              @click="handleToggleStatus(row as MemberVO)"
            >
              {{ row.status === 'ACTIVE' ? '禁用' : '启用' }}
            </el-button>
            <el-button
              v-if="row.id !== auth.user?.id && auth.hasPerm('system:member:delete')"
              link
              type="danger"
              @click="handleDelete(row as MemberVO)"
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
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑成员' : '新建成员'"
      width="520px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="memberRules" label-width="90px">
        <el-form-item v-if="!editingId" label="邮箱" prop="email">
          <el-input v-model="form.email" placeholder="登录账号" />
        </el-form-item>
        <el-form-item label="姓名" prop="name">
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item v-if="!editingId" label="初始密码" prop="password">
          <el-input v-model="form.password" type="password" show-password />
        </el-form-item>
        <el-form-item label="部门" prop="deptId">
          <el-tree-select
            v-model="form.deptId"
            :data="deptTree"
            :props="{ label: 'name', children: 'children' }"
            node-key="id"
            check-strictly
            clearable
            class="w-full"
          />
        </el-form-item>
        <el-form-item label="角色" prop="roleIds">
          <el-select v-model="form.roleIds" multiple filterable class="w-full">
            <el-option v-for="r in roles" :key="r.id" :label="r.name" :value="r.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="直属上级">
          <el-select v-model="form.leaderId" clearable filterable class="w-full">
            <el-option
              v-for="m in memberOptions.filter((o) => o.id !== editingId)"
              :key="m.id"
              :label="m.name"
              :value="m.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="职位">
          <el-input v-model="form.position" />
        </el-form-item>
        <el-form-item label="电话">
          <el-input v-model="form.phone" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="identityDialogVisible"
      title="企业微信登录身份"
      width="520px"
      destroy-on-close
    >
      <div v-loading="identityLoading" class="min-h-44">
        <el-alert type="info" :closable="false" show-icon class="mb-4">
          <template #title>
            身份来自企业微信组织同步。绑定后，成员可在登录页使用企业微信扫码登录。
          </template>
        </el-alert>
        <el-descriptions v-if="externalIdentity && identityMember" :column="1" border>
          <el-descriptions-item label="本地成员">{{ identityMember.name }}</el-descriptions-item>
          <el-descriptions-item label="企业微信 UserID">
            {{ externalIdentity.externalSubject || '尚未发现成员映射' }}
          </el-descriptions-item>
          <el-descriptions-item label="登录状态">
            <el-tag
              v-if="externalIdentity.status"
              :type="externalIdentity.status === 'ACTIVE' ? 'success' : 'info'"
            >
              {{ externalIdentity.status === 'ACTIVE' ? '已绑定' : '已解绑' }}
            </el-tag>
            <span v-else>未绑定</span>
          </el-descriptions-item>
          <el-descriptions-item label="绑定时间">
            {{ formatDate(externalIdentity.boundAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="最近登录">
            {{ formatDate(externalIdentity.lastLoginAt) }}
          </el-descriptions-item>
        </el-descriptions>
      </div>
      <template #footer>
        <el-button @click="identityDialogVisible = false">关闭</el-button>
        <el-tooltip
          v-if="externalIdentity?.status === 'ACTIVE' && !identityMember?.passwordLoginEnabled"
          content="该成员未启用密码登录，不能解绑其唯一登录方式"
        >
          <span>
            <el-button disabled>解绑</el-button>
          </span>
        </el-tooltip>
        <el-button
          v-else-if="externalIdentity?.status === 'ACTIVE'"
          type="danger"
          plain
          :loading="identitySaving"
          :disabled="!auth.hasPerm('system:member:update')"
          @click="unbindIdentity"
        >
          解绑
        </el-button>
        <el-button
          v-else
          type="primary"
          :loading="identitySaving"
          :disabled="!externalIdentity?.mapped || !auth.hasPerm('system:member:update')"
          @click="bindIdentity"
        >
          {{ externalIdentity?.status === 'REVOKED' ? '重新绑定' : '绑定身份' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="deptDialogVisible"
      :title="deptEditingId ? '编辑部门' : '新建部门'"
      width="460px"
      destroy-on-close
    >
      <el-form ref="deptFormRef" :model="deptForm" :rules="deptRules" label-width="90px">
        <el-form-item label="部门名称" prop="name">
          <el-input v-model="deptForm.name" placeholder="请输入部门名称" />
        </el-form-item>
        <el-form-item label="上级部门">
          <el-tree-select
            v-model="deptForm.parentId"
            :data="deptTree"
            :props="{ label: 'name', children: 'children' }"
            node-key="id"
            check-strictly
            clearable
            placeholder="不选则为顶级部门"
            class="w-full"
          />
        </el-form-item>
        <el-form-item v-if="deptEditingId" label="部门主管">
          <el-select
            v-model="deptForm.leaderId"
            clearable
            filterable
            placeholder="仅可选择当前部门直属成员"
            class="w-full"
          >
            <el-option
              v-for="member in deptLeaderOptions"
              :key="member.id"
              :label="member.name"
              :value="member.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="deptForm.sort" :min="0" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="deptDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="deptSaving" @click="handleDeptSave">保存</el-button>
      </template>
    </el-dialog>
  </div>

  <OrganizationSyncDrawer
    v-if="canSync"
    v-model="syncDrawerVisible"
    :target-department-id="syncTargetDepartment?.id ?? ''"
    :target-department-name="syncTargetDepartment?.name ?? ''"
    @synced="handleSyncCompleted"
  />
</template>
