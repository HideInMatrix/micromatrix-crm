<script setup lang="ts">
import type { FieldVO, LeadStageConfig, LeadVO } from '@micromatrix/shared'
import { computed, ref, watch } from 'vue'
import { UserRound, X } from 'lucide-vue-next'
import { extractErrorMessage } from '@/api/http'
import { leadApi } from '@/api/sales'
import FollowRecordPanel from '@/components/follow-records/FollowRecordPanel.vue'
import FollowRecordFormDrawer from '@/components/follow-records/FollowRecordFormDrawer.vue'
import { formatFieldValue } from '@/components/form-engine/field-display'
import LeadChangeHistoryTimeline from './LeadChangeHistoryTimeline.vue'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'

type TabName = 'overview' | 'followRecord' | 'history'

const props = defineProps<{
  mode: 'lead' | 'pool'
  lead: LeadVO | null
  fields: FieldVO[]
  leadStages?: LeadStageConfig[]
  canConvert?: boolean
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
  changed: []
}>()

const auth = useAuthStore()
const fieldRefs = useFieldRefs()
const detail = ref<LeadVO | null>(null)
const lead = computed(() => (detail.value?.id === props.lead?.id ? detail.value : props.lead))
const activeTab = ref<TabName>('overview')
const loading = ref(false)
const followVisible = ref(false)
const followRecordRef = ref<InstanceType<typeof FollowRecordPanel>>()
let loadGeneration = 0

const isConverted = computed(() => lead.value?.transitionType === 'CUSTOMER')
const canWrite = computed(
  () => props.mode === 'lead' && auth.hasPerm('lead:update') && !isConverted.value,
)
const descriptionFields = computed(() => props.fields.filter((field) => !field.hidden))
const isAdmissionsConfig = computed(() =>
  props.fields.some((field) => /(学员|学生|家长|招生)/.test(field.label)),
)
const currentStage = computed(() =>
  props.leadStages?.find((stage) => stage.key === lead.value?.status),
)
const stageLabel = computed(() => currentStage.value?.name ?? lead.value?.status)
const isFailureStage = computed(() => currentStage.value?.kind === 'FAILURE')

function displayValue(field: FieldVO) {
  if (!lead.value) return '-'
  return formatFieldValue(field, lead.value as unknown as Record<string, unknown>, {
    memberMap: fieldRefs.memberMap.value,
    deptMap: fieldRefs.deptMap.value,
  })
}

async function refresh() {
  const id = props.lead?.id
  if (!id) return
  const generation = ++loadGeneration
  loading.value = true
  try {
    const { data } = await leadApi.get(id, props.mode === 'pool')
    if (generation === loadGeneration) detail.value = data
  } catch (error) {
    if (generation === loadGeneration) ElMessage.error(extractErrorMessage(error))
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
}

function action(event: 'edit' | 'convert' | 'toPool' | 'transfer' | 'delete' | 'claim' | 'assign') {
  if (!lead.value) return
  if (event === 'edit') emit('edit', lead.value)
  else if (event === 'convert') emit('convert', lead.value)
  else if (event === 'toPool') emit('toPool', lead.value)
  else if (event === 'transfer') emit('transfer', lead.value)
  else if (event === 'delete') emit('delete', lead.value)
  else if (event === 'claim') emit('claim', lead.value)
  else emit('assign', lead.value)
}

function createFollowRecord() {
  if (!canWrite.value || !lead.value) return
  activeTab.value = 'followRecord'
  followVisible.value = true
}

async function handleFollowChanged() {
  await refresh()
  emit('changed')
}

async function handleFollowCreated() {
  await followRecordRef.value?.refresh()
  await handleFollowChanged()
}

watch(
  () => [visible.value, props.lead?.id, props.mode] as const,
  async ([open]) => {
    ++loadGeneration
    detail.value = null
    followVisible.value = false
    activeTab.value = 'overview'
    if (!open || !props.lead) return
    try {
      if (!fieldRefs.members.value.length) await fieldRefs.load()
    } catch (error) {
      ElMessage.error(extractErrorMessage(error))
    }
    if (visible.value) await refresh()
  },
  { immediate: true },
)
</script>

<template>
  <el-drawer
    v-model="visible"
    size="660px"
    :with-header="false"
    destroy-on-close
    class="lead-overview-drawer"
  >
    <div class="flex h-full min-h-0 flex-col bg-white text-[#303133]">
      <header
        class="flex h-[58px] min-h-[58px] shrink-0 items-center justify-between bg-[#F7F8FA] px-5"
      >
        <h2 class="m-0 text-[18px] leading-none font-medium text-black">
          {{ mode === 'pool' ? '线索池详情' : '线索详情' }}
        </h2>
        <button
          type="button"
          aria-label="关闭线索详情"
          class="flex h-[18px] w-[18px] cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-[#999999] hover:text-[var(--el-color-primary)] focus-visible:outline-2 focus-visible:outline-[var(--el-color-primary)] focus-visible:outline-offset-2"
          @click="visible = false"
        >
          <X :size="18" :stroke-width="2" aria-hidden="true" />
        </button>
      </header>

      <div v-loading="loading" class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <template v-if="lead">
          <div
            class="mx-5 mt-5 mb-[10px] flex min-h-[100px] shrink-0 items-center gap-3 rounded-[7px] bg-[#F7F8FA] px-[18px] py-[17px] max-sm:gap-[9px] max-sm:p-3"
          >
            <div
              class="grid h-[62px] w-[62px] shrink-0 place-items-center rounded-full bg-[var(--el-color-primary-light-9)] text-[var(--el-color-primary)]"
              aria-hidden="true"
            >
              <UserRound :size="42" :stroke-width="1.65" />
            </div>
            <div class="flex min-w-0 flex-1 flex-col gap-[6px]">
              <div class="flex min-w-0 items-center gap-2">
                <strong class="truncate text-[20px] leading-none font-medium text-[#000000]">{{
                  lead.name
                }}</strong>
                <span
                  v-if="stageLabel"
                  class="shrink-0 rounded-[4px] px-2 py-[3px] text-[12px] leading-none"
                  :class="
                    isFailureStage
                      ? 'bg-[#FEEDEC] text-[#F04438]'
                      : 'bg-[var(--el-color-primary-light-9)] text-[var(--el-color-primary)]'
                  "
                  >{{ stageLabel }}</span
                >
              </div>
              <div v-if="lead.phone" class="text-[14px] leading-none text-[#999999]">
                {{ lead.phone }}
              </div>
            </div>
          </div>

          <el-tabs v-model="activeTab" class="flex min-h-0 flex-1 flex-col">
            <el-tab-pane label="概览" name="overview">
              <div
                class="h-full min-h-0 overflow-x-hidden overflow-y-auto px-5 pt-[20px] pb-5 [scrollbar-gutter:stable]"
              >
                <section v-if="descriptionFields.length">
                  <h3
                    class="m-0 mb-[13px] flex items-center gap-[6px] text-[14px] leading-none font-medium text-[#333333]"
                  >
                    <span
                      aria-hidden="true"
                      class="h-4 w-[3px] shrink-0 rounded-[4px] bg-[var(--el-color-primary)]"
                    />
                    {{ isAdmissionsConfig ? '学员信息' : '线索信息' }}
                  </h3>
                  <div class="grid grid-cols-3 items-start gap-x-5 gap-y-5 text-left">
                    <template v-for="field in descriptionFields" :key="field.id">
                      <section
                        v-if="field.type === 'textarea'"
                        class="col-span-3 mt-[10px] min-w-0"
                      >
                        <h3
                          class="m-0 flex items-center gap-[6px] text-[14px] leading-none font-medium text-[#333333]"
                        >
                          <span
                            aria-hidden="true"
                            class="h-4 w-[3px] shrink-0 rounded-[4px] bg-[var(--el-color-primary)]"
                          />
                          {{ field.label }}
                        </h3>
                        <div
                          class="mt-1 whitespace-pre-wrap break-words text-[14px] leading-none font-normal text-[#333333]"
                        >
                          {{ displayValue(field) }}
                        </div>
                      </section>
                      <div v-else class="min-w-0 text-left">
                        <div
                          class="break-words text-[14px] leading-none font-normal text-[#999999]"
                        >
                          {{ field.label }}
                        </div>
                        <div
                          class="mt-1 whitespace-pre-wrap break-words text-[14px] leading-none text-[#333333]"
                        >
                          {{ displayValue(field) }}
                        </div>
                      </div>
                    </template>
                  </div>
                </section>
                <el-empty v-else description="暂无可展示的线索信息" :image-size="80" />
              </div>
            </el-tab-pane>

            <el-tab-pane label="跟进记录" name="followRecord">
              <div
                class="h-full min-h-0 overflow-x-hidden overflow-y-auto px-5 pt-[10px] pb-5 [scrollbar-gutter:stable]"
              >
                <FollowRecordPanel
                  ref="followRecordRef"
                  target-type="lead"
                  :target-id="lead.id"
                  :target-name="lead.name"
                  :allow-create="canWrite"
                  :allow-manage="canWrite"
                  detail
                  @changed="handleFollowChanged"
                />
              </div>
            </el-tab-pane>

            <el-tab-pane label="变更记录" name="history">
              <div
                class="h-full min-h-0 overflow-x-hidden overflow-y-auto px-5 pt-[10px] pb-5 [scrollbar-gutter:stable]"
              >
                <LeadChangeHistoryTimeline
                  :lead-id="lead.id"
                  :owner-id="lead.ownerId"
                  :owner-name="lead.ownerName"
                  :collected-at="lead.collectedAt"
                />
              </div>
            </el-tab-pane>
          </el-tabs>
        </template>
      </div>

      <footer
        v-if="lead"
        class="flex shrink-0 flex-wrap items-center justify-end gap-[10px] border-t border-[#E9EDF2] bg-white px-5 py-[10px]"
      >
        <template v-if="mode === 'pool'">
          <el-button
            v-if="auth.hasPerm('leadPool:delete')"
            class="!ml-0 !h-[36px] !min-w-[88px] !rounded-[4px] !px-[10px] [--el-font-size-base:14px]"
            @click="action('delete')"
            >删除</el-button
          >
          <el-button
            v-if="auth.hasPerm('leadPool:update')"
            class="!ml-0 !h-[36px] !min-w-[88px] !rounded-[4px] !px-[10px] [--el-font-size-base:14px]"
            @click="action('edit')"
            >编辑字段</el-button
          >
          <el-button
            v-if="auth.hasPerm('leadPool:assign')"
            class="!ml-0 !h-[36px] !min-w-[88px] !rounded-[4px] !px-[10px] [--el-font-size-base:14px]"
            @click="action('assign')"
            >分配</el-button
          >
          <el-button
            v-if="auth.hasPerm('leadPool:pick')"
            type="primary"
            class="!ml-0 !h-[36px] !min-w-[88px] !rounded-[4px] !px-[10px] [--el-font-size-base:14px]"
            @click="action('claim')"
            >领取</el-button
          >
        </template>
        <template v-else-if="!isConverted">
          <el-button
            v-if="auth.hasPerm('lead:delete')"
            class="!ml-0 !h-[36px] !min-w-[88px] !rounded-[4px] !px-[10px] [--el-font-size-base:14px]"
            @click="action('delete')"
            >删除</el-button
          >
          <el-button
            v-if="auth.hasPerm('lead:recycle')"
            class="!ml-0 !h-[36px] !min-w-[108px] !rounded-[4px] !px-[10px] [--el-font-size-base:14px]"
            @click="action('toPool')"
            >移入线索池</el-button
          >
          <el-button
            v-if="auth.hasPerm('lead:transfer')"
            class="!ml-0 !h-[36px] !min-w-[88px] !rounded-[4px] !px-[10px] [--el-font-size-base:14px]"
            @click="action('transfer')"
            >转移</el-button
          >
          <el-button
            v-if="auth.hasPerm('lead:update')"
            class="!ml-0 !h-[36px] !min-w-[88px] !rounded-[4px] !px-[10px] [--el-font-size-base:14px]"
            @click="action('edit')"
            >编辑</el-button
          >
          <el-button
            v-if="canConvert"
            class="!ml-0 !h-[36px] !min-w-[88px] !rounded-[4px] !px-[10px] [--el-font-size-base:14px]"
            @click="action('convert')"
            >转换</el-button
          >
          <el-button
            v-if="canWrite"
            type="primary"
            class="!ml-0 !h-[36px] !min-w-[88px] !rounded-[4px] !px-[10px] [--el-font-size-base:14px] [--el-button-bg-color:var(--el-color-primary)] [--el-button-border-color:var(--el-color-primary)] [--el-button-text-color:#FFFFFF]"
            @click="createFollowRecord"
            >写跟进</el-button
          >
        </template>
      </footer>

      <FollowRecordFormDrawer
        v-if="lead && mode === 'lead'"
        v-model="followVisible"
        target-type="lead"
        :target-id="lead.id"
        :target-name="lead.name"
        append-to-body
        @saved="handleFollowCreated"
      />
    </div>
  </el-drawer>
</template>

<style scoped>
:global(.lead-overview-drawer.el-drawer) {
  max-width: 100vw;
}
:global(.lead-overview-drawer .el-drawer__body) {
  padding: 0;
  min-height: 0;
  overflow: hidden;
}
:deep(.el-tabs__header) {
  --el-font-size-base: 16px;
  --el-text-color-primary: #666666;
  margin: 0;
  padding: 10px 20px;
  flex-shrink: 0;
}
:deep(.el-tabs__item) {
  font-weight: 600;
}
:deep(.el-tabs--top > .el-tabs__header .el-tabs__item:nth-child(2)),
:deep(.el-tabs--top > .el-tabs__header .el-tabs__item:last-child) {
  padding-inline: 20px;
}
:deep(.el-tabs__item.is-active) {
  background: #e8f3ff;
  color: var(--el-color-primary);
  border-radius: 8px 8px 0 0;
}
:deep(.el-tabs__content) {
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
}
:deep(.el-tab-pane) {
  height: 100%;
  min-height: 0;
}
@media (max-width: 600px) {
  :deep(.el-tabs__header) {
    padding: 10px 14px;
  }
}
</style>
