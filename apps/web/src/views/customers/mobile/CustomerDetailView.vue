<script setup lang="ts">
import {
  type ContactVO,
  type CustomerVO,
  type FieldVO,
  type FollowUpVO,
  type OwnerHistoryVO,
  type TeamMemberVO,
  isCustomFieldKey,
} from '@micromatrix/shared'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showConfirmDialog, showFailToast, showSuccessToast } from 'vant'
import {
  listCustomerOptions,
  listCustomerRelations,
  removeCustomer,
  replaceCustomerRelations,
  updateCustomer,
  type CustomerRelationVO,
} from '@/api/customers'
import { extractErrorMessage } from '@/api/http'
import { customerExtraApi } from '@/api/sales'
import { formatFieldValue } from '@/components/form-engine/field-display'
import { useFieldRefs } from '@/composables/useFieldRefs'
import MobileFollowUpSheet from '@/components/MobileFollowUpSheet.vue'
import MobileFollowUpPlanList from '@/components/MobileFollowUpPlanList.vue'
import MobileDynamicForm from '@/components/MobileDynamicForm.vue'
import { fetchFields, getCustomer, listCustomerContacts, listFollowUps } from '@/api/mobile'
import { useAuthStore } from '@/stores/auth'

type DetailTab = 'info' | 'contact' | 'record' | 'plan' | 'header' | 'relation' | 'collaborator'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const fieldRefs = useFieldRefs()

const activeTab = ref<DetailTab>('info')
const loading = ref(false)
const customer = ref<CustomerVO | null>(null)
const fields = ref<FieldVO[]>([])
const contacts = ref<ContactVO[]>([])
const records = ref<FollowUpVO[]>([])
const ownerHistory = ref<OwnerHistoryVO[]>([])
const relations = ref<CustomerRelationVO[]>([])
const collaborators = ref<TeamMemberVO[]>([])

const followShow = ref(false)
const editShow = ref(false)
const editSaving = ref(false)
const editModel = ref<Record<string, unknown>>({})
const moreShow = ref(false)
const transferShow = ref(false)
const relationShow = ref(false)
const collaboratorShow = ref(false)

const relationEditingId = ref<string | null>(null)
const relationType = ref<'GROUP' | 'SUBSIDIARY'>('SUBSIDIARY')
const relationCustomerId = ref('')
const relationOptions = ref<{ id: string; name: string }[]>([])

const collaboratorEditingId = ref<string | null>(null)
const collaboratorUserId = ref('')
const collaborationType = ref<'READ_ONLY' | 'COLLABORATION'>('COLLABORATION')

const customerId = computed(() => String(route.query.id ?? ''))
const poolSource = computed(() => route.query.source === 'openSea')
const canWrite = computed(
  () => customer.value?.canCollaborateWrite === true && auth.hasPerm('customer:update'),
)
const canMainAction = computed(
  () =>
    customer.value?.canManageCustomer === true &&
    customer.value.inSea !== true &&
    !customer.value.collaborationType,
)
const canEditRelations = computed(
  () =>
    auth.hasPerm('customer:update') &&
    (customer.value?.canManageCustomer === true ||
      customer.value?.collaborationType === 'COLLABORATION'),
)
const detailTabs = computed<{ name: DetailTab; title: string }[]>(() => {
  if (customer.value?.inSea) {
    return [
      { name: 'info', title: '客户信息' },
      { name: 'record', title: '跟进记录' },
      { name: 'plan', title: '跟进计划' },
      { name: 'header', title: '负责人记录' },
    ]
  }
  return [
    { name: 'info', title: '客户信息' },
    ...(auth.hasPerm('contact:read') ? [{ name: 'contact' as const, title: '联系人' }] : []),
    { name: 'record', title: '跟进记录' },
    { name: 'plan', title: '跟进计划' },
    { name: 'header', title: '负责人记录' },
    { name: 'relation', title: '客户关系' },
    ...(!customer.value?.collaborationType
      ? [{ name: 'collaborator' as const, title: '协作人' }]
      : []),
  ]
})

const descriptionFields = computed(() => fields.value.filter((field) => !field.hidden))

const relationColumns = computed(() =>
  relationOptions.value
    .filter((item) => item.id !== customerId.value)
    .map((item) => ({ text: item.name, value: item.id })),
)
const memberColumns = computed(() =>
  fieldRefs.members.value.map((item) => ({ text: item.name, value: item.id })),
)

function displayField(field: FieldVO) {
  if (!customer.value) return '-'
  return formatFieldValue(field, customer.value as unknown as Record<string, unknown>, {
    memberMap: fieldRefs.memberMap.value,
    deptMap: fieldRefs.deptMap.value,
  })
}

function buildEditModel() {
  if (!customer.value) return {}
  const model: Record<string, unknown> = {}
  for (const field of fields.value) {
    if (field.type === 'formula') continue
    model[field.key] = isCustomFieldKey(field.key)
      ? customer.value.customData[field.key]
      : (customer.value as unknown as Record<string, unknown>)[field.key]
  }
  return model
}

function modelToPayload(model: Record<string, unknown>) {
  const payload: Record<string, unknown> = {}
  const customData: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(model)) {
    if (value === undefined || value === '') continue
    if (isCustomFieldKey(key)) customData[key] = value
    else payload[key] = value
  }
  payload.customData = customData
  return payload
}

async function load() {
  if (!customerId.value) {
    router.replace('/customers')
    return
  }
  loading.value = true
  try {
    const [detailRes, fieldRes] = await Promise.all([
      getCustomer(customerId.value, poolSource.value),
      fetchFields('customer'),
      fieldRefs.load(),
    ])
    customer.value = detailRes.data
    fields.value = fieldRes.data

    const [contactRes, followRes, historyRes, relationRes, teamRes] = await Promise.all([
      !poolSource.value && auth.hasPerm('contact:read')
        ? listCustomerContacts(customerId.value)
        : Promise.resolve({ data: [] as ContactVO[] }),
      poolSource.value
        ? Promise.resolve({ data: [] as FollowUpVO[] })
        : listFollowUps('customer', customerId.value),
      customerExtraApi.ownerHistory(customerId.value),
      poolSource.value
        ? Promise.resolve({ data: [] as CustomerRelationVO[] })
        : listCustomerRelations(customerId.value),
      poolSource.value || customer.value.collaborationType
        ? Promise.resolve({ data: [] as TeamMemberVO[] })
        : customerExtraApi.teamList(customerId.value),
    ])
    contacts.value = contactRes.data
    records.value = followRes.data
    ownerHistory.value = historyRes.data
    relations.value = relationRes.data
    collaborators.value = teamRes.data
  } catch (error) {
    showFailToast(extractErrorMessage(error))
    router.replace('/customers')
  } finally {
    loading.value = false
  }
}

async function reloadRecords() {
  try {
    const { data } = await listFollowUps('customer', customerId.value)
    records.value = data
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

function openEdit() {
  editModel.value = buildEditModel()
  editShow.value = true
}

async function saveEdit() {
  if (!editModel.value.name || String(editModel.value.name).trim() === '') {
    showFailToast('请填写客户名称')
    return
  }
  editSaving.value = true
  try {
    await updateCustomer(customerId.value, modelToPayload(editModel.value))
    showSuccessToast('客户已更新')
    editShow.value = false
    await load()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    editSaving.value = false
  }
}

async function transferOwner({ selectedValues }: { selectedValues: string[] }) {
  const userId = selectedValues[0]
  if (!userId) return
  try {
    await customerExtraApi.assign(customerId.value, userId)
    showSuccessToast('客户已转移')
    transferShow.value = false
    moreShow.value = false
    await load()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

async function moveToSea() {
  moreShow.value = false
  const confirmed = await showConfirmDialog({
    title: '移入客户公海',
    message: `确认将「${customer.value?.name ?? ''}」移入客户公海？`,
  })
    .then(() => true)
    .catch(() => false)
  if (!confirmed) return
  try {
    await customerExtraApi.toSea(customerId.value)
    showSuccessToast('已移入客户公海')
    router.replace('/customers')
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

async function handleDelete() {
  moreShow.value = false
  const confirmed = await showConfirmDialog({
    title: '删除客户',
    message: `确认删除「${customer.value?.name ?? ''}」？`,
    confirmButtonText: '删除',
    confirmButtonColor: '#ee0a24',
  })
    .then(() => true)
    .catch(() => false)
  if (!confirmed) return
  try {
    await removeCustomer(customerId.value)
    showSuccessToast('客户已删除')
    router.replace('/customers')
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

async function openRelationEditor(relation?: CustomerRelationVO) {
  try {
    if (relationOptions.value.length === 0) {
      const { data } = await listCustomerOptions()
      relationOptions.value = data
    }
    relationEditingId.value = relation?.id ?? null
    relationType.value = relation?.relationType ?? 'SUBSIDIARY'
    relationCustomerId.value = relation?.customerId ?? ''
    relationShow.value = true
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

function selectRelationCustomer({ selectedValues }: { selectedValues: string[] }) {
  relationCustomerId.value = selectedValues[0] ?? ''
}

async function saveRelation() {
  if (!relationCustomerId.value) {
    showFailToast('请选择关联客户')
    return
  }
  const next = relations.value
    .filter((item) => item.id !== relationEditingId.value)
    .map((item) => ({ relationType: item.relationType, customerId: item.customerId }))
  next.push({ relationType: relationType.value, customerId: relationCustomerId.value })
  try {
    const { data } = await replaceCustomerRelations(customerId.value, next)
    relations.value = data
    relationShow.value = false
    showSuccessToast(relationEditingId.value ? '客户关系已更新' : '客户关系已添加')
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

async function deleteRelation(relation: CustomerRelationVO) {
  try {
    const next = relations.value
      .filter((item) => item.id !== relation.id)
      .map((item) => ({ relationType: item.relationType, customerId: item.customerId }))
    const { data } = await replaceCustomerRelations(customerId.value, next)
    relations.value = data
    showSuccessToast('客户关系已删除')
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

function openCollaboratorEditor(member?: TeamMemberVO) {
  collaboratorEditingId.value = member?.id ?? null
  collaboratorUserId.value = member?.userId ?? ''
  collaborationType.value = member?.collaborationType ?? 'COLLABORATION'
  collaboratorShow.value = true
}

function selectCollaborator({ selectedValues }: { selectedValues: string[] }) {
  collaboratorUserId.value = selectedValues[0] ?? ''
}

async function saveCollaborator() {
  if (!collaboratorUserId.value) {
    showFailToast('请选择协作人')
    return
  }
  try {
    if (collaboratorEditingId.value) {
      await customerExtraApi.teamUpdate(
        customerId.value,
        collaboratorEditingId.value,
        collaborationType.value,
      )
    } else {
      await customerExtraApi.teamAdd(
        customerId.value,
        collaboratorUserId.value,
        undefined,
        collaborationType.value,
      )
    }
    const { data } = await customerExtraApi.teamList(customerId.value)
    collaborators.value = data
    collaboratorShow.value = false
    showSuccessToast(collaboratorEditingId.value ? '协作设置已更新' : '协作人已添加')
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

async function deleteCollaborator(member: TeamMemberVO) {
  try {
    await customerExtraApi.teamRemove(customerId.value, member.id)
    collaborators.value = collaborators.value.filter((item) => item.id !== member.id)
    showSuccessToast('协作人已移除')
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

onMounted(load)
</script>

<template>
  <div class="h-full min-h-screen flex flex-col bg-[#f7f8fa]">
    <van-nav-bar :title="customer?.name ?? '客户详情'" left-arrow @click-left="router.back()" />

    <van-loading v-if="loading" class="py-16 text-center" />
    <template v-else-if="customer">
      <van-tabs v-model:active="activeTab" border class="detail-tabs flex-1 min-h-0">
        <van-tab v-for="tab in detailTabs" :key="tab.name" :name="tab.name" :title="tab.title">
          <div class="h-full overflow-auto pb-4">
            <template v-if="tab.name === 'info'">
              <van-cell-group inset class="!mt-4">
                <van-cell
                  v-for="field in descriptionFields"
                  :key="field.id"
                  :title="field.label"
                  :value="displayField(field)"
                />
              </van-cell-group>
            </template>

            <template v-else-if="tab.name === 'contact'">
              <van-empty v-if="contacts.length === 0" description="暂无联系人" />
              <van-cell-group v-for="contact in contacts" :key="contact.id" inset class="!mt-3">
                <van-cell :title="contact.name" :label="contact.phone ?? '未填写电话'">
                  <template #value>{{ contact.ownerName ?? '-' }}</template>
                </van-cell>
              </van-cell-group>
            </template>

            <template v-else-if="tab.name === 'record'">
              <div v-if="canWrite" class="px-4 pt-3">
                <van-button type="primary" plain block size="small" @click="followShow = true"
                  >新增跟进</van-button
                >
              </div>
              <van-empty v-if="records.length === 0" description="暂无跟进记录" />
              <van-cell-group v-for="record in records" :key="record.id" inset class="!mt-3">
                <van-cell :title="record.type" :label="record.content">
                  <template #value>{{ new Date(record.createdAt).toLocaleDateString() }}</template>
                </van-cell>
              </van-cell-group>
            </template>

            <MobileFollowUpPlanList
              v-else-if="tab.name === 'plan'"
              target-type="customer"
              :target-id="customerId"
              :target-name="customer.name"
              :can-write="canWrite"
            />

            <template v-else-if="tab.name === 'header'">
              <van-empty v-if="ownerHistory.length === 0" description="暂无负责人记录" />
              <van-cell-group v-for="item in ownerHistory" :key="item.id" inset class="!mt-3">
                <van-cell
                  :title="item.ownerName ?? '未知负责人'"
                  :value="item.departmentName ?? '-'"
                />
                <van-cell
                  title="归属开始"
                  :value="item.collectedAt ? new Date(item.collectedAt).toLocaleString() : '-'"
                />
                <van-cell title="归属结束" :value="new Date(item.endedAt).toLocaleString()" />
                <van-cell title="回收原因" :value="item.reasonName ?? '-'" />
                <van-cell title="操作人" :value="item.operatorName ?? '-'" />
              </van-cell-group>
            </template>

            <template v-else-if="tab.name === 'relation'">
              <div v-if="canEditRelations" class="px-4 pt-3">
                <van-button type="primary" plain block size="small" @click="openRelationEditor()"
                  >添加客户关系</van-button
                >
              </div>
              <van-empty v-if="relations.length === 0" description="暂无客户关系" />
              <van-cell-group v-for="relation in relations" :key="relation.id" inset class="!mt-3">
                <van-cell :title="relation.customerName ?? '-'">
                  <template #label>{{
                    relation.relationType === 'GROUP' ? '集团客户' : '子公司'
                  }}</template>
                  <template v-if="canEditRelations" #value>
                    <span
                      class="text-[var(--van-primary-color)] mr-3"
                      @click="openRelationEditor(relation)"
                      >编辑</span
                    >
                    <span class="text-red-500" @click="deleteRelation(relation)">删除</span>
                  </template>
                </van-cell>
              </van-cell-group>
            </template>

            <template v-else-if="tab.name === 'collaborator'">
              <div v-if="auth.hasPerm('customer:update')" class="px-4 pt-3">
                <van-button
                  type="primary"
                  plain
                  block
                  size="small"
                  @click="openCollaboratorEditor()"
                  >添加协作人</van-button
                >
              </div>
              <van-empty v-if="collaborators.length === 0" description="暂无协作人" />
              <van-cell-group v-for="member in collaborators" :key="member.id" inset class="!mt-3">
                <van-cell :title="member.userName" :label="member.role ?? '未设置角色'">
                  <template #value>
                    <van-tag
                      plain
                      :type="member.collaborationType === 'READ_ONLY' ? 'default' : 'primary'"
                    >
                      {{ member.collaborationType === 'READ_ONLY' ? '只读' : '协作' }}
                    </van-tag>
                  </template>
                </van-cell>
                <van-cell v-if="auth.hasPerm('customer:update')">
                  <template #value>
                    <span
                      class="text-[var(--van-primary-color)] mr-4"
                      @click="openCollaboratorEditor(member)"
                      >编辑</span
                    >
                    <span class="text-red-500" @click="deleteCollaborator(member)">移除</span>
                  </template>
                </van-cell>
              </van-cell-group>
            </template>
          </div>
        </van-tab>
      </van-tabs>

      <div
        v-if="
          activeTab === 'info' &&
          canMainAction &&
          (auth.hasPerm('customer:update') ||
            auth.hasPerm('customer:transfer') ||
            auth.hasPerm('customer:recycle') ||
            auth.hasPerm('customer:delete'))
        "
        class="shrink-0 bg-white border-t border-[#ebedf0] p-3 flex gap-3"
      >
        <van-button v-if="auth.hasPerm('customer:update')" block type="primary" @click="openEdit"
          >编辑</van-button
        >
        <van-button
          v-if="auth.hasPerm('customer:transfer') || auth.hasPerm('customer:recycle') || auth.hasPerm('customer:delete')"
          block
          plain
          @click="moreShow = true"
          >更多</van-button
        >
      </div>
    </template>

    <MobileFollowUpSheet
      v-model="followShow"
      target-type="customer"
      :target-id="customerId"
      :target-name="customer?.name"
      @followed="reloadRecords"
    />

    <van-popup v-model:show="editShow" position="bottom" round :style="{ height: '88%' }">
      <div class="h-full flex flex-col">
        <div class="p-4 text-center font-medium">编辑客户</div>
        <div class="flex-1 overflow-auto">
          <MobileDynamicForm v-model="editModel" :fields="fields" />
        </div>
        <div class="p-4">
          <van-button type="primary" block :loading="editSaving" @click="saveEdit">保存</van-button>
        </div>
      </div>
    </van-popup>

    <van-action-sheet v-model:show="moreShow" title="更多操作">
      <div class="p-4 space-y-3">
        <van-button v-if="auth.hasPerm('customer:transfer')" block @click="transferShow = true"
          >转移</van-button
        >
        <van-button v-if="auth.hasPerm('customer:recycle')" block @click="moveToSea"
          >移入客户公海</van-button
        >
        <van-button
          v-if="auth.hasPerm('customer:delete')"
          block
          type="danger"
          plain
          @click="handleDelete"
          >删除</van-button
        >
      </div>
    </van-action-sheet>

    <van-popup v-model:show="transferShow" position="bottom" round>
      <van-picker
        :columns="memberColumns"
        @confirm="transferOwner"
        @cancel="transferShow = false"
      />
    </van-popup>

    <van-popup v-model:show="relationShow" position="bottom" round>
      <div class="p-4">
        <div class="text-center font-medium mb-3">
          {{ relationEditingId ? '编辑客户关系' : '添加客户关系' }}
        </div>
        <van-radio-group v-model="relationType" direction="horizontal" class="mb-3 justify-center">
          <van-radio name="GROUP">集团客户</van-radio>
          <van-radio name="SUBSIDIARY">子公司</van-radio>
        </van-radio-group>
        <van-picker
          :columns="relationColumns"
          @change="selectRelationCustomer"
          @confirm="selectRelationCustomer"
        />
        <van-button type="primary" block class="mt-3" @click="saveRelation">保存</van-button>
      </div>
    </van-popup>

    <van-popup v-model:show="collaboratorShow" position="bottom" round>
      <div class="p-4">
        <div class="text-center font-medium mb-3">
          {{ collaboratorEditingId ? '编辑协作设置' : '添加协作人' }}
        </div>
        <van-radio-group
          v-model="collaborationType"
          direction="horizontal"
          class="mb-3 justify-center"
        >
          <van-radio name="COLLABORATION">协作</van-radio>
          <van-radio name="READ_ONLY">只读</van-radio>
        </van-radio-group>
        <van-picker
          v-if="!collaboratorEditingId"
          :columns="memberColumns"
          @change="selectCollaborator"
          @confirm="selectCollaborator"
        />
        <van-cell
          v-else
          title="协作人"
          :value="fieldRefs.memberMap.value.get(collaboratorUserId) ?? '-'"
        />
        <van-button type="primary" block class="mt-3" @click="saveCollaborator">保存</van-button>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.detail-tabs :deep(.van-tabs__content),
.detail-tabs :deep(.van-tab__panel) {
  height: 100%;
}

.detail-tabs :deep(.van-tabs__content) {
  overflow: hidden;
}
</style>
