<script setup lang="ts">
import type { OpportunityStageVO, PoolRuleVO } from '@micromatrix/shared'
import { onMounted, reactive, ref } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { opportunityApi, poolRuleApi } from '@/api/sales'

// ===== 商机阶段 =====

const stages = ref<OpportunityStageVO[]>([])
const stageLoading = ref(false)
const stageDialogVisible = ref(false)
const editingStage = ref<OpportunityStageVO | null>(null)
const stageForm = reactive({ name: '', probability: 10 })

async function loadStages() {
  stageLoading.value = true
  try {
    const { data } = await opportunityApi.stages()
    stages.value = data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    stageLoading.value = false
  }
}

function openStageCreate() {
  editingStage.value = null
  Object.assign(stageForm, { name: '', probability: 10 })
  stageDialogVisible.value = true
}

function openStageEdit(stage: OpportunityStageVO) {
  editingStage.value = stage
  Object.assign(stageForm, { name: stage.name, probability: stage.probability })
  stageDialogVisible.value = true
}

async function handleStageSave() {
  if (!stageForm.name.trim()) {
    ElMessage.warning('请输入阶段名称')
    return
  }
  try {
    if (editingStage.value) {
      await opportunityApi.updateStage(editingStage.value.id, { ...stageForm })
      ElMessage.success('阶段已更新')
    } else {
      await opportunityApi.createStage({ ...stageForm })
      ElMessage.success('阶段已创建')
    }
    stageDialogVisible.value = false
    loadStages()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleStageDelete(stage: OpportunityStageVO) {
  const confirmed = await ElMessageBox.confirm(`确定删除阶段「${stage.name}」吗？`, '删除确认', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await opportunityApi.removeStage(stage.id)
    ElMessage.success('已删除')
    loadStages()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

// ===== 回收规则 =====

const rules = ref<PoolRuleVO[]>([])
const ruleSaving = ref(false)
const running = ref(false)

async function loadRules() {
  const { data } = await poolRuleApi.list()
  rules.value = data
}

async function saveRule(rule: PoolRuleVO) {
  ruleSaving.value = true
  try {
    await poolRuleApi.update(rule)
    ElMessage.success('规则已保存')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    ruleSaving.value = false
  }
}

async function runNow() {
  running.value = true
  try {
    const { data } = await poolRuleApi.runNow()
    ElMessage.success(`执行完成：回收线索 ${data.recycledLeads} 条、客户 ${data.recycledCustomers} 个`)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    running.value = false
  }
}

onMounted(() => {
  loadStages()
  loadRules()
})
</script>

<template>
  <div class="space-y-4">
    <el-card shadow="never">
      <div class="flex-between mb-4">
        <div>
          <div class="font-medium">商机阶段</div>
          <div class="text-xs text-[var(--el-text-color-secondary)] mt-1">
            自定义销售流程阶段与赢率；赢单/输单为系统阶段不可删除
          </div>
        </div>
        <el-button type="primary" @click="openStageCreate">新建阶段</el-button>
      </div>

      <el-table v-loading="stageLoading" :data="stages">
        <el-table-column label="阶段名称" min-width="180">
          <template #default="{ row }">
            {{ row.name }}
            <el-tag v-if="row.isWon" type="success" size="small" class="ml-1">赢单</el-tag>
            <el-tag v-else-if="row.isLost" type="danger" size="small" class="ml-1">输单</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="赢率" width="120">
          <template #default="{ row }">{{ row.probability }}%</template>
        </el-table-column>
        <el-table-column label="操作" width="140">
          <template #default="{ row }">
            <el-button link type="primary" @click="openStageEdit(row as OpportunityStageVO)">
              编辑
            </el-button>
            <el-button
              link
              type="danger"
              :disabled="row.system"
              @click="handleStageDelete(row as OpportunityStageVO)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never">
      <div class="flex-between mb-4">
        <div>
          <div class="font-medium">公海 / 线索池回收规则</div>
          <div class="text-xs text-[var(--el-text-color-secondary)] mt-1">
            每天凌晨 2:30 自动执行；超过 N 天未跟进的线索/客户将被回收并通知负责人
          </div>
        </div>
        <el-button :loading="running" @click="runNow">立即执行一次</el-button>
      </div>

      <div v-for="rule in rules" :key="rule.module" class="flex items-center gap-4 py-3 border-b border-[var(--el-border-color-lighter)] last:border-b-0">
        <span class="w-20 text-sm font-medium">{{ rule.module === 'lead' ? '线索池' : '客户公海' }}</span>
        <el-switch v-model="rule.enabled" active-text="启用" />
        <div class="flex items-center gap-2 text-sm">
          <span>超过</span>
          <el-input-number v-model="rule.recycleDays" :min="1" :max="365" size="small" />
          <span>天未跟进回收，提前</span>
          <el-input-number v-model="rule.notifyDays" :min="0" :max="30" size="small" />
          <span>天提醒</span>
        </div>
        <el-button size="small" type="primary" :loading="ruleSaving" @click="saveRule(rule)">
          保存
        </el-button>
      </div>
    </el-card>

    <el-dialog
      v-model="stageDialogVisible"
      :title="editingStage ? '编辑阶段' : '新建阶段'"
      width="400px"
    >
      <el-form label-width="80px">
        <el-form-item label="阶段名称">
          <el-input v-model="stageForm.name" :disabled="Boolean(editingStage?.system)" />
        </el-form-item>
        <el-form-item label="赢率 %">
          <el-input-number v-model="stageForm.probability" :min="0" :max="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="stageDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleStageSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
