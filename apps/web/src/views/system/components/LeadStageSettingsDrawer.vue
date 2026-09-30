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

async function load() {
  loading.value = true
  try {
    const { data } = await metadataApi.formConfig('lead')
    stages.value = (data.formProp.leadStages?.length ? data.formProp.leadStages : DEFAULT_LEAD_STAGES)
      .map((stage) => ({ ...stage, enabled: stage.enabled !== false }))
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function addStage() {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()
  stages.value.push({ key: `STAGE_${suffix}`, name: '新状态', kind: 'ACTIVE', enabled: true })
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
    await metadataApi.updateFormProp('lead', { leadStages: value })
    ElMessage.success('线索状态设置已保存')
    visible.value = false
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

watch(visible, (open) => {
  if (open) void load()
})
</script>

<template>
  <el-drawer v-model="visible" title="线索状态设置" size="860px" destroy-on-close>
    <div v-loading="loading">
      <div class="mb-4 flex items-center justify-between">
        <div class="text-sm text-[var(--el-text-color-secondary)]">
          状态名称和顺序由租户配置；第一个启用状态作为新建线索默认状态。
        </div>
        <el-button type="primary" @click="addStage">新增状态</el-button>
      </div>

      <el-table :data="stages" border>
        <el-table-column label="顺序" width="120">
          <template #default="{ $index }">
            <el-button link :disabled="$index === 0" @click="move($index, -1)">上移</el-button>
            <el-button link :disabled="$index === stages.length - 1" @click="move($index, 1)">下移</el-button>
          </template>
        </el-table-column>
        <el-table-column label="状态名称" min-width="220">
          <template #default="{ row }"><el-input v-model="row.name" maxlength="30" /></template>
        </el-table-column>
        <el-table-column label="状态类型" width="160">
          <template #default="{ row }">
            <el-select v-model="row.kind" class="w-full">
              <el-option v-for="item in kindOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }"><el-switch v-model="row.enabled" /></template>
        </el-table-column>
        <el-table-column label="操作" width="90">
          <template #default="{ $index }"><el-button link type="danger" @click="remove($index)">删除</el-button></template>
        </el-table-column>
      </el-table>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-drawer>
</template>
