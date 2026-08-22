<script setup lang="ts">
import {
  FOLLOW_UP_PLAN_STATUS_LABELS,
  type FollowUpPlanStatus,
  type FollowUpPlanTargetType,
  type FollowUpPlanVO,
} from '@micromatrix/shared'
import { CalendarClock, CheckCheck, Pencil, Plus, Trash2 } from 'lucide-vue-next'
import { onMounted, ref, watch } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { followUpPlanApi } from '@/api/sales'
import FollowUpPlanDialog from './FollowUpPlanDialog.vue'

const props = defineProps<{
  targetType: FollowUpPlanTargetType
  targetId: string
  targetName: string
  canWrite?: boolean
}>()

const loading = ref(false)
const items = ref<FollowUpPlanVO[]>([])
const dialogVisible = ref(false)
const editing = ref<FollowUpPlanVO | null>(null)

const statusTypes: Record<FollowUpPlanStatus, 'info' | 'primary' | 'success' | 'warning'> = {
  PREPARED: 'info',
  UNDERWAY: 'primary',
  COMPLETED: 'success',
  CANCELLED: 'warning',
}

async function load() {
  loading.value = true
  try {
    const { data } = await followUpPlanApi.list({
      page: 1,
      pageSize: 100,
      targetType: props.targetType,
      targetId: props.targetId,
    })
    items.value = data.items
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = null
  dialogVisible.value = true
}

function openEdit(plan: FollowUpPlanVO) {
  editing.value = plan
  dialogVisible.value = true
}

async function changeStatus(plan: FollowUpPlanVO, status: FollowUpPlanStatus) {
  try {
    await followUpPlanApi.updateStatus(plan.id, status)
    ElMessage.success('计划状态已更新')
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function convert(plan: FollowUpPlanVO) {
  const confirmed = await ElMessageBox.confirm('转换后会生成一条跟进记录，确认继续？', '转跟进记录', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await followUpPlanApi.convert(plan.id)
    ElMessage.success('已转为跟进记录')
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function remove(plan: FollowUpPlanVO) {
  const confirmed = await ElMessageBox.confirm('确认删除该跟进计划？', '删除确认', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await followUpPlanApi.remove(plan.id)
    ElMessage.success('计划已删除')
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

watch(() => [props.targetType, props.targetId], load)
onMounted(load)
</script>

<template>
  <div>
    <div class="flex justify-end mb-3">
      <el-button v-if="canWrite" type="primary" size="small" @click="openCreate">
        <Plus :size="15" aria-hidden="true" />
        新建计划
      </el-button>
    </div>
    <div v-loading="loading">
      <el-empty v-if="items.length === 0" description="暂无跟进计划" />
      <el-timeline v-else>
        <el-timeline-item
          v-for="plan in items"
          :key="plan.id"
          :timestamp="`${plan.estimatedAt ? new Date(plan.estimatedAt).toLocaleString() : '未设置时间'} · ${plan.ownerName}`"
          placement="top"
        >
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <div class="flex items-center gap-2 mb-2">
                <CalendarClock :size="16" aria-hidden="true" />
                <el-tag :type="statusTypes[plan.status]" size="small">
                  {{ FOLLOW_UP_PLAN_STATUS_LABELS[plan.status] }}
                </el-tag>
                <el-tag v-if="plan.converted" type="success" size="small" effect="plain">已转记录</el-tag>
                <el-tag v-if="plan.method" size="small" effect="plain">{{ plan.method }}</el-tag>
              </div>
              <div class="break-words">{{ plan.content }}</div>
              <div v-if="plan.contactName" class="text-xs text-[var(--el-text-color-secondary)] mt-1">
                联系人：{{ plan.contactName }}
              </div>
            </div>
            <div v-if="plan.canManage" class="flex items-center gap-1 shrink-0">
              <el-dropdown
                :disabled="plan.status === 'COMPLETED' && plan.converted"
                @command="changeStatus(plan, $event as FollowUpPlanStatus)"
              >
                <el-button link type="primary">状态</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item v-for="(label, key) in FOLLOW_UP_PLAN_STATUS_LABELS" :key="key" :command="key">
                      {{ label }}
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
              <el-button v-if="plan.status === 'COMPLETED' && !plan.converted" link type="success" @click="convert(plan)">
                <CheckCheck :size="15" aria-hidden="true" />转记录
              </el-button>
              <el-button link type="primary" @click="openEdit(plan)">
                <Pencil :size="15" aria-hidden="true" />编辑
              </el-button>
              <el-button link type="danger" @click="remove(plan)">
                <Trash2 :size="15" aria-hidden="true" />删除
              </el-button>
            </div>
          </div>
        </el-timeline-item>
      </el-timeline>
    </div>

    <FollowUpPlanDialog
      v-model="dialogVisible"
      :plan="editing"
      :fixed-target-type="targetType"
      :fixed-target-id="targetId"
      :fixed-target-name="targetName"
      @saved="load"
    />
  </div>
</template>
