<script setup lang="ts">
import {
  EXTERNAL_EVENT_LEAD_CONTACT_FIELD_KEY,
  EXTERNAL_EVENT_LEAD_PHONE_FIELD_KEY,
  EXTERNAL_EVENT_LEAD_POOL_FIELD_KEY,
  externalEventWritableFormFields,
} from '@micromatrix/shared'
import type {
  ExternalEventTemplateInput,
  ExternalEventTemplateVO,
  ExternalEventFlow,
  FieldVO,
} from '@micromatrix/shared'
import type { MemberOption } from '@/api/system'
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus, Trash2 } from 'lucide-vue-next'
import { metadataApi } from '@/api/metadata'
import { memberApi } from '@/api/system'
import { leadApi, type ResourcePoolVO } from '@/api/sales'
import { externalEventTemplateApi, type ExternalEventPreviewVO } from '@/api/external-events'
import { extractErrorMessage } from '@/api/http'

const visible = defineModel<boolean>({ required: true })
const props = defineProps<{ existing: ExternalEventTemplateVO | null; initialStep?: number }>()
const emit = defineEmits<{ saved: [] }>()
const steps = ['基本信息', '目标模块', '匹配配置', '流程方案', '字段映射', '测试配置']
const step = ref(0)
const busy = ref(false)
const savedId = ref<string | null>(null)
const leadFields = ref<FieldVO[]>([])
const customerFields = ref<FieldVO[]>([])
const members = ref<MemberOption[]>([])
const leadPools = ref<ResourcePoolVO[]>([])
const exampleText = ref('{}')
const previewResult = ref<ExternalEventPreviewVO | null>(null)

function newForm(): ExternalEventTemplateInput {
  return {
    name: '',
    eventType: '',
    source: '',
    apiKeyUserId: '',
    enabled: false,
    config: {
      actions: { convertLead: false, updateCustomer: false },
      matches: [{ externalKey: 'phone', crmFieldKey: 'phone' }],
      fields: [],
      owner: null,
      flow: {
        target: 'lead',
        action: 'update',
        fields: [],
        owner: null,
        nameExternalKey: 'studentName',
        identity: {
          phoneExternalKey: 'phone',
          customerPhoneFieldKey: 'cf_phone',
          leadPhoneFieldKey: 'phone',
        },
      },
    },
  }
}
const form = reactive<ExternalEventTemplateInput>(newForm())
const flow = computed(() => form.config.flow!)
const creating = computed(() => flow.value.action === 'create')
const upserting = computed(() => flow.value.action === 'upsertCustomer')
const needsName = computed(() => creating.value || upserting.value)
const targetFields = computed(() =>
  flow.value.target === 'lead' ? leadFields.value : customerFields.value,
)
const mappingFields = computed(() =>
  flow.value.action === 'convert' || upserting.value ? customerFields.value : targetFields.value,
)
const customerPhoneFields = computed(() =>
  customerFields.value.filter(
    (field) =>
      !field.hidden &&
      !field.system &&
      (field.type === 'phone' ||
        (field.type === 'text' && /手机|电话|phone/i.test(field.label + field.key))),
  ),
)
const leadPhoneFields = computed(() =>
  leadFields.value.filter(
    (field) =>
      !field.hidden &&
      (field.type === 'phone' ||
        (field.type === 'text' && /手机|电话|phone/i.test(field.label + field.key))),
  ),
)
const lookupFields = computed(() =>
  targetFields.value.filter(
    (f) =>
      !f.hidden &&
      (f.key === 'id' ||
        ['text', 'phone', 'email', 'number', 'select', 'member', 'date', 'datetime'].includes(
          f.type,
        )),
  ),
)
const writable = computed(() =>
  externalEventWritableFormFields(mappingFields.value, flow.value.action, flow.value.target),
)
const mappingModuleLabel = computed(() =>
  flow.value.action === 'convert' || upserting.value || flow.value.target === 'customer'
    ? '客户'
    : '线索',
)
const outdatedMappings = computed(() =>
  flow.value.fields.filter(
    (mapping) =>
      mapping.fieldKey &&
      mapping.fieldKey !== EXTERNAL_EVENT_LEAD_POOL_FIELD_KEY &&
      !writable.value.some(
        (field) => field.key === mapping.fieldKey || field.id === mapping.fieldKey,
      ),
  ),
)
const ownerEnabled = computed({
  get: () => Boolean(flow.value.owner),
  set: (on: boolean) => {
    flow.value.owner = on ? { externalKey: 'ownerId', provider: 'CRM' } : null
  },
})
function changeTarget(target: 'lead' | 'customer') {
  flow.value.target = target
  flow.value.action = 'update'
  flow.value.fields = []
  flow.value.owner = null
  form.config.matches = [{ externalKey: 'phone', crmFieldKey: '' }]
}
function changeAction(action: ExternalEventFlow['action']) {
  flow.value.action = action
  flow.value.fields = []
  flow.value.owner = null
  if (action === 'upsertCustomer') {
    flow.value.target = 'customer'
    flow.value.nameExternalKey ||= 'studentName'
    flow.value.identity = {
      phoneExternalKey: flow.value.identity?.phoneExternalKey || 'phone',
      customerPhoneFieldKey:
        customerPhoneFields.value.find(
          (field) => field.key === flow.value.identity?.customerPhoneFieldKey,
        )?.key ??
        customerPhoneFields.value[0]?.key ??
        '',
      leadPhoneFieldKey: flow.value.identity?.leadPhoneFieldKey || 'phone',
    }
    form.config.matches = []
  }
  if (['update', 'convert'].includes(action) && form.config.matches.length === 0) {
    form.config.matches = [
      {
        externalKey: 'phone',
        crmFieldKey: flow.value.target === 'lead' ? 'phone' : 'cf_phone',
      },
    ]
  }
}
function addMatch() {
  form.config.matches.push({ externalKey: '', crmFieldKey: '' })
}
function addField() {
  flow.value.fields.push({ source: 'event', externalKey: '', fieldKey: '', valueMap: [] })
}
function changeMappingSource(mapping: ExternalEventFlow['fields'][number]) {
  mapping.externalKey = ''
  mapping.provider = undefined
  if (mapping.source === 'leadOwner' && mapping.fieldKey === EXTERNAL_EVENT_LEAD_POOL_FIELD_KEY) {
    mapping.fieldKey = ''
    mapping.valueMap = []
  }
}
function changeMappingTarget(mapping: ExternalEventFlow['fields'][number]) {
  mapping.provider = undefined
  mapping.valueMap = []
}
function sample() {
  const data: Record<string, string> = {}
  if (!creating.value)
    for (const m of form.config.matches)
      if (m.externalKey)
        data[m.externalKey] = /phone/i.test(m.externalKey) ? '13800000000' : 'EXAMPLE_VALUE'
  for (const m of flow.value.fields) {
    if (m.source !== 'event' || !m.externalKey) continue
    if (m.fieldKey === EXTERNAL_EVENT_LEAD_CONTACT_FIELD_KEY) data[m.externalKey] = '张女士'
    else if (m.fieldKey === EXTERNAL_EVENT_LEAD_PHONE_FIELD_KEY) data[m.externalKey] = '13800000000'
    else data[m.externalKey] = m.valueMap?.[0]?.externalValue || 'EXAMPLE_VALUE'
  }
  if (needsName.value && flow.value.nameExternalKey) data[flow.value.nameExternalKey] = '张三'
  if (upserting.value && flow.value.identity?.phoneExternalKey)
    data[flow.value.identity.phoneExternalKey] = '13800000000'
  if (flow.value.owner?.externalKey)
    data[flow.value.owner.externalKey] =
      flow.value.owner.provider === 'CRM' ? 'CRM_MEMBER_ID' : 'EXTERNAL_USER_ID'
  exampleText.value = JSON.stringify(data, null, 2)
}
watch(visible, async (open) => {
  if (!open) return
  step.value =
    props.existing && Number.isInteger(props.initialStep)
      ? Math.min(5, Math.max(0, props.initialStep ?? 0))
      : 0
  savedId.value = props.existing?.id ?? null
  Object.assign(
    form,
    JSON.parse(
      JSON.stringify(
        props.existing
          ? {
              name: props.existing.name,
              eventType: props.existing.eventType,
              source: props.existing.source,
              apiKeyUserId: props.existing.apiKeyUserId,
              enabled: props.existing.enabled,
              config: props.existing.config,
            }
          : newForm(),
      ),
    ),
  )
  previewResult.value = null
  const legacyFlow = form.config.flow as
    { action: string; fields: ExternalEventFlow['fields'] } | undefined
  if (legacyFlow?.action === 'stage') {
    legacyFlow.action = 'update'
    legacyFlow.fields = []
    ElMessage.warning('此事件原先使用的线索状态动作已移除，请重新配置业务动作和字段映射')
  }
  try {
    const [lead, customer, people, pools] = await Promise.all([
      metadataApi.fields('lead'),
      metadataApi.fields('customer'),
      memberApi.options(),
      leadApi.moveTargetOptions(),
    ])
    leadFields.value = lead.data
    customerFields.value = customer.data
    members.value = people.data
    leadPools.value = pools.data
  } catch (e) {
    ElMessage.error(extractErrorMessage(e))
  }
  if (flow.value.action === 'upsertCustomer') {
    flow.value.identity ??= {
      phoneExternalKey: 'phone',
      customerPhoneFieldKey:
        customerPhoneFields.value.find((field) => field.type === 'phone')?.key ?? '',
      leadPhoneFieldKey: leadPhoneFields.value.find((field) => field.type === 'phone')?.key ?? '',
    }
  }
  sample()
})
async function save() {
  if (!form.name.trim() || !form.apiKeyUserId) {
    step.value = 0
    ElMessage.warning('请完善事件基本信息')
    return
  }
  if (
    !creating.value &&
    !upserting.value &&
    (!form.config.matches.length ||
      form.config.matches.some((x) => !x.externalKey || !x.crmFieldKey))
  ) {
    step.value = 2
    ElMessage.warning('请配置有效的资源定位条件')
    return
  }
  if (flow.value.action === 'update' && !flow.value.fields.length) {
    step.value = 4
    ElMessage.warning('字段更新至少需要一个映射')
    return
  }
  if (needsName.value && !flow.value.nameExternalKey) {
    step.value = 4
    ElMessage.warning('请指定学生姓名参数')
    return
  }
  const leadPoolMapping = flow.value.fields.find(
    (mapping) => mapping.fieldKey === EXTERNAL_EVENT_LEAD_POOL_FIELD_KEY,
  )
  if (creating.value && flow.value.target === 'lead' && flow.value.owner && !leadPoolMapping) {
    step.value = 4
    ElMessage.warning('请在字段映射中增加「线索池」映射，用于负责人无法匹配时确定线索归属')
    return
  }
  if (
    creating.value &&
    flow.value.target === 'lead' &&
    leadPoolMapping &&
    (!leadPoolMapping.externalKey || !leadPoolMapping.valueMap?.length)
  ) {
    step.value = 4
    ElMessage.warning('请完善线索池外部参数及选项值映射')
    return
  }
  if (upserting.value) {
    if (
      !flow.value.identity?.phoneExternalKey ||
      !flow.value.identity.customerPhoneFieldKey ||
      !flow.value.identity.leadPhoneFieldKey
    ) {
      step.value = 2
      ElMessage.warning('请配置客户和线索的手机号匹配字段')
      return
    }
    if (!flow.value.fields.length) {
      step.value = 4
      ElMessage.warning('缴费成功同步至少需要一个客户字段映射')
      return
    }
    const phoneMapping = flow.value.fields.find(
      (mapping) =>
        mapping.fieldKey === flow.value.identity?.customerPhoneFieldKey &&
        mapping.externalKey === flow.value.identity?.phoneExternalKey,
    )
    if (!phoneMapping) {
      step.value = 4
      ElMessage.warning('请将外部手机号参数映射到客户手机号字段')
      return
    }
  }
  busy.value = true
  try {
    const payload = JSON.parse(JSON.stringify(form)) as ExternalEventTemplateInput
    if (creating.value || upserting.value) payload.config.matches = []
    if (upserting.value && payload.config.flow) {
      const legacyFlow = payload.config.flow as ExternalEventFlow & { ownerStrategy?: unknown }
      delete legacyFlow.ownerStrategy
    }
    const result = savedId.value
      ? await externalEventTemplateApi.update(savedId.value, payload)
      : await externalEventTemplateApi.create({
          name: payload.name,
          apiKeyUserId: payload.apiKeyUserId,
          enabled: payload.enabled,
          config: payload.config,
        })
    savedId.value = result.data.id
    form.eventType = result.data.eventType
    form.source = result.data.source
    ElMessage.success('外部事件已保存')
    emit('saved')
    if (step.value !== 5) visible.value = false
  } catch (e) {
    ElMessage.error(extractErrorMessage(e))
  } finally {
    busy.value = false
  }
}
async function preview() {
  if (!savedId.value) {
    ElMessage.warning('请先保存配置')
    return
  }
  let data: Record<string, unknown>
  try {
    data = JSON.parse(exampleText.value) as Record<string, unknown>
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error()
  } catch {
    ElMessage.warning('参数必须是 JSON 对象')
    return
  }
  busy.value = true
  try {
    previewResult.value = (await externalEventTemplateApi.preview(savedId.value, data)).data
  } catch (e) {
    previewResult.value = null
    ElMessage.error(extractErrorMessage(e))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <el-drawer
    v-model="visible"
    :title="props.existing ? '编辑外部事件' : '新建外部事件'"
    size="min(960px, 94vw)"
    destroy-on-close
  >
    <div class="flex h-full min-h-0 flex-col">
      <div class="mb-5 flex flex-wrap gap-2">
        <el-button
          v-for="(label, index) in steps"
          :key="label"
          size="small"
          :type="step === index ? 'primary' : 'default'"
          :plain="step !== index"
          @click="step = index"
          >{{ index + 1 }}. {{ label }}</el-button
        >
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto pr-2">
        <el-form v-if="step === 0" label-position="top" class="max-w-[620px]">
          <el-form-item label="事件名称"
            ><el-input v-model="form.name" maxlength="100"
          /></el-form-item>
          <el-form-item v-if="form.eventType" label="事件唯一标识">
            <el-input :model-value="form.eventType" disabled />
          </el-form-item>
          <p v-else class="text-[12px] text-[var(--el-text-color-secondary)]">
            事件唯一标识由系统在首次保存时自动生成，后续调用接口使用此标识。
          </p>
          <el-form-item label="API Key 所属账号">
            <el-select
              v-model="form.apiKeyUserId"
              filterable
              class="w-full"
              placeholder="选择集成账号"
            >
              <el-option v-for="m in members" :key="m.id" :label="m.name" :value="m.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="状态"
            ><el-switch v-model="form.enabled" active-text="启用" inactive-text="停用"
          /></el-form-item>
        </el-form>
        <div v-else-if="step === 1" class="flex max-w-[650px] flex-col gap-3">
          <h3 class="m-0 text-base font-semibold">选择本次事件操作的 CRM 模块</h3>
          <el-alert
            v-if="upserting"
            title="缴费成功事件同时匹配客户和线索：命中客户则更新缴费状态，命中线索则直接转化为客户；均未命中时不创建客户。"
            type="success"
            :closable="false"
          />
          <el-radio-group
            v-else
            :model-value="flow.target"
            @change="changeTarget($event as 'lead' | 'customer')"
          >
            <el-radio-button value="lead">线索</el-radio-button>
            <el-radio-button value="customer">客户</el-radio-button>
          </el-radio-group>
        </div>
        <div v-else-if="step === 2" class="flex flex-col gap-3">
          <template v-if="upserting">
            <el-alert
              title="必须同时满足学生姓名和手机号才算匹配。客户和线索可分别选择手机号字段；查询均为精确匹配。均未命中时不创建客户，正式调用返回未匹配错误。"
              type="info"
              :closable="false"
            />
            <el-form label-position="top" class="grid max-w-[760px] grid-cols-2 gap-x-4">
              <el-form-item label="外部手机号参数">
                <el-input v-model="flow.identity!.phoneExternalKey" placeholder="例如 phone" />
              </el-form-item>
              <el-form-item label="客户手机号字段">
                <el-select v-model="flow.identity!.customerPhoneFieldKey" filterable class="w-full">
                  <el-option
                    v-for="field in customerPhoneFields"
                    :key="field.id"
                    :value="field.key"
                    :label="field.label + '（' + field.key + '）'"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="线索手机号字段">
                <el-select v-model="flow.identity!.leadPhoneFieldKey" filterable class="w-full">
                  <el-option
                    v-for="field in leadPhoneFields"
                    :key="field.id"
                    :value="field.key"
                    :label="field.label + '（' + field.key + '）'"
                  />
                </el-select>
              </el-form-item>
            </el-form>
            <el-alert
              title="学生姓名使用字段映射中配置的「学生姓名参数」；手机号和姓名必须同时一致。若同一身份同时命中独立客户和未转化线索，或任一模块匹配到多条记录，将拒绝处理并记录异常。"
              type="warning"
              :closable="false"
            />
          </template>
          <el-alert
            v-else-if="creating"
            title="创建记录不需要定位现有资源；可直接进入下一步。"
            type="info"
            :closable="false"
          />
          <template v-else>
            <el-alert
              title="仅在所选目标模块中执行 AND 精确匹配；必须唯一命中，否则拒绝执行。"
              type="info"
              :closable="false"
            />
            <div
              v-for="(m, index) in form.config.matches"
              :key="index"
              class="flex items-center gap-3 rounded-md border border-[var(--el-border-color-lighter)] p-3"
            >
              <el-input v-model="m.externalKey" class="!w-[225px]" placeholder="外部参数名" />
              <span>→</span>
              <el-select
                v-model="m.crmFieldKey"
                filterable
                class="flex-1"
                placeholder="目标模块字段"
              >
                <el-option label="内部 ID（id）" value="id" />
                <el-option
                  v-for="field in lookupFields"
                  :key="field.id"
                  :value="field.key"
                  :label="field.label + '（' + field.key + '）'"
                />
              </el-select>
              <el-button
                link
                type="danger"
                :disabled="form.config.matches.length <= 1"
                @click="form.config.matches.splice(index, 1)"
                ><Trash2 :size="16"
              /></el-button>
            </div>
            <el-button
              class="self-start"
              plain
              :disabled="form.config.matches.length >= 10"
              @click="addMatch"
            >
              <Plus :size="14" class="mr-1" />新增定位条件
            </el-button>
          </template>
        </div>
        <div v-else-if="step === 3" class="flex flex-col gap-3">
          <h3 class="m-0 text-base font-semibold">选择业务动作或流程</h3>
          <el-radio-group
            :model-value="flow.action"
            class="!flex flex-col !items-start gap-2"
            @change="changeAction($event as ExternalEventFlow['action'])"
          >
            <el-radio value="update"
              >更新当前{{ flow.target === 'lead' ? '线索' : '客户' }}的自定义字段</el-radio
            >
            <el-radio value="create">创建{{ flow.target === 'lead' ? '线索' : '客户' }}</el-radio>
            <el-radio v-if="flow.target === 'lead'" value="convert">转换线索为客户</el-radio>
            <el-radio value="upsertCustomer">缴费成功同步（客户更新 / 线索转客户）</el-radio>
          </el-radio-group>
          <el-alert
            v-if="upserting"
            type="success"
            :closable="false"
            title="流程包含两个业务分支：找到客户则更新缴费状态；没有客户但找到线索则直接转化为客户并写入缴费状态。两者都未命中时不创建客户。"
          />
          <el-alert
            v-else
            type="info"
            :closable="false"
            title="单动作模式保留兼容；需要根据查询结果执行不同动作时，选择「缴费成功同步」。"
          />
          <div
            v-if="upserting"
            class="max-w-[900px] rounded-lg bg-[var(--el-fill-color-lighter)] p-4"
          >
            <div class="flex justify-center">
              <div
                class="rounded-md border border-[var(--el-border-color)] bg-[var(--el-bg-color)] px-5 py-2 text-sm font-medium"
              >
                接收外部事件
              </div>
            </div>
            <div class="py-2 text-center text-[var(--el-text-color-secondary)]">↓</div>
            <div class="flex justify-center">
              <div
                class="rounded-md border border-[var(--el-color-primary-light-5)] bg-[var(--el-color-primary-light-9)] px-5 py-2 text-sm font-medium"
              >
                同时匹配客户与线索：学生姓名 + 手机号
              </div>
            </div>
            <div class="py-2 text-center text-[var(--el-text-color-secondary)]">
              ↙ 命中 / 未命中 ↘
            </div>
            <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div
                class="rounded-md border border-[var(--el-color-success-light-5)] bg-[var(--el-bg-color)] p-3"
              >
                <div class="mb-1 text-xs text-[var(--el-color-success)]">客户已存在</div>
                <div class="font-semibold">更新客户字段</div>
                <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
                  保留原负责人；完结规则命中时自动移出客户公海
                </div>
              </div>
              <div
                class="rounded-md border border-[var(--el-border-color)] bg-[var(--el-bg-color)] p-3"
              >
                <div class="mb-1 text-xs text-[var(--el-color-warning)]">客户未命中 · 线索命中</div>
                <div class="font-semibold">线索转化为客户</div>
                <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
                  迁移跟进资料并继承原负责人；无负责人时保持为空
                </div>
              </div>
              <div
                class="rounded-md border border-[var(--el-border-color)] bg-[var(--el-bg-color)] p-3"
              >
                <div class="mb-1 text-xs text-[var(--el-text-color-secondary)]">
                  客户、线索均未命中
                </div>
                <div class="font-semibold">不执行写入</div>
                <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
                  返回 PAYMENT_TARGET_NOT_FOUND，不创建客户
                </div>
              </div>
            </div>
            <div
              class="mt-3 rounded-md border border-dashed border-[var(--el-color-primary-light-5)] px-3 py-2 text-center text-xs text-[var(--el-text-color-secondary)]"
            >
              两个命中分支共用下方客户动态字段映射；选项字段支持外部值转换为 CRM 选项值
            </div>
            <el-alert
              class="mt-3"
              type="warning"
              :closable="false"
              title="正式执行所使用的 API Key 账号必须具有客户和线索全局数据范围；租户配置了客户公海或线索池时，还需相应的池查询权限。权限不足会拒绝执行，避免遗漏现有客户或线索。"
            />
          </div>
        </div>
        <div v-else-if="step === 4" class="flex flex-col gap-3">
          <el-alert
            type="info"
            :closable="false"
            :title="`目标字段实时读取${mappingModuleLabel}表单配置，仅展示当前动作允许写入的字段；名称、负责人及线索池使用各自专用配置。`"
          />
          <el-alert
            v-if="outdatedMappings.length"
            type="warning"
            :closable="false"
            title="有字段映射已不在当前表单可写范围内（可能被删除、隐藏或更改类型），请重新选择后保存。"
          />
          <el-form v-if="needsName" label-position="top" class="max-w-[440px]">
            <el-form-item
              :label="
                upserting
                  ? '学生姓名来自哪个外部参数（同时用于身份匹配）'
                  : '创建记录的名称来自哪个外部参数'
              "
            >
              <el-input v-model="flow.nameExternalKey" placeholder="例如 studentName" />
            </el-form-item>
          </el-form>
          <div
            v-for="(m, index) in flow.fields"
            :key="index"
            class="flex flex-col gap-3 rounded-md border border-[var(--el-border-color-lighter)] p-3"
          >
            <div class="flex flex-wrap items-center gap-2">
              <el-select v-model="m.source" class="!w-[148px]" @change="changeMappingSource(m)">
                <el-option label="外部事件参数" value="event" />
                <el-option
                  v-if="flow.action === 'convert' && !upserting"
                  label="原线索负责人"
                  value="leadOwner"
                />
              </el-select>
              <el-input
                v-if="m.source === 'event'"
                v-model="m.externalKey"
                class="!w-[185px]"
                :placeholder="
                  m.fieldKey === EXTERNAL_EVENT_LEAD_POOL_FIELD_KEY
                    ? '外部参数名，例如 pool'
                    : '外部参数名'
                "
              />
              <span v-else class="w-[185px] text-xs">Clue.owner</span>
              <span>→</span>
              <el-select
                v-model="m.fieldKey"
                filterable
                class="!min-w-[190px] flex-1"
                placeholder="目标字段"
                @change="changeMappingTarget(m)"
              >
                <el-option-group :label="`${mappingModuleLabel}表单字段`">
                  <el-option
                    v-for="f in writable.filter(
                      (x) => m.source !== 'leadOwner' || x.type === 'member',
                    )"
                    :key="f.id"
                    :value="f.key"
                    :label="f.label + (f.required ? '（必填）' : '') + '（' + f.key + '）'"
                  />
                </el-option-group>
                <el-option-group
                  v-if="creating && flow.target === 'lead' && m.source === 'event'"
                  label="线索池专用路由（非表单字段）"
                >
                  <el-option
                    label="线索池（负责人未匹配时分配）"
                    :value="EXTERNAL_EVENT_LEAD_POOL_FIELD_KEY"
                  />
                </el-option-group>
              </el-select>
              <el-select
                v-if="
                  m.source === 'event' &&
                  writable.find((f) => f.key === m.fieldKey)?.type === 'member'
                "
                v-model="m.provider"
                clearable
                class="!w-[160px]"
                placeholder="成员来源"
              >
                <el-option label="CRM" value="CRM" /><el-option label="企业微信" value="WECOM" />
                <el-option label="钉钉" value="DINGTALK" /><el-option label="飞书" value="LARK" />
              </el-select>
              <el-button link type="danger" @click="flow.fields.splice(index, 1)"
                ><Trash2 :size="16"
              /></el-button>
            </div>
            <div
              v-if="
                m.fieldKey === EXTERNAL_EVENT_LEAD_POOL_FIELD_KEY ||
                writable.find((field) => field.key === m.fieldKey)?.options?.length
              "
              class="rounded-md bg-[var(--el-fill-color-lighter)] p-3"
            >
              <div class="mb-2 text-xs font-medium">
                {{
                  m.fieldKey === EXTERNAL_EVENT_LEAD_POOL_FIELD_KEY
                    ? '线索池选项值映射（按外部参数选择）'
                    : '选项值映射（可选）'
                }}
              </div>
              <p
                v-if="m.fieldKey === EXTERNAL_EVENT_LEAD_POOL_FIELD_KEY"
                class="mb-2 text-xs text-[var(--el-text-color-secondary)]"
              >
                负责人匹配成功时仍分配给该成员；只有负责人无法匹配时，才使用这里映射的线索池。未配置负责人时，则直接按此映射选择线索池。所选线索池必须对
                API Key 所属账号可访问。
              </p>
              <div
                v-for="(valueMapping, mapIndex) in m.valueMap ?? []"
                :key="mapIndex"
                class="mb-2 grid grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)_24px] items-center gap-2"
              >
                <el-input
                  v-model="valueMapping.externalValue"
                  class="w-full min-w-0"
                  :placeholder="
                    m.fieldKey === EXTERNAL_EVENT_LEAD_POOL_FIELD_KEY
                      ? '外部值，例如 1'
                      : '外部值，例如 PAID'
                  "
                />
                <span class="text-center">→</span>
                <el-select
                  v-model="valueMapping.crmValue"
                  class="w-full min-w-0"
                  :placeholder="
                    m.fieldKey === EXTERNAL_EVENT_LEAD_POOL_FIELD_KEY ? '选择线索池' : 'CRM 选项值'
                  "
                >
                  <template v-if="m.fieldKey === EXTERNAL_EVENT_LEAD_POOL_FIELD_KEY">
                    <el-option
                      v-for="pool in leadPools"
                      :key="pool.id"
                      :value="pool.id"
                      :label="pool.name"
                    />
                  </template>
                  <template v-else>
                    <el-option
                      v-for="option in writable.find((field) => field.key === m.fieldKey)
                        ?.options ?? []"
                      :key="option.value"
                      :value="option.value"
                      :label="option.label + '（' + option.value + '）'"
                    />
                  </template>
                </el-select>
                <el-button
                  link
                  type="danger"
                  class="!m-0 justify-self-center"
                  @click="m.valueMap?.splice(mapIndex, 1)"
                >
                  <Trash2 :size="14" />
                </el-button>
              </div>
              <el-button
                link
                type="primary"
                @click="m.valueMap = [...(m.valueMap ?? []), { externalValue: '', crmValue: '' }]"
              >
                <Plus :size="13" class="mr-1" />新增选项值映射
              </el-button>
            </div>
          </div>
          <el-button
            plain
            class="self-start"
            :disabled="flow.fields.length >= 30"
            @click="addField"
          >
            <Plus :size="14" class="mr-1" />新增字段映射
          </el-button>
          <div
            v-if="flow.action === 'convert' || creating"
            class="rounded-md border border-[var(--el-border-color-lighter)] p-3"
          >
            <el-switch
              v-model="ownerEnabled"
              :active-text="
                creating && flow.target === 'lead'
                  ? '指定新记录负责人（无法匹配时进入线索池）'
                  : '指定新记录的负责人（否则使用默认负责人）'
              "
            />
            <div v-if="flow.owner" class="mt-3 flex flex-wrap gap-3">
              <el-input
                v-model="flow.owner.externalKey"
                class="!w-[230px]"
                placeholder="外部负责人参数名"
              />
              <el-select v-model="flow.owner.provider" class="!w-[180px]">
                <el-option label="CRM 成员 ID" value="CRM" /><el-option
                  label="企业微信 UserID"
                  value="WECOM"
                />
                <el-option label="钉钉成员标识" value="DINGTALK" /><el-option
                  label="飞书成员标识"
                  value="LARK"
                />
              </el-select>
            </div>
          </div>
        </div>
        <div v-else class="flex max-w-[740px] flex-col gap-3">
          <el-alert
            title="保存后可模拟定位与业务校验；模拟过程不写入数据。"
            type="warning"
            :closable="false"
          />
          <el-button plain class="self-start" @click="sample">根据映射生成示例参数</el-button>
          <el-input v-model="exampleText" type="textarea" :rows="10" />
          <el-button
            type="primary"
            class="self-start"
            :loading="busy"
            :disabled="!savedId"
            @click="preview"
            >模拟执行（不写入数据）</el-button
          >
          <el-descriptions v-if="previewResult" title="模拟执行结果" border :column="1">
            <el-descriptions-item label="匹配类型">{{
              previewResult.resolvedType || '未匹配'
            }}</el-descriptions-item>
            <el-descriptions-item label="资源 ID">{{
              previewResult.resolvedId || '无匹配记录'
            }}</el-descriptions-item>
            <el-descriptions-item label="动作">{{ previewResult.action }}</el-descriptions-item>
            <el-descriptions-item v-if="previewResult.leadPoolId" label="新线索归属">
              {{
                leadPools.find((pool) => pool.id === previewResult?.leadPoolId)?.name ??
                previewResult.leadPoolId
              }}
            </el-descriptions-item>
            <el-descriptions-item v-if="previewResult.systemFieldUpdates" label="线索系统字段">
              <pre class="m-0 whitespace-pre-wrap text-xs">{{
                JSON.stringify(previewResult.systemFieldUpdates, null, 2)
              }}</pre>
            </el-descriptions-item>
            <el-descriptions-item v-if="previewResult.releasedFromPool" label="公海处理">
              完结规则命中后移出客户公海
            </el-descriptions-item>
            <el-descriptions-item label="字段映射">
              <pre class="m-0 whitespace-pre-wrap text-xs">{{
                JSON.stringify(previewResult.fieldUpdates, null, 2)
              }}</pre>
            </el-descriptions-item>
          </el-descriptions>
        </div>
      </div>
      <footer
        class="mt-4 flex shrink-0 justify-end gap-2 border-t border-[var(--el-border-color-lighter)] pt-4"
      >
        <el-button @click="visible = false">取消</el-button>
        <el-button v-if="step > 0" @click="step--">上一步</el-button>
        <el-button v-if="step < 5" @click="step++">下一步</el-button>
        <el-button type="primary" :loading="busy" @click="save">保存配置</el-button>
      </footer>
    </div>
  </el-drawer>
</template>
