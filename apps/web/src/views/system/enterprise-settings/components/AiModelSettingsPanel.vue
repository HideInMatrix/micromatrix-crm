<script setup lang="ts">
import type {
  EnterpriseAiModelVO,
  EnterpriseAiProvider,
  SaveEnterpriseAiModelInput,
} from '@micromatrix/shared'
import type { FormInstance, FormRules } from 'element-plus'
import { computed, onMounted, reactive, ref } from 'vue'
import { enterpriseAiModelApi } from '@/api/enterprise-settings'
import { extractErrorMessage } from '@/api/http'
import { useAuthStore } from '@/stores/auth'

type ModelForm = {
  displayName: string
  modelName: string
  provider: EnterpriseAiProvider
  apiUrl: string
  apiKey: string
  enable: boolean
  temperature: number
  maxTokens: number
  topP: number
  globalDailyLimit?: number
  userDailyLimit?: number
}

const providers: EnterpriseAiProvider[] = [
  'OpenAI',
  'DeepSeek',
  '阿里云',
  'Anthropic',
  '腾讯云',
  '自定义',
]
const auth = useAuthStore()
const canUpdate = computed(() => auth.hasPerm('system:setting:update'))
const loading = ref(false)
const saving = ref(false)
const keyword = ref('')
const models = ref<EnterpriseAiModelVO[]>([])
const drawerVisible = ref(false)
const editingId = ref<string | null>(null)
const formRef = ref<FormInstance>()
const routeVisible = ref(false)
const routeLoading = ref(false)
const routeSaving = ref(false)
const routeIds = ref<string[]>([])

const form = reactive<ModelForm>({
  displayName: '',
  modelName: '',
  provider: 'OpenAI',
  apiUrl: 'https://api.openai.com/v1',
  apiKey: '',
  enable: true,
  temperature: 0.7,
  maxTokens: 2048,
  topP: 0.9,
  globalDailyLimit: undefined,
  userDailyLimit: undefined,
})

const rules: FormRules = {
  displayName: [{ required: true, message: '请输入显示名称', trigger: 'blur' }],
  modelName: [{ required: true, message: '请输入模型 ID', trigger: 'blur' }],
  provider: [{ required: true, message: '请选择供应商', trigger: 'change' }],
  apiUrl: [{ required: true, message: '请输入 API Base URL', trigger: 'blur' }],
}

const enabledModels = computed(() => models.value.filter((item) => item.enable))
const selectedRouteRows = computed(() =>
  routeIds.value
    .map((id) => models.value.find((item) => item.id === id))
    .filter((item): item is EnterpriseAiModelVO => Boolean(item)),
)

async function loadModels() {
  loading.value = true
  try {
    const { data } = await enterpriseAiModelApi.list(keyword.value.trim() || undefined)
    models.value = data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function resetForm() {
  Object.assign(form, {
    displayName: '',
    modelName: '',
    provider: 'OpenAI',
    apiUrl: 'https://api.openai.com/v1',
    apiKey: '',
    enable: true,
    temperature: 0.7,
    maxTokens: 2048,
    topP: 0.9,
    globalDailyLimit: undefined,
    userDailyLimit: undefined,
  } satisfies ModelForm)
}

function openCreate() {
  editingId.value = null
  resetForm()
  drawerVisible.value = true
}

function openEdit(rowValue: unknown) {
  const row = rowValue as EnterpriseAiModelVO
  editingId.value = row.id
  Object.assign(form, {
    displayName: row.displayName,
    modelName: row.modelName,
    provider: row.provider,
    apiUrl: row.apiUrl,
    apiKey: '',
    enable: row.enable,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    topP: row.topP,
    globalDailyLimit: row.globalDailyLimit ?? undefined,
    userDailyLimit: row.userDailyLimit ?? undefined,
  })
  drawerVisible.value = true
}

function payload(): SaveEnterpriseAiModelInput {
  return {
    displayName: form.displayName.trim(),
    modelName: form.modelName.trim(),
    provider: form.provider,
    apiUrl: form.apiUrl.trim(),
    apiKey: form.apiKey.trim() || undefined,
    enable: form.enable,
    temperature: form.temperature,
    maxTokens: form.maxTokens,
    topP: form.topP,
    globalDailyLimit: form.globalDailyLimit ?? null,
    userDailyLimit: form.userDailyLimit ?? null,
  }
}

async function save() {
  saving.value = true
  try {
    await formRef.value?.validate()
    if (editingId.value) await enterpriseAiModelApi.update(editingId.value, payload())
    else await enterpriseAiModelApi.create(payload())
    ElMessage.success(editingId.value ? '模型已更新' : '模型已新增')
    drawerVisible.value = false
    await loadModels()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

async function toggleStatus(rowValue: unknown, enable: boolean) {
  const row = rowValue as EnterpriseAiModelVO
  try {
    await enterpriseAiModelApi.setStatus(row.id, enable)
    row.enable = enable
    ElMessage.success(enable ? '模型已启用' : '模型已停用')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    await loadModels()
  }
}

async function remove(rowValue: unknown) {
  const row = rowValue as EnterpriseAiModelVO
  const confirmed = await ElMessageBox.confirm(`确定删除模型“${row.displayName}”吗？`, '删除模型', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await enterpriseAiModelApi.remove(row.id)
    ElMessage.success('模型已删除')
    await loadModels()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function openRouteStrategy() {
  routeVisible.value = true
  routeLoading.value = true
  try {
    await loadModels()
    const { data } = await enterpriseAiModelApi.routeStrategy()
    routeIds.value = data.modelIds.filter((id) =>
      enabledModels.value.some((item) => item.id === id),
    )
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    routeLoading.value = false
  }
}

function moveRoute(index: number, direction: -1 | 1) {
  const target = index + direction
  if (target < 0 || target >= routeIds.value.length) return
  const next = [...routeIds.value]
  ;[next[index], next[target]] = [next[target]!, next[index]!]
  routeIds.value = next
}

async function saveRoute() {
  routeSaving.value = true
  try {
    await enterpriseAiModelApi.updateRouteStrategy(routeIds.value)
    ElMessage.success('模型路由策略已保存')
    routeVisible.value = false
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    routeSaving.value = false
  }
}

onMounted(loadModels)
</script>

<template>
  <el-card shadow="never" class="rounded-1.5">
    <div class="mb-4 flex items-center justify-between gap-4">
      <div class="flex gap-2">
        <el-button v-if="canUpdate" type="primary" @click="openCreate">新增模型</el-button>
        <el-button
          v-if="canUpdate"
          :disabled="enabledModels.length === 0"
          @click="openRouteStrategy"
          >路由策略</el-button
        >
      </div>
      <el-input
        v-model="keyword"
        clearable
        placeholder="按模型名称、ID 或供应商搜索"
        class="w-90"
        @keyup.enter="loadModels"
      >
        <template #append><el-button @click="loadModels">搜索</el-button></template>
      </el-input>
    </div>

    <el-table v-loading="loading" :data="models" border>
      <el-table-column type="index" label="#" width="56" />
      <el-table-column prop="displayName" label="模型名称" min-width="140" show-overflow-tooltip />
      <el-table-column prop="modelName" label="模型 ID" min-width="150" show-overflow-tooltip />
      <el-table-column prop="provider" label="供应商" width="110" />
      <el-table-column prop="apiUrl" label="API Base URL" min-width="210" show-overflow-tooltip />
      <el-table-column label="API Key" width="90">
        <template #default="{ row }"
          ><el-tag :type="row.apiKeyConfigured ? 'success' : 'info'">{{
            row.apiKeyConfigured ? '已配置' : '未配置'
          }}</el-tag></template
        >
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-switch
            :model-value="row.enable"
            :disabled="!canUpdate"
            @change="toggleStatus(row, Boolean($event))"
          />
        </template>
      </el-table-column>
      <el-table-column label="全局日限额" width="110">
        <template #default="{ row }">{{ row.globalDailyLimit ?? '不限' }}</template>
      </el-table-column>
      <el-table-column prop="dailyTotal" label="今日用量" width="90" />
      <el-table-column label="更新时间" width="170">
        <template #default="{ row }">{{ new Date(row.updatedAt).toLocaleString() }}</template>
      </el-table-column>
      <el-table-column v-if="canUpdate" label="操作" width="125" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-drawer
      v-model="drawerVisible"
      :title="editingId ? '编辑模型' : '新增模型'"
      size="620px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
        <div class="grid grid-cols-2 gap-x-4.5">
          <el-form-item label="显示名称" prop="displayName"
            ><el-input v-model="form.displayName" maxlength="128"
          /></el-form-item>
          <el-form-item label="模型 ID" prop="modelName"
            ><el-input v-model="form.modelName" maxlength="255"
          /></el-form-item>
          <el-form-item label="供应商" prop="provider">
            <el-select v-model="form.provider" class="w-full"
              ><el-option v-for="item in providers" :key="item" :label="item" :value="item"
            /></el-select>
          </el-form-item>
          <el-form-item label="状态"
            ><el-switch v-model="form.enable" active-text="启用" inactive-text="停用"
          /></el-form-item>
        </div>
        <el-form-item label="API Base URL" prop="apiUrl"
          ><el-input v-model="form.apiUrl"
        /></el-form-item>
        <el-form-item label="API Key">
          <el-input
            v-model="form.apiKey"
            type="password"
            show-password
            autocomplete="new-password"
          />
          <div v-if="editingId" class="text-xs text-[var(--el-text-color-secondary)]">
            留空表示保留当前 API Key。
          </div>
        </el-form-item>
        <div class="grid grid-cols-3 gap-x-4.5">
          <el-form-item label="Temperature"
            ><el-input-number v-model="form.temperature" :min="0" :max="1" :step="0.1"
          /></el-form-item>
          <el-form-item label="Max Tokens"
            ><el-input-number v-model="form.maxTokens" :min="1" :max="1000000"
          /></el-form-item>
          <el-form-item label="Top P"
            ><el-input-number v-model="form.topP" :min="0" :max="1" :step="0.1"
          /></el-form-item>
          <el-form-item label="全局每日上限"
            ><el-input-number v-model="form.globalDailyLimit" :min="1" placeholder="不限"
          /></el-form-item>
          <el-form-item label="用户每日上限"
            ><el-input-number v-model="form.userDailyLimit" :min="1" placeholder="不限"
          /></el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="drawerVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-drawer>

    <el-dialog v-model="routeVisible" title="模型路由策略" width="620px" destroy-on-close>
      <div v-loading="routeLoading">
        <div class="mb-2.5 text-xs text-[var(--el-text-color-secondary)]">
          按顺序尝试可用模型。仅启用状态的模型可以加入路由。
        </div>
        <el-select
          v-model="routeIds"
          multiple
          filterable
          class="w-full"
          placeholder="选择参与路由的模型"
        >
          <el-option
            v-for="item in enabledModels"
            :key="item.id"
            :label="item.displayName"
            :value="item.id"
          />
        </el-select>
        <div class="mt-3.5 flex flex-col gap-2">
          <div
            v-for="(row, index) in selectedRouteRows"
            :key="row.id"
            class="min-h-12 flex items-center gap-2 rounded border border-[var(--el-border-color-lighter)] px-2.5 py-1.5"
          >
            <span class="w-6 font-mono text-[var(--el-text-color-secondary)]">{{ index + 1 }}</span>
            <div class="min-w-0 flex flex-1 flex-col">
              <strong>{{ row.displayName }}</strong
              ><span class="text-xs text-[var(--el-text-color-secondary)]">{{
                row.modelName
              }}</span>
            </div>
            <el-button text :disabled="index === 0" @click="moveRoute(index, -1)">上移</el-button>
            <el-button
              text
              :disabled="index === selectedRouteRows.length - 1"
              @click="moveRoute(index, 1)"
              >下移</el-button
            >
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="routeVisible = false">取消</el-button>
        <el-button type="primary" :loading="routeSaving" @click="saveRoute">保存策略</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>
