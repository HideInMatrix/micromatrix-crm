<script setup lang="ts">
import type {
  EnterpriseAiModelOptionVO,
  EnterpriseGlobalTaskConfirmationLevel,
  EnterpriseGlobalTaskExecutionVO,
  EnterpriseGlobalTaskTriggerType,
  EnterpriseGlobalTaskVO,
  SaveEnterpriseGlobalTaskInput,
} from '@micromatrix/shared'
import type { FormInstance, FormRules } from 'element-plus'
import { computed, onMounted, reactive, ref } from 'vue'
import { enterpriseAiModelApi, enterpriseGlobalTaskApi } from '@/api/enterprise-settings'
import { extractErrorMessage } from '@/api/http'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const canUpdate = computed(() => auth.hasPerm('system:setting:update'))
const activeTab = ref('tasks')
const loading = ref(false)
const executionLoading = ref(false)
const keyword = ref('')
const tasks = ref<EnterpriseGlobalTaskVO[]>([])
const executions = ref<EnterpriseGlobalTaskExecutionVO[]>([])
const modelOptions = ref<EnterpriseAiModelOptionVO[]>([])
const drawerVisible = ref(false)
const resultDrawerVisible = ref(false)
const saving = ref(false)
const executingId = ref<string | null>(null)
const editingId = ref<string | null>(null)
const selectedExecution = ref<EnterpriseGlobalTaskExecutionVO | null>(null)
const formRef = ref<FormInstance>()

const form = reactive<SaveEnterpriseGlobalTaskInput>({
  name: '',
  triggerType: 'manual',
  executionCondition: '',
  executionAction: '',
  confirmationLevel: 'ask',
  applicableModelId: null,
  enable: true,
})

const triggerOptions: Array<{ label: string; value: EnterpriseGlobalTaskTriggerType }> = [
  { label: '事件 / 手动语义', value: 'manual' },
  { label: '定时', value: 'cron' },
]
const confirmationOptions: Array<{ label: string; value: EnterpriseGlobalTaskConfirmationLevel }> =
  [
    { label: '执行前询问', value: 'ask' },
    { label: '自动执行', value: 'auto' },
    { label: '仅分析', value: 'only_analysis' },
  ]

const rules: FormRules = {
  name: [{ required: true, message: '请输入任务名称', trigger: 'blur' }],
  triggerType: [{ required: true, message: '请选择触发类型', trigger: 'change' }],
  confirmationLevel: [{ required: true, message: '请选择确认级别', trigger: 'change' }],
}

function triggerLabel(value: EnterpriseGlobalTaskTriggerType) {
  return triggerOptions.find((item) => item.value === value)?.label ?? value
}

function confirmationLabel(value: EnterpriseGlobalTaskConfirmationLevel) {
  return confirmationOptions.find((item) => item.value === value)?.label ?? value
}

function executionStatusLabel(status: EnterpriseGlobalTaskExecutionVO['status']) {
  const map: Record<EnterpriseGlobalTaskExecutionVO['status'], string> = {
    PENDING: '等待中',
    RUNNING: '执行中',
    SUCCEEDED: '已完成',
    FAILED: '失败',
    STOPPED: '已停止',
  }
  return map[status]
}

function executionStatusType(status: EnterpriseGlobalTaskExecutionVO['status']) {
  if (status === 'SUCCEEDED') return 'success'
  if (status === 'FAILED') return 'danger'
  if (status === 'PENDING' || status === 'RUNNING') return 'warning'
  return 'info'
}

function formatResult(rowValue: unknown) {
  const row = rowValue as EnterpriseGlobalTaskExecutionVO
  if (row.errorMessage) return row.errorMessage
  if (row.output === null || row.output === undefined) return '-'
  if (typeof row.output === 'object' && row.output !== null && 'analysis' in row.output) {
    const analysis = (row.output as { analysis?: unknown }).analysis
    if (typeof analysis === 'string') return analysis
  }
  return typeof row.output === 'string' ? row.output : JSON.stringify(row.output, null, 2)
}

function recordValue(value: unknown, key: string) {
  if (typeof value !== 'object' || value === null || !(key in value)) return null
  return (value as Record<string, unknown>)[key]
}

function formatDetailValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '-'
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : JSON.stringify(value, null, 2)
}

function formatLatency(value: unknown) {
  return typeof value === 'number' ? `${value} ms` : '-'
}

function formatInputDate(value: unknown) {
  return typeof value === 'string' ? formatDate(value) : '-'
}

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : '-'
}

function hasExecutionResult(rowValue: unknown) {
  const row = rowValue as EnterpriseGlobalTaskExecutionVO
  return Boolean(row.errorMessage || (row.output !== null && row.output !== undefined))
}

function openExecutionResult(rowValue: unknown) {
  selectedExecution.value = rowValue as EnterpriseGlobalTaskExecutionVO
  resultDrawerVisible.value = true
}

function clearExecutionResult() {
  selectedExecution.value = null
}

async function loadTasks() {
  loading.value = true
  try {
    const { data } = await enterpriseGlobalTaskApi.list(keyword.value.trim() || undefined)
    tasks.value = data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function loadExecutions() {
  executionLoading.value = true
  try {
    const { data } = await enterpriseGlobalTaskApi.executions()
    executions.value = data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    executionLoading.value = false
  }
}

async function loadModelOptions() {
  try {
    const { data } = await enterpriseAiModelApi.options()
    modelOptions.value = data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function resetForm() {
  Object.assign(form, {
    name: '',
    triggerType: 'manual',
    executionCondition: '',
    executionAction: '',
    confirmationLevel: 'ask',
    applicableModelId: null,
    enable: true,
  } satisfies SaveEnterpriseGlobalTaskInput)
}

async function openCreate() {
  editingId.value = null
  resetForm()
  await loadModelOptions()
  drawerVisible.value = true
}

async function openEdit(rowValue: unknown) {
  const row = rowValue as EnterpriseGlobalTaskVO
  editingId.value = row.id
  Object.assign(form, {
    name: row.name,
    triggerType: row.triggerType,
    executionCondition: row.executionCondition,
    executionAction: row.executionAction,
    confirmationLevel: row.confirmationLevel,
    applicableModelId: row.applicableModelId,
    enable: row.enable,
  })
  await loadModelOptions()
  drawerVisible.value = true
}

async function saveTask() {
  saving.value = true
  try {
    await formRef.value?.validate()
    const payload: SaveEnterpriseGlobalTaskInput = { ...form }
    if (editingId.value) await enterpriseGlobalTaskApi.update(editingId.value, payload)
    else await enterpriseGlobalTaskApi.create(payload)
    ElMessage.success(editingId.value ? '全局任务已更新' : '全局任务已新增')
    drawerVisible.value = false
    await loadTasks()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

async function toggleTask(rowValue: unknown, enable: boolean) {
  const row = rowValue as EnterpriseGlobalTaskVO
  try {
    await enterpriseGlobalTaskApi.setStatus(row.id, enable)
    row.enable = enable
    ElMessage.success(enable ? '任务已启用' : '任务已停用')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    await loadTasks()
  }
}

async function removeTask(rowValue: unknown) {
  const row = rowValue as EnterpriseGlobalTaskVO
  const confirmed = await ElMessageBox.confirm(
    `确定删除全局任务“${row.name}”吗？`,
    '删除全局任务',
    {
      type: 'warning',
    },
  ).catch(() => false)
  if (!confirmed) return
  try {
    await enterpriseGlobalTaskApi.remove(row.id)
    ElMessage.success('全局任务已删除')
    await Promise.all([loadTasks(), loadExecutions()])
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function executeTask(rowValue: unknown) {
  const row = rowValue as EnterpriseGlobalTaskVO
  executingId.value = row.id
  try {
    const { data } = await enterpriseGlobalTaskApi.execute(row.id)
    if (data.status === 'SUCCEEDED') ElMessage.success('全局任务分析完成')
    else ElMessage.error(data.errorMessage || '全局任务执行失败')
    activeTab.value = 'executions'
    await loadExecutions()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    await loadExecutions()
  } finally {
    executingId.value = null
  }
}

async function stopExecution(rowValue: unknown) {
  const row = rowValue as EnterpriseGlobalTaskExecutionVO
  const confirmed = await ElMessageBox.confirm(
    `确定停止“${row.taskName}”的这次执行吗？`,
    '停止执行',
    {
      type: 'warning',
    },
  ).catch(() => false)
  if (!confirmed) return
  try {
    await enterpriseGlobalTaskApi.stopExecution(row.id)
    ElMessage.success('执行记录已停止')
    await loadExecutions()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function removeExecution(rowValue: unknown) {
  const row = rowValue as EnterpriseGlobalTaskExecutionVO
  const confirmed = await ElMessageBox.confirm(
    `确定删除“${row.taskName}”的这条执行记录吗？`,
    '删除执行记录',
    {
      type: 'warning',
    },
  ).catch(() => false)
  if (!confirmed) return
  try {
    await enterpriseGlobalTaskApi.removeExecution(row.id)
    ElMessage.success('执行记录已删除')
    await loadExecutions()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

onMounted(async () => {
  await Promise.all([loadTasks(), loadExecutions()])
})
</script>

<template>
  <el-card shadow="never" class="rounded-1.5">
    <el-tabs v-model="activeTab" class="[&_.el-tabs__header]:!mb-4.5">
      <el-tab-pane label="任务列表" name="tasks">
        <div class="mb-4 flex items-center justify-between gap-4">
          <el-button v-if="canUpdate" type="primary" @click="openCreate">新增任务</el-button>
          <el-input
            v-model="keyword"
            clearable
            class="w-90"
            placeholder="按任务名称搜索"
            @keyup.enter="loadTasks"
          >
            <template #append><el-button @click="loadTasks">搜索</el-button></template>
          </el-input>
        </div>
        <el-table v-loading="loading" :data="tasks" border>
          <el-table-column type="index" label="#" width="54" />
          <el-table-column prop="name" label="任务名称" min-width="150" show-overflow-tooltip />
          <el-table-column label="状态" width="90">
            <template #default="{ row }"
              ><el-switch
                :model-value="row.enable"
                :disabled="!canUpdate"
                @change="toggleTask(row, Boolean($event))"
            /></template>
          </el-table-column>
          <el-table-column label="触发类型" width="135"
            ><template #default="{ row }">{{
              triggerLabel(row.triggerType)
            }}</template></el-table-column
          >
          <el-table-column label="确认级别" width="120"
            ><template #default="{ row }">{{
              confirmationLabel(row.confirmationLevel)
            }}</template></el-table-column
          >
          <el-table-column
            prop="executionCondition"
            label="触发条件"
            min-width="180"
            show-overflow-tooltip
          />
          <el-table-column
            prop="executionAction"
            label="执行动作"
            min-width="220"
            show-overflow-tooltip
          />
          <el-table-column label="适用模型" min-width="130"
            ><template #default="{ row }">{{
              row.applicableModelName || '-'
            }}</template></el-table-column
          >
          <el-table-column v-if="canUpdate" label="操作" width="190" fixed="right">
            <template #default="{ row }">
              <el-tooltip
                :disabled="row.confirmationLevel === 'only_analysis'"
                content="当前运行时仅支持“仅分析”任务"
              >
                <span>
                  <el-button
                    link
                    type="success"
                    :loading="executingId === row.id"
                    :disabled="
                      !row.enable ||
                      !row.applicableModelId ||
                      row.confirmationLevel !== 'only_analysis'
                    "
                    @click="executeTask(row)"
                    >立即执行</el-button
                  >
                </span>
              </el-tooltip>
              <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
              <el-button link type="danger" @click="removeTask(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="执行记录" name="executions">
        <div class="mb-4 flex items-center justify-between gap-4">
          <strong>执行记录列表</strong><el-button @click="loadExecutions">刷新</el-button>
        </div>
        <el-table v-loading="executionLoading" :data="executions" border>
          <el-table-column label="执行时间" width="175"
            ><template #default="{ row }">{{
              formatDate(row.startedAt || row.createdAt)
            }}</template></el-table-column
          >
          <el-table-column prop="taskName" label="任务名称" min-width="160" show-overflow-tooltip />
          <el-table-column label="状态" width="100"
            ><template #default="{ row }"
              ><el-tag :type="executionStatusType(row.status)">{{
                executionStatusLabel(row.status)
              }}</el-tag></template
            ></el-table-column
          >
          <el-table-column label="结果" width="110" align="center">
            <template #default="{ row }">
              <el-button
                v-if="hasExecutionResult(row)"
                link
                type="primary"
                data-testid="global-task-result-link"
                @click="openExecutionResult(row)"
              >
                {{ row.errorMessage ? '查看错误' : '查看结果' }}
              </el-button>
              <span v-else>-</span>
            </template>
          </el-table-column>
          <el-table-column label="结束时间" width="175"
            ><template #default="{ row }">{{
              formatDate(row.finishedAt)
            }}</template></el-table-column
          >
          <el-table-column v-if="canUpdate" label="操作" width="100" fixed="right">
            <template #default="{ row }">
              <el-button
                v-if="row.status === 'PENDING' || row.status === 'RUNNING'"
                link
                type="warning"
                @click="stopExecution(row)"
                >停止</el-button
              >
              <el-button v-else link type="danger" @click="removeExecution(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <el-drawer
      v-model="drawerVisible"
      :title="editingId ? '编辑全局任务' : '新增全局任务'"
      size="620px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
        <el-form-item label="任务名称" prop="name"
          ><el-input v-model="form.name" maxlength="128"
        /></el-form-item>
        <div class="grid grid-cols-2 gap-4.5">
          <el-form-item label="触发类型" prop="triggerType"
            ><el-select v-model="form.triggerType" class="w-full"
              ><el-option
                v-for="item in triggerOptions"
                :key="item.value"
                :label="item.label"
                :value="item.value" /></el-select
          ></el-form-item>
          <el-form-item label="确认级别" prop="confirmationLevel"
            ><el-select v-model="form.confirmationLevel" class="w-full"
              ><el-option
                v-for="item in confirmationOptions"
                :key="item.value"
                :label="item.label"
                :value="item.value" /></el-select
          ></el-form-item>
        </div>
        <el-form-item label="触发条件">
          <el-input
            v-model="form.executionCondition"
            type="textarea"
            :rows="4"
            maxlength="2000"
            :placeholder="
              form.triggerType === 'cron'
                ? '例如：0 9 * * 1-5；可在后续调度器接入时解析'
                : '描述事件或手动触发条件'
            "
          />
        </el-form-item>
        <el-form-item label="执行动作"
          ><el-input
            v-model="form.executionAction"
            type="textarea"
            :rows="6"
            maxlength="8000"
            placeholder="描述任务需要分析或执行的动作"
        /></el-form-item>
        <el-form-item label="适用 AI 模型"
          ><el-select v-model="form.applicableModelId" clearable class="w-full" placeholder="不指定"
            ><el-option
              v-for="item in modelOptions"
              :key="item.id"
              :label="item.name"
              :value="item.id" /></el-select
        ></el-form-item>
        <el-form-item label="状态"
          ><el-switch v-model="form.enable" active-text="启用" inactive-text="停用"
        /></el-form-item>
      </el-form>
      <template #footer
        ><el-button @click="drawerVisible = false">取消</el-button
        ><el-button type="primary" :loading="saving" @click="saveTask">保存</el-button></template
      >
    </el-drawer>

    <el-drawer
      v-model="resultDrawerVisible"
      :title="selectedExecution ? `执行结果 · ${selectedExecution.taskName}` : '执行结果'"
      size="720px"
      destroy-on-close
      data-testid="global-task-result-drawer"
      @closed="clearExecutionResult"
    >
      <template v-if="selectedExecution">
        <el-descriptions :column="1" border class="mb-5">
          <el-descriptions-item label="任务名称">{{
            selectedExecution.taskName
          }}</el-descriptions-item>
          <el-descriptions-item label="执行状态">
            <el-tag :type="executionStatusType(selectedExecution.status)">
              {{ executionStatusLabel(selectedExecution.status) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="开始时间">
            {{ formatDate(selectedExecution.startedAt || selectedExecution.createdAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="结束时间">
            {{ formatDate(selectedExecution.finishedAt) }}
          </el-descriptions-item>
        </el-descriptions>

        <section>
          <div class="mb-2 text-sm font-600">执行结果</div>
          <div
            class="rounded-1.5 border border-[var(--el-border-color)] bg-[var(--el-fill-color-lighter)] p-4"
          >
            <pre class="m-0 whitespace-pre-wrap break-words font-sans text-sm leading-6">{{
              formatResult(selectedExecution)
            }}</pre>
          </div>
        </section>

        <el-collapse class="mt-5">
          <el-collapse-item title="原始输出" name="output">
            <el-descriptions :column="1" border>
              <el-descriptions-item label="显示名称">
                {{ formatDetailValue(recordValue(selectedExecution.output, 'displayName')) }}
              </el-descriptions-item>
              <el-descriptions-item label="Provider">
                {{ formatDetailValue(recordValue(selectedExecution.output, 'provider')) }}
              </el-descriptions-item>
              <el-descriptions-item label="模型">
                {{ formatDetailValue(recordValue(selectedExecution.output, 'modelName')) }}
              </el-descriptions-item>
              <el-descriptions-item label="模型 ID">
                {{ formatDetailValue(recordValue(selectedExecution.output, 'modelId')) }}
              </el-descriptions-item>
              <el-descriptions-item label="调用耗时">
                {{ formatLatency(recordValue(selectedExecution.output, 'latencyMs')) }}
              </el-descriptions-item>
            </el-descriptions>
          </el-collapse-item>
          <el-collapse-item title="执行输入" name="input">
            <el-descriptions :column="1" border>
              <el-descriptions-item label="触发方式">
                {{ formatDetailValue(recordValue(selectedExecution.input, 'trigger')) }}
              </el-descriptions-item>
              <el-descriptions-item label="任务名称">
                {{ formatDetailValue(recordValue(selectedExecution.input, 'taskName')) }}
              </el-descriptions-item>
              <el-descriptions-item label="执行条件">
                <div class="whitespace-pre-wrap break-words">
                  {{
                    formatDetailValue(recordValue(selectedExecution.input, 'executionCondition'))
                  }}
                </div>
              </el-descriptions-item>
              <el-descriptions-item label="执行动作">
                <div class="whitespace-pre-wrap break-words">
                  {{ formatDetailValue(recordValue(selectedExecution.input, 'executionAction')) }}
                </div>
              </el-descriptions-item>
              <el-descriptions-item label="触发人 ID">
                {{ formatDetailValue(recordValue(selectedExecution.input, 'requestedById')) }}
              </el-descriptions-item>
              <el-descriptions-item label="触发时间">
                {{ formatInputDate(recordValue(selectedExecution.input, 'requestedAt')) }}
              </el-descriptions-item>
            </el-descriptions>
          </el-collapse-item>
        </el-collapse>
      </template>
    </el-drawer>
  </el-card>
</template>
