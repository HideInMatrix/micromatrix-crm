<script setup lang="ts">
import CrmDialog from '@/components/CrmDialog.vue'
import FormAlert from '@/components/form-engine/FormAlert.vue'
import { createAlertField, type CustomerVO } from '@micromatrix/shared'
import { computed, reactive, ref, watch } from 'vue'
import {
  listCustomers,
  mergeCustomers,
  previewCustomerMerge,
  type CustomerMergePayload,
  type CustomerMergePreviewVO,
} from '@/api/customers'
import { extractErrorMessage } from '@/api/http'

const props = defineProps<{
  selectedRows: CustomerVO[]
}>()

const mergeWarningAlert = createAlertField({
  id: 'customer-merge-warning',
  position: 0,
  icon: 'triangle-alert',
  text: '合并后不可回退：仅保留主客户基本信息，其它已选客户将被移除；关联业务数据会迁移到主客户。',
  color: '#409eff',
  fontSize: 14,
  backgroundColor: '#ecf5ff',
}, 'customer')

const mergeConfirmAlert = createAlertField({
  id: 'customer-merge-confirm-warning',
  position: 0,
  icon: 'triangle-alert',
  text: '确认后将删除被合并客户，操作不可回退。请确认主客户、负责人和影响预览无误。',
  color: '#f04438',
  fontSize: 14,
  backgroundColor: '#fef0f0',
}, 'customer')

const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ merged: [targetId: string] }>()

const step = ref(0)
const loading = ref(false)
const preview = ref<CustomerMergePreviewVO | null>(null)
const otherLoading = ref(false)
const otherOptions = ref<CustomerVO[]>([])

const form = reactive<{
  targetMode: 'selected' | 'other'
  toMergeId: string
  ownerId: string
}>({
  targetMode: 'selected',
  toMergeId: '',
  ownerId: '',
})

const selectedTargetOptions = computed(() => props.selectedRows)
const selectedOwnerOptions = computed(() => {
  const map = new Map<string, string>()
  for (const row of props.selectedRows) {
    if (row.ownerId) map.set(row.ownerId, row.ownerName ?? row.ownerId)
  }
  return [...map].map(([id, name]) => ({ id, name }))
})
const currentOtherTarget = computed(
  () => otherOptions.value.find((item) => item.id === form.toMergeId) ?? null,
)

function reset() {
  step.value = 0
  preview.value = null
  Object.assign(form, {
    targetMode: 'selected',
    toMergeId: '',
    ownerId: '',
  })
  otherOptions.value = []
}

function switchTargetMode() {
  form.toMergeId = ''
  form.ownerId = ''
  preview.value = null
  if (form.targetMode === 'other') loadOtherCustomers()
}

function handleTargetChange() {
  preview.value = null
  if (form.targetMode === 'selected') {
    const target = props.selectedRows.find((row) => row.id === form.toMergeId)
    form.ownerId = target?.ownerId ?? ''
  } else {
    form.ownerId = currentOtherTarget.value?.ownerId ?? ''
  }
}


async function loadOtherCustomers(keyword?: string) {
  if (form.targetMode !== 'other') return
  otherLoading.value = true
  try {
    const { data } = await listCustomers({
      page: 1,
      pageSize: 50,
      keyword: keyword?.trim() || undefined,
    })
    const selectedIds = new Set(props.selectedRows.map((row) => row.id))
    otherOptions.value = data.items.filter((row) => !selectedIds.has(row.id) && !!row.ownerId)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    otherLoading.value = false
  }
}

function payload(): CustomerMergePayload | null {
  if (props.selectedRows.length === 0) {
    ElMessage.warning('请先选择要合并的客户')
    return null
  }
  if (form.targetMode === 'selected' && props.selectedRows.length < 2) {
    ElMessage.warning('主客户来自已选客户时至少需要选择 2 个客户，也可以合并至其它可见客户')
    return null
  }
  if (!form.toMergeId) {
    ElMessage.warning('请选择合并后的主客户')
    return null
  }
  if (!form.ownerId) {
    ElMessage.warning('请选择最终负责人')
    return null
  }
  return {
    mergeIds: props.selectedRows.map((row) => row.id),
    toMergeId: form.toMergeId,
    ownerId: form.ownerId,
  }
}

async function generatePreview() {
  const data = payload()
  if (!data) return
  loading.value = true
  try {
    const { data: result } = await previewCustomerMerge(data)
    preview.value = result
    step.value = 1
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function executeMerge() {
  const data = payload()
  if (!data || !preview.value) return
  const confirmed = await ElMessageBox.confirm(
    `将删除 ${preview.value.counts.customersToDelete} 个被合并客户，操作不可回退。`,
    '确认合并客户',
    {
      type: 'warning',
      confirmButtonText: '确认合并',
      cancelButtonText: '取消',
    },
  ).catch(() => false)
  if (!confirmed) return

  loading.value = true
  try {
    const { data: result } = await mergeCustomers(data)
    ElMessage.success(`客户合并成功，共合并 ${result.merged} 个客户`)
    visible.value = false
    emit('merged', result.id)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

watch(visible, (open) => {
  if (open) reset()
})
</script>

<template>
  <CrmDialog v-model="visible" title="合并客户" width="760px" destroy-on-close>
    <el-steps :active="step" simple class="mb-5">
      <el-step title="选择主客户" />
      <el-step title="影响预览与确认" />
    </el-steps>

    <template v-if="step === 0">
      <FormAlert :field="mergeWarningAlert" class="mb-4" />

      <el-form label-width="110px">
        <el-form-item label="已选客户">
          <div class="flex flex-wrap gap-1">
            <el-tag v-for="row in selectedRows" :key="row.id" size="small">
              {{ row.name }}
            </el-tag>
          </div>
        </el-form-item>

        <el-form-item label="主客户来源">
          <el-radio-group v-model="form.targetMode" @change="switchTargetMode">
            <el-radio value="selected">已选客户</el-radio>
            <el-radio value="other">其它可见客户</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="合并至" required>
          <el-select
            v-if="form.targetMode === 'selected'"
            v-model="form.toMergeId"
            filterable
            class="w-full"
            @change="handleTargetChange"
          >
            <el-option
              v-for="row in selectedTargetOptions"
              :key="row.id"
              :label="row.name"
              :value="row.id"
            />
          </el-select>
          <el-select
            v-else
            v-model="form.toMergeId"
            filterable
            remote
            :remote-method="loadOtherCustomers"
            :loading="otherLoading"
            class="w-full"
            placeholder="搜索其它可见客户"
            @change="handleTargetChange"
          >
            <el-option
              v-for="row in otherOptions"
              :key="row.id"
              :label="row.name"
              :value="row.id"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="最终负责人" required>
          <el-select
            v-if="form.targetMode === 'selected'"
            v-model="form.ownerId"
            filterable
            class="w-full"
          >
            <el-option
              v-for="owner in selectedOwnerOptions"
              :key="owner.id"
              :label="owner.name"
              :value="owner.id"
            />
          </el-select>
          <el-input
            v-else
            :model-value="currentOtherTarget?.ownerName ?? '未选择主客户'"
            disabled
          />
          <div class="text-xs text-[var(--el-text-color-secondary)] my-1">
            已选客户作为主客户时，只能选择已选客户已有负责人；其它客户作为主客户时负责人保持不变。
          </div>
        </el-form-item>
      </el-form>

      <div class="rounded border border-[var(--el-border-color-lighter)] p-4 text-sm leading-7">
        <div class="font-medium">合并规则</div>
        <div>1. 仅保留主客户的基本信息。</div>
        <div>2. 跟进记录、跟进计划、客户附件和协作成员迁移到主客户。</div>
        <div>3. 被合并客户负责人将作为主客户协作成员保留（与最终负责人相同者除外）。</div>
        <div>4. 被合并客户的集团/子公司关系会移除，主客户已有关系保留。</div>
      </div>
    </template>

    <template v-else-if="preview">
      <el-descriptions :column="2" border class="mb-4">
        <el-descriptions-item label="主客户">{{ preview.target.name }}</el-descriptions-item>
        <el-descriptions-item label="最终负责人">{{ preview.finalOwner.name ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="删除客户">{{ preview.counts.customersToDelete }} 个</el-descriptions-item>
        <el-descriptions-item label="跟进">{{ preview.counts.followUps }}</el-descriptions-item>
        <el-descriptions-item label="跟进计划">{{
          preview.counts.followUpPlans
        }}</el-descriptions-item>
        <el-descriptions-item label="客户附件">{{
          preview.counts.attachments
        }}</el-descriptions-item>
        <el-descriptions-item label="协作关系">{{
          preview.counts.collaborations
        }}</el-descriptions-item>
        <el-descriptions-item label="将移除集团关系" :span="2">
          {{ preview.counts.relationsToRemove }} 条
        </el-descriptions-item>
      </el-descriptions>


      <FormAlert :field="mergeConfirmAlert" class="mt-4 merge-confirm-alert" />
    </template>

    <template #footer>
      <el-button v-if="step === 1" @click="step = 0">上一步</el-button>
      <el-button @click="visible = false">取消</el-button>
      <el-button v-if="step === 0" type="primary" :loading="loading" @click="generatePreview">
        下一步：影响预览
      </el-button>
      <el-button v-else type="danger" :loading="loading" @click="executeMerge">
        确认合并
      </el-button>
    </template>
  </CrmDialog>
</template>


<style scoped>
.merge-confirm-alert {
  border-color: #fecdca;
}
</style>
