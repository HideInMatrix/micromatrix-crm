<script setup lang="ts">
import type { FieldVO, LeadVO } from '@micromatrix/shared'
import { computed, ref, watch } from 'vue'
import FollowUpPlanPanel from '@/components/follow-plans/FollowUpPlanPanel.vue'
import FollowRecordPanel from '@/components/follow-records/FollowRecordPanel.vue'
import { formatFieldValue } from '@/components/form-engine/field-display'
import OwnerHistoryTimeline from '@/components/OwnerHistoryTimeline.vue'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{
  mode: 'lead' | 'pool'
  lead: LeadVO | null
  fields: FieldVO[]
}>()
const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{
  edit: [lead: LeadVO]
  convert: [lead: LeadVO]
  toPool: [lead: LeadVO]
  transfer: [lead: LeadVO]
  delete: [lead: LeadVO]
  claim: [lead: LeadVO]
  assign: [lead: LeadVO]
}>()

const auth = useAuthStore()
const fieldRefs = useFieldRefs()
const activeTab = ref<'records' | 'plans' | 'history'>('records')

const isConverted = computed(() =>
  ['CUSTOMER', 'OPPORTUNITY'].includes(props.lead?.transitionType ?? ''),
)

function displayValue(field: FieldVO) {
  if (!props.lead) return '-'
  return formatFieldValue(field, props.lead as unknown as Record<string, unknown>, {
    memberMap: fieldRefs.memberMap.value,
    deptMap: fieldRefs.deptMap.value,
  })
}

function action(event: 'edit' | 'convert' | 'toPool' | 'transfer' | 'delete' | 'claim' | 'assign') {
  if (!props.lead) return
  if (event === 'edit') emit('edit', props.lead)
  else if (event === 'convert') emit('convert', props.lead)
  else if (event === 'toPool') emit('toPool', props.lead)
  else if (event === 'transfer') emit('transfer', props.lead)
  else if (event === 'delete') emit('delete', props.lead)
  else if (event === 'claim') emit('claim', props.lead)
  else emit('assign', props.lead)
}

watch(
  () => [visible.value, props.lead?.id] as const,
  async ([open]) => {
    if (!open || !props.lead) return
    activeTab.value = 'records'
    if (fieldRefs.members.value.length === 0) await fieldRefs.load()
  },
)
</script>

<template>
  <el-drawer
    v-model="visible"
    :title="lead?.name ?? (mode === 'pool' ? '线索池详情' : '线索详情')"
    size="72%"
    destroy-on-close
  >
    <template #header>
      <div class="flex min-w-0 flex-1 items-center justify-between gap-4 pr-6">
        <div class="truncate text-base font-medium">{{ lead?.name ?? '线索详情' }}</div>
        <div v-if="lead" class="flex shrink-0 items-center gap-2">
          <template v-if="mode === 'pool'">
            <el-button
              v-if="auth.hasPerm('leadPool:pick')"
              size="small"
              type="primary"
              @click="action('claim')"
            >
              领取
            </el-button>
            <el-button
              v-if="auth.hasPerm('leadPool:assign')"
              size="small"
              @click="action('assign')"
            >
              分配
            </el-button>
            <el-button
              v-if="auth.hasPerm('leadPool:delete')"
              size="small"
              type="danger"
              plain
              @click="action('delete')"
            >
              删除
            </el-button>
          </template>
          <template v-else-if="!isConverted">
            <el-button v-if="auth.hasPerm('lead:update')" size="small" @click="action('edit')"
              >编辑</el-button
            >
            <el-button
              v-if="auth.hasPerm('lead:update')"
              size="small"
              type="primary"
              @click="action('convert')"
            >
              转换
            </el-button>
            <el-button v-if="auth.hasPerm('lead:recycle')" size="small" @click="action('toPool')">
              移入线索池
            </el-button>
            <el-button
              v-if="auth.hasPerm('lead:transfer')"
              size="small"
              @click="action('transfer')"
            >
              转移
            </el-button>
            <el-button
              v-if="auth.hasPerm('lead:delete')"
              size="small"
              type="danger"
              plain
              @click="action('delete')"
            >
              删除
            </el-button>
          </template>
        </div>
      </div>
    </template>

    <div v-if="lead" class="grid h-full grid-cols-[minmax(280px,36%)_1fr] gap-5 overflow-hidden">
      <div class="overflow-auto border-r pr-5">
        <div class="mb-3 flex items-center justify-between gap-3">
          <div class="text-sm font-medium">基本信息</div>
          <el-button
            v-if="mode === 'pool' && auth.hasPerm('leadPool:update')"
            link
            type="primary"
            @click="action('edit')"
          >
            编辑字段
          </el-button>
        </div>
        <div class="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <div v-for="field in fields" :key="field.id" class="min-w-0">
            <div class="text-xs text-[var(--el-text-color-secondary)]">{{ field.label }}</div>
            <div class="mt-1 break-words text-sm">{{ displayValue(field) || '-' }}</div>
          </div>
        </div>
      </div>

      <div class="min-w-0 overflow-hidden">
        <el-tabs v-model="activeTab" class="h-full">
          <el-tab-pane label="跟进记录" name="records">
            <div class="max-h-[calc(100vh-210px)] overflow-auto pr-2">
              <FollowRecordPanel
                target-type="lead"
                :target-id="lead.id"
                :target-name="lead.name"
                :allow-create="mode === 'lead' && auth.hasPerm('lead:update') && !isConverted"
                :allow-manage="mode === 'lead' && auth.hasPerm('lead:update') && !isConverted"
              />
            </div>
          </el-tab-pane>

          <el-tab-pane v-if="mode === 'lead'" label="跟进计划" name="plans">
            <FollowUpPlanPanel
              target-type="lead"
              :target-id="lead.id"
              :target-name="lead.name"
              :can-write="auth.hasPerm('lead:update') && !isConverted"
            />
          </el-tab-pane>

          <el-tab-pane :label="mode === 'pool' ? '前负责人记录' : '负责人历史'" name="history">
            <OwnerHistoryTimeline module="lead" :resource-id="lead.id" />
          </el-tab-pane>
        </el-tabs>
      </div>
    </div>
  </el-drawer>
</template>
