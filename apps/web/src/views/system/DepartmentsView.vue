<script setup lang="ts">
import type { DepartmentVO } from '@micromatrix/shared'
import type { FormInstance, FormRules } from 'element-plus'
import { computed, onMounted, reactive, ref } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { deptApi, memberApi, type DepartmentForm, type MemberOption } from '@/api/system'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const loading = ref(false)
const tree = ref<DepartmentVO[]>([])
const memberOptions = ref<MemberOption[]>([])

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const formRef = ref<FormInstance>()
const form = reactive<DepartmentForm>({ name: '', parentId: null, leaderId: null, sort: 0 })

const leaderOptions = computed(() =>
  editingId.value
    ? memberOptions.value.filter((member) => member.deptId === editingId.value)
    : [],
)

const rules: FormRules = {
  name: [{ required: true, message: '请输入部门名称', trigger: 'blur' }],
}

async function loadData() {
  loading.value = true
  try {
    const [{ data: treeData }, { data: members }] = await Promise.all([
      deptApi.tree(),
      memberApi.options(),
    ])
    tree.value = treeData
    memberOptions.value = members
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function openCreate(parentId?: string) {
  editingId.value = null
  Object.assign(form, { name: '', parentId: parentId ?? null, leaderId: null, sort: 0 })
  dialogVisible.value = true
}

function openEdit(row: DepartmentVO) {
  editingId.value = row.id
  Object.assign(form, {
    name: row.name,
    parentId: row.parentId,
    leaderId: row.leaderId,
    sort: row.sort,
  })
  dialogVisible.value = true
}

async function handleSave() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  saving.value = true
  try {
    if (editingId.value) {
      await deptApi.update(editingId.value, form)
      ElMessage.success('部门已更新')
    } else {
      await deptApi.create(form)
      ElMessage.success('部门已创建')
    }
    dialogVisible.value = false
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

async function handleDelete(row: DepartmentVO) {
  const confirmed = await ElMessageBox.confirm(`确定删除部门「${row.name}」吗？`, '删除确认', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await deptApi.remove(row.id)
    ElMessage.success('已删除')
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

onMounted(loadData)
</script>

<template>
  <el-card shadow="never">
    <div class="flex-between mb-4">
      <span class="text-sm text-[var(--el-text-color-secondary)]">
        组织架构树，支持多级部门
      </span>
      <el-button v-if="auth.hasPerm('system:dept:create')" type="primary" @click="openCreate()">
        新建部门
      </el-button>
    </div>

    <el-table
      v-loading="loading"
      :data="tree"
      row-key="id"
      default-expand-all
      :tree-props="{ children: 'children' }"
    >
      <el-table-column prop="name" label="部门名称" min-width="240" />
      <el-table-column label="部门主管" width="140">
        <template #default="{ row }">{{ row.leaderName || '-' }}</template>
      </el-table-column>
      <el-table-column prop="userCount" label="成员数" width="100" />
      <el-table-column prop="sort" label="排序" width="80" />
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }">
          <el-button
            v-if="auth.hasPerm('system:dept:create')"
            link
            type="primary"
            @click="openCreate(row.id)"
          >
            添加下级
          </el-button>
          <el-button
            v-if="auth.hasPerm('system:dept:update')"
            link
            type="primary"
            @click="openEdit(row as DepartmentVO)"
          >
            编辑
          </el-button>
          <el-button
            v-if="row.parentId && auth.hasPerm('system:dept:delete')"
            link
            type="danger"
            @click="handleDelete(row as DepartmentVO)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑部门' : '新建部门'"
      width="460px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="部门名称" prop="name">
          <el-input v-model="form.name" placeholder="请输入部门名称" />
        </el-form-item>
        <el-form-item label="上级部门">
          <el-tree-select
            v-model="form.parentId"
            :data="tree"
            :props="{ label: 'name', children: 'children' }"
            node-key="id"
            check-strictly
            clearable
            placeholder="不选则为顶级部门"
            class="w-full"
          />
        </el-form-item>
        <el-form-item v-if="editingId" label="部门主管">
          <el-select
            v-model="form.leaderId"
            clearable
            filterable
            placeholder="仅可选择当前部门直属成员"
            class="w-full"
          >
            <el-option v-for="m in leaderOptions" :key="m.id" :label="m.name" :value="m.id" />
          </el-select>
          <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
            主管用于部门主管审批；成员移出本部门或被停用后会自动清除。
          </div>
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sort" :min="0" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>
