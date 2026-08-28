<script setup lang="ts">
import type { FormInstance, FormRules } from 'element-plus'
import { computed, reactive, ref, watch } from 'vue'
import {
  dashboardApi,
  type DashboardTreeNode,
  type SaveDashboardInput,
} from '@/api/dashboard'
import { extractErrorMessage } from '@/api/http'

const props = defineProps<{
  dashboardId?: string
  defaultModuleId?: string
  folderTree: DashboardTreeNode[]
  scopeOptions: Array<{ label: string; value: string }>
}>()

const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ saved: [] }>()

const formRef = ref<FormInstance>()
const saving = ref(false)
const loading = ref(false)
const form = reactive<SaveDashboardInput>({
  name: '',
  resourceUrl: '',
  dashboardModuleId: '',
  scopeIds: [],
  description: '',
})

const rules: FormRules<SaveDashboardInput> = {
  name: [{ required: true, message: '请输入仪表板名称', trigger: 'blur' }],
  resourceUrl: [{ required: true, message: '请输入仪表板 URL', trigger: 'blur' }],
  dashboardModuleId: [{ required: true, message: '请选择文件夹', trigger: 'change' }],
}

const title = computed(() => (props.dashboardId ? '编辑仪表板' : '新建仪表板'))

const moduleTree = computed(() => {
  const mapModules = (nodes: DashboardTreeNode[]): DashboardTreeNode[] =>
    nodes
      .filter((node) => node.type === 'MODULE')
      .map((node) => ({
        ...node,
        children: mapModules(node.children ?? []),
      }))
  return mapModules(props.folderTree)
})

function firstModuleId(nodes = moduleTree.value): string {
  for (const node of nodes) {
    if (node.id) return node.id
    const child = firstModuleId(node.children ?? [])
    if (child) return child
  }
  return ''
}

function reset() {
  form.name = ''
  form.resourceUrl = ''
  form.dashboardModuleId = props.defaultModuleId || firstModuleId()
  form.scopeIds = []
  form.description = ''
  formRef.value?.clearValidate()
}

async function loadDetail() {
  if (!props.dashboardId) return
  loading.value = true
  try {
    const { data } = await dashboardApi.detail(props.dashboardId)
    form.name = data.name
    form.resourceUrl = data.resourceUrl
    form.dashboardModuleId = data.dashboardModuleId
    form.scopeIds = [...data.scopeIds]
    form.description = data.description ?? ''
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    visible.value = false
  } finally {
    loading.value = false
  }
}

async function save(continueCreate = false) {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
  } catch {
    return
  }

  saving.value = true
  try {
    const payload: SaveDashboardInput = {
      name: form.name.trim(),
      resourceUrl: form.resourceUrl.trim(),
      dashboardModuleId: form.dashboardModuleId,
      scopeIds: [...form.scopeIds],
      description: form.description?.trim() || undefined,
    }
    if (props.dashboardId) {
      await dashboardApi.update({ id: props.dashboardId, ...payload })
      ElMessage.success('仪表板已更新')
    } else {
      await dashboardApi.add(payload)
      ElMessage.success('仪表板已创建')
    }
    emit('saved')
    if (!props.dashboardId && continueCreate) {
      const moduleId = form.dashboardModuleId
      reset()
      form.dashboardModuleId = moduleId
    } else {
      visible.value = false
    }
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

watch(
  () => visible.value,
  async (open) => {
    if (!open) return
    reset()
    if (props.dashboardId) await loadDetail()
  },
)
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title"
    width="680px"
    destroy-on-close
    data-testid="dashboard-form-dialog"
  >
    <div v-loading="loading">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="仪表板名称" prop="name">
          <el-input v-model="form.name" maxlength="255" show-word-limit />
        </el-form-item>
        <el-form-item label="仪表板 URL" prop="resourceUrl">
          <el-input
            v-model="form.resourceUrl"
            maxlength="500"
            placeholder="https://example.com/dashboard"
          />
          <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
            仅允许 HTTPS；本地开发可使用 localhost HTTP。
          </div>
        </el-form-item>
        <el-form-item label="文件夹" prop="dashboardModuleId">
          <el-tree-select
            v-model="form.dashboardModuleId"
            :data="moduleTree"
            node-key="id"
            value-key="id"
            check-strictly
            filterable
            class="w-full"
            :props="{ label: 'name', children: 'children' }"
          />
        </el-form-item>
        <el-form-item label="成员范围">
          <el-select
            v-model="form.scopeIds"
            multiple
            filterable
            collapse-tags
            collapse-tags-tooltip
            clearable
            class="w-full"
            placeholder="留空表示所有有查看权限的成员"
          >
            <el-option
              v-for="option in props.scopeOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="4"
            maxlength="1000"
            show-word-limit
          />
        </el-form-item>
      </el-form>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button
        v-if="!props.dashboardId"
        :loading="saving"
        @click="save(true)"
      >
        保存并继续新增
      </el-button>
      <el-button type="primary" :loading="saving" @click="save(false)">
        {{ props.dashboardId ? '更新' : '保存' }}
      </el-button>
    </template>
  </el-dialog>
</template>
