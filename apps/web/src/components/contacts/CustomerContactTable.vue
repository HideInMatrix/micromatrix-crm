<script setup lang="ts">
import { isCustomFieldKey, type ContactVO, type FieldVO } from '@micromatrix/shared'
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import { contactApi } from '@/api/sales'
import DynamicForm from '@/components/form-engine/DynamicForm.vue'
import { formatFieldValue } from '@/components/form-engine/field-display'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{
  sourceId: string
  readonly?: boolean
}>()

const auth = useAuthStore()
const router = useRouter()
const fieldRefs = useFieldRefs()
const fields = ref<FieldVO[]>([])
const loading = ref(false)
const rows = ref<ContactVO[]>([])
const keyword = ref('')

const formVisible = ref(false)
const formSaving = ref(false)
const editingId = ref<string | null>(null)
const formModel = ref<Record<string, unknown>>({})
const formRef = ref<InstanceType<typeof DynamicForm>>()

const deactivateVisible = ref(false)
const deactivateSaving = ref(false)
const deactivateTarget = ref<ContactVO | null>(null)
const deactivateReason = ref('')

const formFields = computed(() =>
  fields.value.filter((field) => !field.hidden && !['customerId', 'enable'].includes(field.key)),
)
const listFields = computed(() => {
  const configured = fields.value.filter((field) => field.showInList && !field.hidden)
  const filtered = configured.filter((field) => field.key !== 'customerId')
  return filtered.length
    ? filtered
    : fields.value.filter((field) => ['name', 'phone', 'ownerId', 'enable'].includes(field.key))
})
const filteredRows = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text) return rows.value
  return rows.value.filter(
    (row) => row.name.toLowerCase().includes(text) || (row.phone ?? '').toLowerCase().includes(text),
  )
})

async function load() {
  if (!props.sourceId) return
  loading.value = true
  try {
    const { data } = await contactApi.list(props.sourceId)
    rows.value = data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function rowToModel(row: ContactVO) {
  return {
    ownerId: row.ownerId ?? undefined,
    name: row.name,
    phone: row.phone ?? undefined,
    ...row.customData,
  }
}

function modelToPayload(model: Record<string, unknown>) {
  const payload: Record<string, unknown> = {}
  const customData: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(model)) {
    if (isCustomFieldKey(key)) customData[key] = value
    else payload[key] = value
  }
  if (Object.keys(customData).length) payload.customData = customData
  return payload
}

function openCreate() {
  editingId.value = null
  formModel.value = {}
  formVisible.value = true
}

function openEdit(row: ContactVO) {
  editingId.value = row.id
  formModel.value = rowToModel(row)
  formVisible.value = true
}

async function save() {
  if (!(await formRef.value?.validate())) return
  formSaving.value = true
  try {
    const payload = modelToPayload(formModel.value)
    if (editingId.value) await contactApi.update(editingId.value, payload)
    else await contactApi.create({ ...payload, customerId: props.sourceId } as { customerId: string; name: string })
    ElMessage.success(editingId.value ? '联系人已更新' : '联系人已新增')
    formVisible.value = false
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    formSaving.value = false
  }
}

async function toggleStatus(row: ContactVO) {
  if (props.readonly) return
  if (row.enable) {
    deactivateTarget.value = row
    deactivateReason.value = ''
    deactivateVisible.value = true
    return
  }
  const confirmed = await ElMessageBox.confirm(`确定启用联系人「${row.name}」？`, '启用联系人', {
    confirmButtonText: '启用',
    cancelButtonText: '取消',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await contactApi.enable(row.id)
    ElMessage.success('已启用')
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function confirmDeactivate() {
  if (!deactivateTarget.value) return
  const reason = deactivateReason.value.trim()
  if (!reason) {
    ElMessage.warning('请填写停用原因')
    return
  }
  deactivateSaving.value = true
  try {
    await contactApi.disable(deactivateTarget.value.id, reason)
    ElMessage.success('已停用')
    deactivateVisible.value = false
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    deactivateSaving.value = false
  }
}

async function remove(row: ContactVO) {
  try {
    const { data } = await contactApi.checkOpportunity(row.id)
    if (data) {
      await ElMessageBox.confirm(
        `联系人「${row.name}」已关联商机，请先处理商机关联后再删除。`,
        '联系人已关联商机',
        {
          type: 'warning',
          confirmButtonText: '知道了',
          cancelButtonText: '去处理',
          distinguishCancelAndClose: true,
        },
      ).catch((action) => {
        if (action === 'cancel') router.push('/opportunities')
        return false
      })
      return
    }
    const confirmed = await ElMessageBox.confirm(
      `删除联系人「${row.name}」后不可恢复，确定继续？`,
      '删除联系人',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    ).catch(() => false)
    if (!confirmed) return
    await contactApi.remove(row.id)
    ElMessage.success('联系人已删除')
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function displayValue(field: FieldVO, row: ContactVO) {
  if (field.key === 'ownerId') return row.ownerName ?? '-'
  return formatFieldValue(field, row as unknown as Record<string, unknown>, {
    memberMap: fieldRefs.memberMap.value,
    deptMap: fieldRefs.deptMap.value,
  })
}

watch(() => props.sourceId, load)

onMounted(async () => {
  const [{ data }] = await Promise.all([metadataApi.fields('contact'), fieldRefs.load()])
  fields.value = data
  await load()
})
</script>

<template>
  <div v-loading="loading">
    <div class="flex-between gap-3 mb-3">
      <el-button
        v-if="!readonly && auth.hasPerm('contact:create')"
        type="primary"
        @click="openCreate"
      >
        新增联系人
      </el-button>
      <div v-else />
      <el-input
        v-model="keyword"
        clearable
        placeholder="搜索联系人姓名、电话"
        class="!w-[240px]"
      />
    </div>

    <el-table :data="filteredRows" border row-key="id" empty-text="暂无联系人">
      <template v-for="field in listFields" :key="field.key">
        <el-table-column
          :label="field.label"
          :prop="field.key"
          :min-width="field.listWidth ?? 120"
          show-overflow-tooltip
        >
          <template #default="{ row }">
            <el-switch
              v-if="field.key === 'enable'"
              :model-value="row.enable"
              :disabled="readonly || !auth.hasPerm('contact:update')"
              @click.stop="toggleStatus(row as ContactVO)"
            />
            <span v-else>{{ displayValue(field, row as ContactVO) }}</span>
          </template>
        </el-table-column>
      </template>
      <el-table-column v-if="!readonly" label="操作" width="130" fixed="right">
        <template #default="{ row }">
          <el-button v-if="auth.hasPerm('contact:update')" link type="primary" @click="openEdit(row as ContactVO)">
            编辑
          </el-button>
          <el-button v-if="auth.hasPerm('contact:delete')" link type="danger" @click="remove(row as ContactVO)">
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-drawer
      v-model="formVisible"
      :title="editingId ? '编辑联系人' : '新增联系人'"
      size="560px"
      append-to-body
      destroy-on-close
      :close-on-click-modal="false"
    >
      <DynamicForm
        ref="formRef"
        v-model="formModel"
        :fields="formFields"
        :members="fieldRefs.members.value"
        :dept-tree="fieldRefs.deptTree.value"
      />
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="formSaving" @click="save">保存</el-button>
      </template>
    </el-drawer>

    <el-dialog
      v-model="deactivateVisible"
      append-to-body
      width="480px"
      :title="`停用原因${deactivateTarget ? `（${deactivateTarget.name}）` : ''}`"
      :close-on-click-modal="false"
    >
      <el-form label-position="top">
        <el-form-item label="停用原因" required>
          <el-input
            v-model="deactivateReason"
            type="textarea"
            :rows="4"
            maxlength="200"
            show-word-limit
            placeholder="请输入停用原因"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="deactivateVisible = false">取消</el-button>
        <el-button type="primary" :loading="deactivateSaving" @click="confirmDeactivate">停用</el-button>
      </template>
    </el-dialog>
  </div>
</template>
