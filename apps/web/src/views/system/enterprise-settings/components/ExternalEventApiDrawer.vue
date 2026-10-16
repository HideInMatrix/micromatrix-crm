<script setup lang="ts">
import type { ExternalEventTemplateVO } from '@micromatrix/shared'
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Copy } from 'lucide-vue-next'
import { externalEventTemplateApi, type ExternalEventPreviewVO } from '@/api/external-events'
import { extractErrorMessage } from '@/api/http'
import { useAuthStore } from '@/stores/auth'

const visible = defineModel<boolean>({ required: true })
const props = defineProps<{ template: ExternalEventTemplateVO | null }>()
const auth = useAuthStore()
const activeTab = ref('docs')
const language = ref<'curl' | 'javascript' | 'python'>('curl')
const debugText = ref('{}')
const preview = ref<ExternalEventPreviewVO | null>(null)
const loading = ref(false)
const canPreview = computed(() => auth.hasPerm('system:setting:update'))
const baseUrl = computed(() => `${window.location.origin}/api/external-events/execute`)

const sampleData = computed(() => {
  const data: Record<string, string> = {}
  const flow = props.template?.config.flow
  for (const mapping of flow?.action === 'create' ? [] : (props.template?.config.matches ?? [])) {
    const key = mapping.externalKey
    if (key)
      data[key] = /phone|mobile/i.test(key)
        ? '13800000000'
        : /name/i.test(key)
          ? '张三'
          : 'EXAMPLE_VALUE'
  }
  for (const mapping of flow?.fields ?? props.template?.config.fields ?? []) {
    if (mapping.source === 'event' && mapping.externalKey && !(mapping.externalKey in data))
      data[mapping.externalKey] = 'EXAMPLE_VALUE'
  }
  if (flow?.action === 'create' && flow.nameExternalKey) data[flow.nameExternalKey] = '张三'
  if (flow?.action === 'stage' && flow.stageExternalKey) data[flow.stageExternalKey] = 'STAGE_KEY'
  const owner = flow ? flow.owner : props.template?.config.owner
  if (owner)
    data[owner.externalKey] = owner.provider === 'CRM' ? 'CRM_MEMBER_ID' : 'EXTERNAL_USER_ID'
  return data
})
const examplePayload = computed(() => ({
  eventType: props.template?.eventType ?? '',
  data: sampleData.value,
}))
const json = computed(() => JSON.stringify(examplePayload.value, null, 2))
const code = computed(() => {
  if (language.value === 'curl') {
    const body = JSON.stringify(examplePayload.value)
    return `curl -X POST '${baseUrl.value}' \\\n  -H 'Content-Type: application/json' \\\n  -H 'X-Access-Key: YOUR_ACCESS_KEY' \\\n  -H 'X-Secret-Key: YOUR_SECRET_KEY' \\\n  -d '${body.replaceAll("'", "'\\''")}'`
  }
  if (language.value === 'javascript') {
    return `const response = await fetch('${baseUrl.value}', {\n  method: 'POST',\n  headers: {\n    'Content-Type': 'application/json',\n    'X-Access-Key': process.env.CRM_ACCESS_KEY,\n    'X-Secret-Key': process.env.CRM_SECRET_KEY,\n  },\n  body: JSON.stringify(${json.value}),\n});\nconst result = await response.json();`
  }
  return `import os\nimport requests\n\nresponse = requests.post(\n    '${baseUrl.value}',\n    headers={\n        'X-Access-Key': os.environ['CRM_ACCESS_KEY'],\n        'X-Secret-Key': os.environ['CRM_SECRET_KEY'],\n    },\n    json=${JSON.stringify(
    examplePayload.value,
    null,
    2,
  )
    .replace(/\bnull\b/g, 'None')
    .replace(/\btrue\b/g, 'True')
    .replace(
      /\bfalse\b/g,
      'False',
    )},\n    timeout=15,\n)\nresponse.raise_for_status()\nprint(response.json())`
})
const sortedFields = computed(() => [
  ...new Set([
    ...(props.template?.config.flow?.action === 'create'
      ? []
      : (props.template?.config.matches.map((x) => x.externalKey) ?? [])),
    ...(props.template?.config.flow?.fields ?? props.template?.config.fields ?? [])
      .filter((x) => x.source === 'event')
      .map((x) => x.externalKey),
    ...(props.template?.config.flow?.nameExternalKey
      ? [props.template.config.flow.nameExternalKey]
      : []),
    ...(props.template?.config.flow?.stageExternalKey
      ? [props.template.config.flow.stageExternalKey]
      : []),
    ...(props.template?.config.flow?.owner
      ? [props.template.config.flow.owner.externalKey]
      : props.template?.config.flow
        ? []
        : props.template?.config.owner
          ? [props.template.config.owner.externalKey]
          : []),
  ]),
])
watch(visible, (open) => {
  if (!open) return
  activeTab.value = 'docs'
  debugText.value = JSON.stringify(sampleData.value, null, 2)
  preview.value = null
})
async function copy(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    ElMessage.success('已复制')
  } catch {
    ElMessage.error('复制失败，请手动选择文本复制')
  }
}
async function simulate() {
  if (!props.template) return
  let data: Record<string, unknown>
  try {
    data = JSON.parse(debugText.value) as Record<string, unknown>
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid')
  } catch {
    ElMessage.error('调试参数必须是 JSON 对象')
    return
  }
  loading.value = true
  try {
    preview.value = (await externalEventTemplateApi.preview(props.template.id, data)).data
  } catch (error) {
    preview.value = null
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <el-drawer
    v-model="visible"
    :title="`${template?.name ?? '外部事件'} · API 文档`"
    size="min(960px, 94vw)"
    destroy-on-close
  >
    <template v-if="template">
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <el-tag :type="template.enabled ? 'success' : 'info'">{{
          template.enabled ? '已启用' : '未启用'
        }}</el-tag>
        <span class="text-sm text-[var(--el-text-color-secondary)]"
          >{{ template.eventType }} · 配置版本 v{{ template.version }}</span
        >
      </div>
      <el-tabs v-model="activeTab">
        <el-tab-pane name="docs" label="调用说明">
          <div class="flex max-h-[calc(100dvh-210px)] flex-col gap-5 overflow-y-auto pr-2">
            <section>
              <h3 class="mb-2 text-sm font-semibold">接口地址</h3>
              <div class="flex flex-wrap items-center gap-2">
                <el-tag type="success">POST</el-tag>
                <code
                  class="min-w-0 flex-1 break-all rounded bg-[var(--el-fill-color-lighter)] px-3 py-2 text-xs"
                  >{{ baseUrl }}</code
                >
                <el-button size="small" @click="copy(baseUrl)"
                  ><Copy :size="13" class="mr-1" />复制</el-button
                >
              </div>
            </section>
            <section>
              <h3 class="mb-2 text-sm font-semibold">身份认证</h3>
              <div class="text-sm">
                请求头携带
                <code>X-Access-Key</code>、<code>X-Secret-Key</code>；必须使用配置绑定账号的 API
                Key。
              </div>
              <div class="mt-2 text-xs text-[var(--el-text-color-secondary)]">
                密钥在「个人中心 → API Key」申请和管理。本页面不展示或储存 Secret Key。
              </div>
            </section>
            <section>
              <h3 class="mb-2 text-sm font-semibold">业务规则</h3>
              <template v-if="template.config.flow">
                <p class="text-sm">
                  目标模块：{{ template.config.flow.target === 'lead' ? '线索' : '客户' }}；
                  业务动作：{{
                    {
                      update: '更新自定义字段',
                      create: '创建记录',
                      convert: '线索转客户',
                      stage: '更新线索状态',
                    }[template.config.flow.action]
                  }}。
                </p>
                <p class="text-sm">
                  {{
                    template.config.flow.action === 'create'
                      ? '本动作无需匹配现有资源'
                      : '定位条件在目标模块内执行 AND 精确匹配，必须唯一命中'
                  }}； 参数与动作均由管理员预先配置，调用方不能任意指定操作。
                </p>
              </template>
              <template v-else>
                <p class="text-sm">
                  匹配字段按 AND 精确查询，唯一命中时：{{
                    template.config.actions.convertLead ? '线索转客户' : '线索跳过'
                  }}；{{
                    template.config.actions.updateCustomer
                      ? '已有客户更新动态字段'
                      : '已有客户跳过'
                  }}。
                </p>
                <p class="text-sm">
                  {{
                    template.config.owner
                      ? `新建客户负责人从 data.${template.config.owner.externalKey} 解析（${template.config.owner.provider}）`
                      : '新建客户默认继承原线索负责人'
                  }}。已有客户负责人保持不变。
                </p>
              </template>
              <p class="text-xs text-[var(--el-text-color-secondary)]">
                新创建事件的 eventType 由 CRM
                自动生成并保持不变；历史事件沿用原标识。调用方只需使用此处的 eventType
                和业务参数，无需传入调用来源。externalEventId
                是可选的请求幂等编号，由服务端自动生成；外部系统需要安全重试时，可为同一业务事件提供稳定编号。
              </p>
            </section>
            <section>
              <h3 class="mb-2 text-sm font-semibold">必填参数</h3>
              <el-table
                :data="[
                  {
                    key: 'eventType',
                    meaning: 'CRM 自动生成的事件唯一标识：' + template.eventType,
                  },
                  ...sortedFields.map((key) => ({
                    key: `data.${key}`,
                    meaning: '由管理员配置的外部参数',
                  })),
                ]"
                size="small"
                border
              >
                <el-table-column prop="key" label="字段" min-width="210" />
                <el-table-column prop="meaning" label="说明" min-width="280" />
              </el-table>
            </section>
            <section>
              <div class="mb-2 flex items-center justify-between">
                <h3 class="m-0 text-sm font-semibold">请求 JSON</h3>
                <el-button link type="primary" @click="copy(json)">复制 JSON</el-button>
              </div>
              <pre
                class="m-0 overflow-x-auto rounded-md bg-[var(--el-fill-color-light)] p-4 text-xs leading-5"
                >{{ json }}</pre>
              <p class="mt-2 text-xs text-[var(--el-text-color-secondary)]">
                如需对同一次业务事件安全重试，可由接入系统在请求体中额外传入稳定的
                externalEventId；正常新请求无需填写。
              </p>
            </section>
            <section>
              <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 class="m-0 text-sm font-semibold">调用示例</h3>
                <el-button link type="primary" @click="copy(code)"
                  ><Copy :size="13" class="mr-1" />复制代码</el-button
                >
              </div>
              <el-radio-group v-model="language" size="small" class="mb-3"
                ><el-radio-button value="curl">cURL</el-radio-button
                ><el-radio-button value="javascript">JavaScript</el-radio-button
                ><el-radio-button value="python">Python</el-radio-button></el-radio-group
              >
              <pre
                class="m-0 overflow-x-auto whitespace-pre rounded-md bg-[var(--el-fill-color-light)] p-4 text-xs leading-5"
                >{{ code }}</pre>
            </section>
          </div>
        </el-tab-pane>
        <el-tab-pane name="debug" label="在线调试">
          <el-alert
            type="warning"
            title="这里执行只读模拟，不会创建客户或修改客户负责人。真实调用请使用 API Key。"
            :closable="false"
            class="mb-4"
          />
          <el-input
            v-model="debugText"
            type="textarea"
            :rows="11"
            placeholder="输入事件 data 参数 JSON"
          />
          <el-button
            v-if="canPreview"
            type="primary"
            :loading="loading"
            class="mt-3"
            @click="simulate"
            >模拟执行</el-button
          >
          <el-alert
            v-if="preview"
            type="success"
            :closable="false"
            class="mt-4"
            :title="`匹配成功：${preview.resolvedType} / ${preview.resolvedId}`"
            :description="`${preview.action}；新客户负责人：${preview.customerOwnerId ?? '默认继承'}`"
          />
        </el-tab-pane>
      </el-tabs>
    </template>
  </el-drawer>
</template>
