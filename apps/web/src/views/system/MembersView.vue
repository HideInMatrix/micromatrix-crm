<script setup lang="ts">
import type { DepartmentVO, MemberVO } from '@micromatrix/shared'
import type { FormInstance, FormRules } from 'element-plus'
import { onMounted, reactive, ref } from 'vue'
import { extractErrorMessage } from '@/api/http'
import {
  deptApi,
  memberApi,
  roleApi,
  type MemberForm,
  type MemberOption,
  type RoleOption,
} from '@/api/system'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const loading = ref(false)
const items = ref<MemberVO[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 10, keyword: '', deptId: '', status: '' })

const deptTree = ref<DepartmentVO[]>([])
const roles = ref<RoleOption[]>([])
const memberOptions = ref<MemberOption[]>([])

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

const rules: FormRules = {
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '邮箱格式不正确', trigger: 'blur' },
  ],
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  password: [{ required: true, min: 6, message: '密码至少 6 位', trigger: 'blur' }],
  deptId: [{ required: true, message: '请选择所属部门', trigger: 'change' }],
  roleIds: [{ required: true, type: 'array', min: 1, message: '至少选择一个角色', trigger: 'change' }],
}

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

function handleDeptSelect(dept: DepartmentVO | null) {
  query.deptId = dept?.id ?? ''
  query.page = 1
  loadData()
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
  const confirmed = await ElMessageBox.confirm(`确定${action}「${row.name}」吗？`, `${action}确认`, {
    type: 'warning',
  }).catch(() => false)
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

onMounted(() => {
  loadData()
  loadRefs()
})
</script>

<template>
  <div class="flex gap-4 h-full">
    <el-card shadow="never" class="w-60 shrink-0">
      <div class="text-sm font-medium mb-3">部门</div>
      <el-tree
        :data="deptTree"
        :props="{ label: 'name', children: 'children' }"
        node-key="id"
        default-expand-all
        highlight-current
        @current-change="handleDeptSelect"
      />
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
            @keyup.enter="query.page = 1; loadData()"
            @clear="query.page = 1; loadData()"
          />
          <el-select
            v-model="query.status"
            clearable
            placeholder="全部状态"
            class="!w-32"
            @change="query.page = 1; loadData()"
          >
            <el-option label="启用" value="ACTIVE" />
            <el-option label="禁用" value="DISABLED" />
          </el-select>
        </div>
        <el-button v-if="auth.hasPerm('system:member:create')" type="primary" @click="openCreate">
          新建成员
        </el-button>
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
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
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
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
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
  </div>
</template>
