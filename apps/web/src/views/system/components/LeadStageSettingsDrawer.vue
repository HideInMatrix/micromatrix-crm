<script setup lang="ts">
import { DEFAULT_LEAD_STAGES, type LeadStageConfig } from '@micromatrix/shared'
import { ref, watch } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'

const visible = defineModel<boolean>({ required: true })
const loading = ref(false)
const saving = ref(false)
const stages = ref<LeadStageConfig[]>([])

const kindOptions: Array<{ value: LeadStageConfig['kind']; label: string }> = [
  { value: 'ACTIVE', label: '进行中' },
  { value: 'SUCCESS', label: '成功结果' },
  { value: 'FAILURE', label: '失败结果' },
]

function createStageKey() {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()
  return `STAGE_${suffix}`
}

function normalizeStages(value: unknown): LeadStageConfig[] {
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.some((item) => {
      return item === null || typeof item !== 'object' || Array.isArray(item)
    })
  ) {
    throw new Error('线索状态配置数据异常，已停止自动修复以防覆盖原配置。请先恢复有效状态数据。')
  }

  const configured: Partial<LeadStageConfig>[] =
    Array.isArray(value) && value.length > 0
      ? (value as Partial<LeadStageConfig>[])
      : DEFAULT_LEAD_STAGES.map((stage) => ({ ...stage }))
  const hasRecoverableData = configured.some(
    (stage) =>
      (typeof stage.key === 'string' && Boolean(stage.key.trim())) ||
      (typeof stage.name === 'string' && Boolean(stage.name.trim())) ||
      ['ACTIVE', 'SUCCESS', 'FAILURE'].includes(String(stage.kind)),
  )
  if (!hasRecoverableData) {
    throw new Error('线索状态配置不包含可恢复的数据，已停止保存以防覆盖原配置。')
  }

  const keys = new Set<string>()
  let repairedKey = false
  let repairedFields = false

  const normalized = configured.map((item, index): LeadStageConfig => {
    const stage = item && typeof item === 'object' ? (item as Partial<LeadStageConfig>) : {}
    let key =
      typeof stage.key === 'string' && /^[A-Za-z0-9_-]{1,30}$/.test(stage.key) ? stage.key : ''
    if (!key || keys.has(key)) {
      key = createStageKey()
      repairedKey = true
    }
    keys.add(key)

    const fallback = DEFAULT_LEAD_STAGES.find((candidate) => candidate.key === key)
    const hasName = typeof stage.name === 'string' && Boolean(stage.name.trim())
    const name = hasName ? stage.name!.trim() : (fallback?.name ?? `待修复状态${index + 1}`)
    if (!hasName) repairedFields = true

    const hasKind = ['ACTIVE', 'SUCCESS', 'FAILURE'].includes(String(stage.kind))
    const kind: LeadStageConfig['kind'] = hasKind ? stage.kind! : (fallback?.kind ?? 'ACTIVE')
    if (!hasKind) repairedFields = true

    if (stage.enabled !== undefined && typeof stage.enabled !== 'boolean') repairedFields = true
    return { key, name, kind, enabled: stage.enabled !== false }
  })

  if (repairedKey) {
    ElMessage.warning(
      '检测到线索状态标识缺失或重复，已生成临时标识。请核对配置；若有线索仍使用旧状态，保存时会被后端拦截以保护历史数据。',
    )
  } else if (repairedFields) {
    ElMessage.warning('检测到线索状态名称或类型缺失，已补齐可编辑的临时值，请核对后保存。')
  }
  return normalized
}

async function load() {
  loading.value = true
  stages.value = []
  try {
    const { data } = await metadataApi.formConfig('lead')
    stages.value = normalizeStages(data.formProp.leadStages)
  } catch (error) {
    stages.value = []
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function addStage() {
  stages.value.push({ key: createStageKey(), name: '新状态', kind: 'ACTIVE', enabled: true })
}

function move(index: number, offset: -1 | 1) {
  const target = index + offset
  if (target < 0 || target >= stages.value.length) return
  const current = stages.value[index]
  const other = stages.value[target]
  if (!current || !other) return
  stages.value[index] = other
  stages.value[target] = current
}

function remove(index: number) {
  if (stages.value.length <= 1) {
    ElMessage.warning('至少需要保留一个线索状态')
    return
  }
  stages.value.splice(index, 1)
}

async function save() {
  const value = stages.value.map((stage) => ({ ...stage, name: stage.name.trim() }))
  if (value.some((stage) => !stage.name)) {
    ElMessage.warning('状态名称不能为空')
    return
  }
  if (!value.some((stage) => stage.enabled !== false)) {
    ElMessage.warning('至少需要保留一个启用的线索状态')
    return
  }
  saving.value = true
  try {
    const { data } = await metadataApi.updateFormProp('lead', { leadStages: value })
    const persisted = data.formProp.leadStages
    const matchesRequest =
      Array.isArray(persisted) &&
      persisted.length === value.length &&
      persisted.every((stage, index) => {
        const submitted = value[index]
        return (
          !!submitted &&
          stage.key === submitted.key &&
          stage.name === submitted.name &&
          stage.kind === submitted.kind &&
          (stage.enabled !== false) === (submitted.enabled !== false)
        )
      })
    if (!matchesRequest) {
      ElMessage.error(
        '线索状态保存后返回的数据与提交内容不一致，设置未关闭。请检查后端服务版本及接口数据。',
      )
      return
    }
    ElMessage.success('线索状态设置已保存')
    visible.value = false
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

watch(
  visible,
  (open) => {
    if (open) void load()
  },
  { immediate: true },
)
</script>

<template>
  <el-drawer v-model="visible" title="线索状态设置" size="860px" destroy-on-close>
    <div v-loading="loading">
      <div class="mb-4 flex items-center justify-between">
        <div class="text-sm leading-6 text-[var(--el-text-color-secondary)]">
          <div>状态名称和顺序由租户配置；第一个启用状态作为新建线索默认状态。</div>
          <div>
            如果已有线索使用某个状态，不能直接删除；可以先停用，或将相关线索迁移到其他状态后再删除。
          </div>
        </div>
        <el-button type="primary" @click="addStage">新增状态</el-button>
      </div>

      <el-table
        :data="stages"
        border
        :empty-text="loading ? '正在加载…' : '状态配置异常，已阻止保存'"
      >
        <el-table-column label="顺序" width="120">
          <template #default="{ $index }">
            <el-button link :disabled="$index === 0" @click="move($index, -1)">上移</el-button>
            <el-button link :disabled="$index === stages.length - 1" @click="move($index, 1)"
              >下移</el-button
            >
          </template>
        </el-table-column>
        <el-table-column label="状态名称" min-width="220">
          <template #default="{ row }"><el-input v-model="row.name" maxlength="30" /></template>
        </el-table-column>
        <el-table-column label="状态类型" width="160">
          <template #default="{ row }">
            <el-select v-model="row.kind" class="w-full">
              <el-option
                v-for="item in kindOptions"
                :key="item.value"
                :label="item.label"
                :value="item.value"
              />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }"><el-switch v-model="row.enabled" /></template>
        </el-table-column>
        <el-table-column label="操作" width="90">
          <template #default="{ $index }"
            ><el-button link type="danger" @click="remove($index)">删除</el-button></template
          >
        </el-table-column>
      </el-table>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button
        type="primary"
        :loading="saving"
        :disabled="loading || stages.length === 0"
        @click="save"
        >保存</el-button
      >
    </template>
  </el-drawer>
</template>
