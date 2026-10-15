<script setup lang="ts">
import type {
  ExternalEventTemplateInput,
  ExternalEventTemplateVO,
  FieldVO,
  ExternalEventTemplateConfig,
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
const busy = ref(false)
const step = ref(0)
const steps = ['基本信息', '资源定位', '执行动作', '字段映射', '测试配置']
const leadFields = ref<FieldVO[]>([])
const customerFields = ref<FieldVO[]>([])
const members = ref<MemberOption[]>([])
const exampleText = ref('{}')
const previewResult = ref<ExternalEventPreviewVO | null>(null)
const savedId = ref<string | null>(null)

function newForm(): ExternalEventTemplateInput {
  return {
    name: '',
    eventType: '',
    source: '',
    apiKeyUserId: '',
    enabled: false,
    config: {
      actions: { convertLead: true, updateCustomer: true },
      matches: [{ externalKey: 'phone', crmFieldKey: 'phone' }],
      fields: [],
      owner: null,
    },
  }
}
const form = reactive<ExternalEventTemplateInput>(newForm())
const externalOwner = computed({
  get: () => form.config.owner !== null,
  set: (value: boolean) => {
    form.config.owner = value ? { externalKey: 'receptionistUserId', provider: 'WECOM' } : null
  },
})
const matchFields = computed(() => {
  const seen = new Set<string>()
  return [...leadFields.value, ...customerFields.value]
    .filter(
      (f) =>
        !f.hidden &&
        (f.key === 'id' ||
          ['text', 'phone', 'email', 'number', 'select', 'member', 'date', 'datetime'].includes(
            f.type,
          )),
    )
    .filter((f) => {
      if (seen.has(f.key)) return false
      seen.add(f.key)
      return true
    })
})
const customerWritable = computed(() =>
  customerFields.value.filter(
    (f) => !f.hidden && !f.system && !['formula', 'sub_product'].includes(f.type),
  ),
)

function sample() {
  const data: Record<string, string> = {}
  for (const item of form.config.matches)
    if (item.externalKey)
      data[item.externalKey] = item.externalKey.toLowerCase().includes('phone')
        ? '13800000000'
        : '张三'
  for (const item of form.config.fields)
    if (item.source === 'event' && item.externalKey) data[item.externalKey] = '示例值'
  if (form.config.owner?.externalKey)
    data[form.config.owner.externalKey] =
      form.config.owner.provider === 'CRM' ? 'CRM_MEMBER_ID' : 'EXTERNAL_USER_ID'
  exampleText.value = JSON.stringify(data, null, 2)
}
watch(visible, async (open) => {
  if (!open) return
  step.value =
    props.existing && Number.isInteger(props.initialStep)
      ? Math.min(4, Math.max(0, props.initialStep ?? 0))
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
  sample()
  try {
    const [lead, customer, people] = await Promise.all([
      metadataApi.fields('lead'),
      metadataApi.fields('customer'),
      memberApi.options(),
    ])
    leadFields.value = lead.data
    customerFields.value = customer.data
    members.value = people.data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
})

async function save() {
  if (!form.name.trim() || !form.eventType.trim() || !form.source.trim() || !form.apiKeyUserId) {
    ElMessage.warning('请完善事件名称、标识、来源和授权账号')
    step.value = 0
    return
  }
  if (
    !form.config.matches.length ||
    form.config.matches.some((x) => !x.externalKey || !x.crmFieldKey)
  ) {
    ElMessage.warning('请配置有效的资源定位字段')
    step.value = 1
    return
  }
  busy.value = true
  try {
    const payload = JSON.parse(JSON.stringify(form)) as ExternalEventTemplateInput
    const result = savedId.value
      ? await externalEventTemplateApi.update(savedId.value, payload)
      : await externalEventTemplateApi.create(payload)
    savedId.value = result.data.id
    ElMessage.success('事件配置已保存')
    emit('saved')
    if (step.value !== 4) visible.value = false
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    busy.value = false
  }
}
async function preview() {
  if (!savedId.value) {
    ElMessage.warning('请先保存配置，然后进行模拟测试')
    return
  }
  let data: Record<string, unknown>
  try {
    data = JSON.parse(exampleText.value) as Record<string, unknown>
    if (!data || Array.isArray(data) || typeof data !== 'object')
      throw new Error('参数必须是 JSON 对象')
  } catch {
    ElMessage.warning('请输入有效的 JSON 参数对象')
    return
  }
  busy.value = true
  try {
    previewResult.value = (await externalEventTemplateApi.preview(savedId.value, data)).data
  } catch (error) {
    previewResult.value = null
    ElMessage.error(extractErrorMessage(error))
  } finally {
    busy.value = false
  }
}
function addMatch() {
  form.config.matches.push({ externalKey: '', crmFieldKey: '' })
}
function addField() {
  form.config.fields.push({ source: 'event', externalKey: '', customerFieldKey: '' })
}
function removeMatch(i: number) {
  form.config.matches.splice(i, 1)
}
function removeField(i: number) {
  form.config.fields.splice(i, 1)
}
function changeSource(item: ExternalEventTemplateConfig['fields'][number]) {
  if (item.source === 'leadOwner') {
    item.externalKey = ''
    delete item.provider
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
        <div v-if="step === 0" class="max-w-[620px]">
          <el-alert
            title="API Key 仍使用现有个人中心创建的密钥；每条事件配置绑定一个 CRM 集成账号。"
            type="info"
            :closable="false"
            class="mb-4"
          />
          <el-form label-position="top">
            <el-form-item label="事件名称"
              ><el-input v-model="form.name" maxlength="100" placeholder="例如：接待完成"
            /></el-form-item>
            <el-form-item label="事件标识"
              ><el-input
                v-model="form.eventType"
                :disabled="Boolean(props.existing)"
                maxlength="80"
                placeholder="RECEPTION_COMPLETED"
              />
              <div class="text-xs text-[var(--el-text-color-secondary)]">
                唯一标识保存后不可修改，建议使用大写字母与下划线。
              </div></el-form-item
            >
            <el-form-item label="调用来源"
              ><el-input v-model="form.source" maxlength="80" placeholder="reception-system"
            /></el-form-item>
            <el-form-item label="API Key 所属账号"
              ><el-select
                v-model="form.apiKeyUserId"
                filterable
                placeholder="选择集成账号"
                class="w-full"
                ><el-option
                  v-for="person in members"
                  :key="person.id"
                  :label="`${person.name} (${person.id})`"
                  :value="person.id" /></el-select
            ></el-form-item>
            <el-form-item label="状态"
              ><el-switch v-model="form.enabled" active-text="启用" inactive-text="停用"
            /></el-form-item>
          </el-form>
        </div>
        <div v-else-if="step === 1" class="flex flex-col gap-3">
          <el-alert
            title="定位采用 AND 精确匹配：必须唯一命中客户或线索，否则拒绝执行。默认优先匹配已有客户。"
            type="info"
            :closable="false"
          />
          <div
            v-for="(mapping, index) in form.config.matches"
            :key="index"
            class="flex items-center gap-3 rounded-md border border-[var(--el-border-color-lighter)] p-3"
          >
            <el-input
              v-model="mapping.externalKey"
              placeholder="外部参数名，如 phone"
              class="!w-[240px]"
            />
            <span class="shrink-0 text-[var(--el-text-color-secondary)]">匹配</span>
            <el-select
              v-model="mapping.crmFieldKey"
              filterable
              class="flex-1"
              placeholder="选择 CRM 线索/客户字段"
            >
              <el-option
                v-for="field in matchFields"
                :key="field.key"
                :label="`${field.label}（${field.key}）`"
                :value="field.key"
              />
            </el-select>
            <el-button
              link
              type="danger"
              :disabled="form.config.matches.length <= 1"
              @click="removeMatch(index)"
              ><Trash2 :size="16"
            /></el-button>
          </div>
          <el-button
            class="self-start"
            plain
            :disabled="form.config.matches.length >= 10"
            @click="addMatch"
            ><Plus :size="14" class="mr-1" />增加定位条件</el-button
          >
        </div>
        <div v-else-if="step === 2" class="flex max-w-[680px] flex-col gap-4">
          <h3 class="m-0 text-base font-semibold">系统预置业务动作</h3>
          <div class="rounded-md border border-[var(--el-border-color-lighter)] p-4">
            <el-checkbox
              v-model="form.config.actions.convertLead"
              label="匹配到线索时：转换为客户"
            />
            <div class="pl-6 text-[12px] text-[var(--el-text-color-secondary)]">
              复制关联跟进历史，并按客户表单映射创建客户；禁用则跳过该线索。
            </div>
          </div>
          <div class="rounded-md border border-[var(--el-border-color-lighter)] p-4">
            <el-checkbox
              v-model="form.config.actions.updateCustomer"
              label="匹配到已有客户时：更新客户字段"
            />
            <div class="pl-6 text-[12px] text-[var(--el-text-color-secondary)]">
              不自动变更已有客户的系统负责人；需要负责人转移时请使用单独业务操作。
            </div>
          </div>
          <div class="rounded-md border border-[var(--el-border-color-lighter)] p-4">
            <el-switch
              v-model="externalOwner"
              :disabled="!form.config.actions.convertLead"
              active-text="转换时指定客户负责人（Customer.owner）"
            />
            <div v-if="form.config.owner" class="mt-3 flex flex-wrap gap-3">
              <el-input
                v-model="form.config.owner.externalKey"
                class="!w-[250px]"
                placeholder="外部负责人参数，如 receptionistUserId"
              />
              <el-select v-model="form.config.owner.provider" class="!w-[190px]">
                <el-option label="CRM 成员 ID" value="CRM" />
                <el-option label="企业微信 UserID" value="WECOM" />
                <el-option label="钉钉成员标识" value="DINGTALK" />
                <el-option label="飞书成员标识" value="LARK" />
              </el-select>
            </div>
            <p class="mt-3 mb-0 text-[12px] text-[var(--el-text-color-secondary)]">
              未启用时新客户继承线索负责人 A；启用后指定 B 为新客户负责人，原线索负责人仍保留。
            </p>
          </div>
        </div>
        <div v-else-if="step === 3" class="flex flex-col gap-3">
          <el-alert
            title="仅可映射可写客户自定义字段；系统客户负责人请在上一步配置。原线索负责人可作为邀请人写入成员型字段。"
            type="info"
            :closable="false"
          />
          <div
            v-for="(mapping, index) in form.config.fields"
            :key="index"
            class="flex flex-wrap items-center gap-2 rounded-md border border-[var(--el-border-color-lighter)] p-3"
          >
            <el-select v-model="mapping.source" class="!w-[150px]" @change="changeSource(mapping)"
              ><el-option label="外部事件参数" value="event" /><el-option
                label="原线索负责人"
                value="leadOwner"
            /></el-select>
            <el-input
              v-if="mapping.source === 'event'"
              v-model="mapping.externalKey"
              class="!w-[185px]"
              placeholder="外部字段名"
            />
            <span v-else class="w-[185px] text-xs text-[var(--el-text-color-secondary)]"
              >Clue.owner</span
            >
            <span class="text-[var(--el-text-color-secondary)]">→</span>
            <el-select
              v-model="mapping.customerFieldKey"
              class="!min-w-[195px] flex-1"
              filterable
              placeholder="选择客户自定义字段"
            >
              <el-option
                v-for="field in customerWritable.filter(
                  (f) => mapping.source !== 'leadOwner' || f.type === 'member',
                )"
                :key="field.id"
                :label="`${field.label}（${field.key}）`"
                :value="field.key"
              />
            </el-select>
            <el-select
              v-if="
                mapping.source === 'event' &&
                customerWritable.find((field) => field.key === mapping.customerFieldKey)?.type ===
                  'member'
              "
              v-model="mapping.provider"
              clearable
              class="!w-[170px]"
              placeholder="自动识别成员来源"
            >
              <el-option label="CRM 成员 ID" value="CRM" />
              <el-option label="企业微信 UserID" value="WECOM" />
              <el-option label="钉钉成员标识" value="DINGTALK" />
              <el-option label="飞书成员标识" value="LARK" />
            </el-select>
            <el-button link type="danger" @click="removeField(index)"
              ><Trash2 :size="16"
            /></el-button>
          </div>
          <el-button
            plain
            class="self-start"
            :disabled="form.config.fields.length >= 30"
            @click="addField"
            ><Plus :size="14" class="mr-1" />增加字段映射</el-button
          >
          <el-empty
            v-if="!form.config.fields.length"
            description="没有额外字段映射。转换仍会自动保留原有线索的表单关联信息。"
          />
        </div>
        <div v-else class="flex max-w-[740px] flex-col gap-3">
          <el-alert
            title="模拟执行仅读取数据并校验定位与映射，不会创建客户或修改负责人。保存配置后可进行模拟。"
            type="warning"
            :closable="false"
          />
          <el-button plain class="self-start" @click="sample">根据映射生成示例参数</el-button>
          <el-input
            v-model="exampleText"
            type="textarea"
            :rows="12"
            placeholder="输入 JSON 事件参数"
          />
          <el-button
            type="primary"
            class="self-start"
            :loading="busy"
            :disabled="!savedId"
            @click="preview"
            >模拟执行（不写入数据）</el-button
          >
          <el-empty v-if="!savedId" description="请先保存配置，然后使用模拟测试" :image-size="65" />
          <el-descriptions v-if="previewResult" title="模拟执行结果" border :column="1">
            <el-descriptions-item label="匹配类型">{{
              previewResult.resolvedType
            }}</el-descriptions-item>
            <el-descriptions-item label="匹配资源 ID">{{
              previewResult.resolvedId
            }}</el-descriptions-item>
            <el-descriptions-item label="动作">{{ previewResult.action }}</el-descriptions-item>
            <el-descriptions-item label="新客户负责人">{{
              previewResult.customerOwnerId || '继承原线索负责人 / 保持不变'
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
        <el-button v-if="step < 4" @click="step++">下一步</el-button>
        <el-button type="primary" :loading="busy" @click="save">保存配置</el-button>
      </footer>
    </div>
  </el-drawer>
</template>
