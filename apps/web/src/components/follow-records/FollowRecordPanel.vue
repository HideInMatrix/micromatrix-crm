<script setup lang="ts">
import type { FollowTargetType, FollowUpVO } from '@micromatrix/shared'
import { ElMessage, ElMessageBox } from 'element-plus'
import { onMounted, ref, watch } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useFollowRecords } from '@/composables/useFollowRecords'
import FollowCommentPanel from './FollowCommentPanel.vue'
import FollowRecordFormDrawer from './FollowRecordFormDrawer.vue'
import FollowRecordTimeline from './FollowRecordTimeline.vue'

const props = withDefaults(
  defineProps<{
    targetType: FollowTargetType
    targetId: string | null
    targetName?: string
    autoLoad?: boolean
    allowCreate?: boolean
    allowManage?: boolean
  }>(),
  { targetName: '', autoLoad: true, allowCreate: true, allowManage: true },
)

const emit = defineEmits<{ changed: [] }>()

const { records, loading, load, remove, patch } = useFollowRecords(
  () => props.targetType,
  () => props.targetId,
)
const fieldRefs = useFieldRefs()
const formVisible = ref(false)
const editingRecordId = ref<string>()
const commentRecord = ref<FollowUpVO | null>(null)
let refsLoaded = false

async function ensureRefs() {
  if (refsLoaded) return
  try {
    await fieldRefs.load()
    refsLoaded = true
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function refresh() {
  await load()
}

function openCreate() {
  if (!props.targetId) return
  editingRecordId.value = undefined
  formVisible.value = true
}

function openEdit(record: FollowUpVO) {
  editingRecordId.value = record.id
  formVisible.value = true
}

async function removeRecord(record: FollowUpVO) {
  try {
    await ElMessageBox.confirm(
      '确认删除这条跟进记录？评论和动态字段数据也会一并删除。',
      '删除跟进记录',
      { type: 'warning' },
    )
    await remove(record)
    ElMessage.success('跟进记录已删除')
    emit('changed')
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(extractErrorMessage(error))
  }
}

async function openComments(record: FollowUpVO) {
  if (commentRecord.value?.id === record.id) {
    commentRecord.value = null
    return
  }
  commentRecord.value = record
  await ensureRefs()
}

function handleCommentCount(count: number) {
  if (!commentRecord.value) return
  patch(commentRecord.value.id, { commentCount: count })
  commentRecord.value = { ...commentRecord.value, commentCount: count }
}

async function handleSaved() {
  editingRecordId.value = undefined
  await load()
  emit('changed')
}

watch(
  () => [props.targetType, props.targetId] as const,
  () => {
    if (props.autoLoad) void load()
  },
)

onMounted(() => {
  if (props.autoLoad) void load()
})

defineExpose({ refresh })
</script>

<template>
  <div
    data-testid="follow-record-panel"
    :data-target-type="targetType"
    :data-target-id="targetId ?? undefined"
  >
    <FollowRecordTimeline
      :records="records"
      :loading="loading"
      :allow-create="allowCreate"
      :allow-manage="allowManage"
      @create="openCreate"
      @edit="openEdit"
      @remove="removeRecord"
      @comments="openComments"
    >
      <template #comments="{ record }">
        <el-collapse-transition>
          <div
            v-if="commentRecord?.id === record.id"
            class="mt-3 border-t border-[var(--el-border-color-lighter)] pt-3"
            data-testid="follow-comment-panel"
          >
            <FollowCommentPanel
              resource-type="record"
              :resource-id="record.id"
              :members="fieldRefs.members.value"
              @count-changed="handleCommentCount"
            />
          </div>
        </el-collapse-transition>
      </template>
    </FollowRecordTimeline>

    <FollowRecordFormDrawer
      v-if="targetId"
      v-model="formVisible"
      :target-type="targetType"
      :target-id="targetId"
      :target-name="targetName"
      :record-id="editingRecordId"
      @saved="handleSaved"
    />
  </div>
</template>
