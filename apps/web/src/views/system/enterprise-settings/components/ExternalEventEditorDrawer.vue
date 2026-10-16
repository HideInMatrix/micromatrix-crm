<script setup lang="ts">
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
import { externalEventTemplateApi, type ExternalEventPreviewVO } from '@/api/external-events'
import { extractErrorMessage } from '@/api/http'

const visible = defineModel<boolean>({ required: true })
const props = defineProps<{ existing: ExternalEventTemplateVO | null; initialStep?: number }>()
const emit = defineEmits<{ saved: [] }>()
const steps = ['基本信息', '目标模块', '资源定位', '执行动作', '字段映射', '测试配置']
const step = ref(0)
const busy = ref(false)
const savedId = ref<string | null>(null)
const leadFields = ref<FieldVO[]>([])
const customerFields = ref<FieldVO[]>([])
const members = ref<MemberOption[]>([])
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
      flow: { target: 'lead', action: 'update', fields: [], owner: null },
    },
  }
}
const form = reactive<ExternalEventTemplateInput>(newForm())
const flow = computed(() => form.config.flow!)
const creating = computed(() => flow.value.action === 'create')
const targetFields = computed(() =>
  flow.value.target === 'lead' ? leadFields.value : customerFields.value,
)
const mappingFields = computed(() =>
  flow.value.action === 'convert' ? customerFields.value : targetFields.value,
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
  mappingFields.value.filter(
    (f) => !f.hidden && !f.system && !['formula', 'sub_product'].includes(f.type),
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
}
function addMatch() {
  form.config.matches.push({ externalKey: '', crmFieldKey: '' })
}
function addField() {
  flow.value.fields.push({ source: 'event', externalKey: '', fieldKey: '' })
}
function sample() {
  const data: Record<string, string> = {}
  if (!creating.value)
    for (const m of form.config.matches)
      if (m.externalKey)
        data[m.externalKey] = /phone/i.test(m.externalKey) ? '13800000000' : 'EXAMPLE_VALUE'
  for (const m of flow.value.fields)
    if (m.source === 'event' && m.externalKey) data[m.externalKey] = 'EXAMPLE_VALUE'
  if (creating.value && flow.value.nameExternalKey) data[flow.value.nameExternalKey] = '张三'
  if (flow.value.action === 'stage' && flow.value.stageExternalKey)
    data[flow.value.stageExternalKey] = 'STAGE_KEY'
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
  try {
    const [lead, customer, people] = await Promise.all([
      metadataApi.fields('lead'),
      metadataApi.fields('customer'),
      memberApi.options(),
    ])
    leadFields.value = lead.data
    customerFields.value = customer.data
    members.value = people.data
  } catch (e) {
    ElMessage.error(extractErrorMessage(e))
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
  if (flow.value.action === 'create' && !flow.value.nameExternalKey) {
    step.value = 4
    ElMessage.warning('请指定名称参数')
    return
  }
  if (flow.value.action === 'stage' && !flow.value.stageExternalKey) {
    step.value = 4
    ElMessage.warning('请指定状态参数')
    return
  }
  busy.value = true
  try {
    const payload = JSON.parse(JSON.stringify(form)) as ExternalEventTemplateInput
    if (creating.value) payload.config.matches = []
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
          <el-radio-group
            :model-value="flow.target"
            @change="changeTarget($event as 'lead' | 'customer')"
          >
            <el-radio-button value="lead">线索</el-radio-button>
            <el-radio-button value="customer">客户</el-radio-button>
          </el-radio-group>
        </div>
        <div v-else-if="step === 2" class="flex flex-col gap-3">
          <el-alert
            v-if="creating"
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
          <h3 class="m-0 text-base font-semibold">选择业务动作</h3>
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
            <el-radio v-if="flow.target === 'lead'" value="stage">更新线索状态</el-radio>
          </el-radio-group>
          <el-alert
            type="info"
            :closable="false"
            title="每个事件使用一个主动作；转化时可同时映射新客户字段和负责人，保证写入与事件日志处于同一事务。"
          />
        </div>
        <div v-else-if="step === 4" class="flex flex-col gap-3">
          <el-alert
            type="info"
            :closable="false"
            title="仅展示目标动作允许写入的字段；系统负责人使用单独的身份映射。"
          />
          <el-form
            v-if="creating || flow.action === 'stage'"
            label-position="top"
            class="max-w-[440px]"
          >
            <el-form-item v-if="creating" label="创建记录的名称来自哪个外部参数">
              <el-input v-model="flow.nameExternalKey" placeholder="例如 studentName" />
            </el-form-item>
            <el-form-item v-if="flow.action === 'stage'" label="线索阶段 Key 来自哪个外部参数">
              <el-input v-model="flow.stageExternalKey" placeholder="例如 stageKey" />
            </el-form-item>
          </el-form>
          <template v-if="flow.action !== 'stage'">
            <div
              v-for="(m, index) in flow.fields"
              :key="index"
              class="flex flex-wrap items-center gap-2 rounded-md border border-[var(--el-border-color-lighter)] p-3"
            >
              <el-select v-model="m.source" class="!w-[148px]" @change="m.externalKey = ''">
                <el-option label="外部事件参数" value="event" />
                <el-option
                  v-if="flow.action === 'convert'"
                  label="原线索负责人"
                  value="leadOwner"
                />
              </el-select>
              <el-input
                v-if="m.source === 'event'"
                v-model="m.externalKey"
                class="!w-[185px]"
                placeholder="外部参数名"
              />
              <span v-else class="w-[185px] text-xs">Clue.owner</span>
              <span>→</span>
              <el-select
                v-model="m.fieldKey"
                filterable
                class="!min-w-[190px] flex-1"
                placeholder="目标自定义字段"
              >
                <el-option
                  v-for="f in writable.filter(
                    (x) => m.source !== 'leadOwner' || x.type === 'member',
                  )"
                  :key="f.id"
                  :value="f.key"
                  :label="f.label + '（' + f.key + '）'"
                />
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
            <el-button
              plain
              class="self-start"
              :disabled="flow.fields.length >= 30"
              @click="addField"
            >
              <Plus :size="14" class="mr-1" />新增字段映射
            </el-button>
          </template>
          <div
            v-if="flow.action === 'convert' || creating"
            class="rounded-md border border-[var(--el-border-color-lighter)] p-3"
          >
            <el-switch
              v-model="ownerEnabled"
              active-text="指定新记录的负责人（否则使用默认负责人）"
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
              previewResult.resolvedType
            }}</el-descriptions-item>
            <el-descriptions-item label="资源 ID">{{
              previewResult.resolvedId || '新建时生成'
            }}</el-descriptions-item>
            <el-descriptions-item label="动作">{{ previewResult.action }}</el-descriptions-item>
            <el-descriptions-item label="负责人">{{
              previewResult.customerOwnerId || '默认负责人 / 不变'
            }}</el-descriptions-item>
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
