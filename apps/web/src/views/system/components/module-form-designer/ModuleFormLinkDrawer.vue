<script setup lang="ts">
import {
  isFormLinkFieldCompatible,
  type FieldVO,
  type FormLinkProp,
  type FormLinkScenario,
  type FormLinkScenarioKey,
  type ModuleKey,
} from '@micromatrix/shared'
import { computed, ref, watch } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import { isDraftField, type ModuleFormFieldDraft } from './types'

const visible = defineModel<boolean>({ required: true })

const props = defineProps<{
  targetFields: ModuleFormFieldDraft[]
  linkProp?: FormLinkProp
  sourceFormKey: ModuleKey
  sourceLabel: string
  scenarioKey: FormLinkScenarioKey
  scenarioLabel: string
  scenarioTip: string
}>()

const emit = defineEmits<{
  save: [sourceFormKey: string, scenarios: FormLinkScenario[]]
}>()

const loading = ref(false)
const sourceFields = ref<FieldVO[]>([])
const formModel = ref<FormLinkScenario>({ key: props.scenarioKey, linkFields: [] })

const savedTargetFields = computed(() =>
  props.targetFields.filter(
    (field) => !isDraftField(field) && !field.system && field.type !== 'formula',
  ),
)

const hasDraftTargetFields = computed(() => props.targetFields.some((field) => isDraftField(field)))

function cloneScenario(): FormLinkScenario {
  const existing = (props.linkProp?.[props.sourceFormKey] ?? []).find(
    (scenario) => scenario.key === props.scenarioKey,
  )
  return existing
    ? (JSON.parse(JSON.stringify(existing)) as FormLinkScenario)
    : { key: props.scenarioKey, linkFields: [] }
}

async function loadSourceFields() {
  loading.value = true
  try {
    const { data } = await metadataApi.formConfig(props.sourceFormKey)
    sourceFields.value = data.fields
    formModel.value = cloneScenario()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

watch(
  () => visible.value,
  (open) => {
    if (open) void loadSourceFields()
  },
)

function targetFieldById(id: string) {
  return savedTargetFields.value.find((field) => field.id === id)
}

function targetOptions(currentId: string) {
  const selected = new Set(
    formModel.value.linkFields.map((link) => link.current).filter((id) => id !== currentId),
  )
  return savedTargetFields.value.filter(
    (target) =>
      !selected.has(target.id) &&
      sourceFields.value.some((source) => isFormLinkFieldCompatible(target, source)),
  )
}

function sourceOptions(currentId: string) {
  const target = targetFieldById(currentId)
  if (!target) return []
  return sourceFields.value.filter((source) => isFormLinkFieldCompatible(target, source))
}

function targetFieldLabel(id: string) {
  return savedTargetFields.value.find((field) => field.id === id)?.label ?? '字段不存在'
}

function sourceFieldLabel(id: string) {
  return sourceFields.value.find((field) => field.id === id)?.label ?? '字段不存在'
}

function changeTarget(index: number) {
  const line = formModel.value.linkFields[index]
  if (line) line.link = ''
}

function addLink() {
  const incomplete = formModel.value.linkFields.some((line) => !line.current || !line.link)
  if (incomplete) {
    ElMessage.warning('请先完成当前字段映射')
    return
  }
  if (targetOptions('').length === 0) {
    ElMessage.warning('没有更多可配置的客户字段')
    return
  }
  formModel.value.linkFields.push({ current: '', link: '', enable: true })
}

function removeLink(index: number) {
  formModel.value.linkFields.splice(index, 1)
}

async function clearLinks() {
  const confirmed = await ElMessageBox.confirm(
    '清空后，线索转换为客户时将不再按此配置填充客户字段。确定清空？',
    '确定清空表单联动吗？',
    { type: 'warning' },
  ).catch(() => false)
  if (!confirmed) return
  formModel.value.linkFields = []
}

function save() {
  if (formModel.value.linkFields.some((line) => !line.current || !line.link)) {
    ElMessage.warning('请完整选择当前表单字段和线索字段')
    return
  }
  const targetIds = formModel.value.linkFields.map((line) => line.current)
  if (new Set(targetIds).size !== targetIds.length) {
    ElMessage.warning('同一个客户字段不能重复配置')
    return
  }
  const invalid = formModel.value.linkFields.some((line) => {
    const target = targetFieldById(line.current)
    const source = sourceFields.value.find((field) => field.id === line.link)
    return !target || !source || !isFormLinkFieldCompatible(target, source)
  })
  if (invalid) {
    ElMessage.warning('存在已删除或不兼容的字段，请重新选择')
    return
  }

  const scenarios = JSON.parse(
    JSON.stringify(props.linkProp?.[props.sourceFormKey] ?? []),
  ) as FormLinkScenario[]
  const index = scenarios.findIndex((scenario) => scenario.key === props.scenarioKey)
  const next = JSON.parse(JSON.stringify(formModel.value)) as FormLinkScenario
  if (index >= 0) scenarios[index] = next
  else scenarios.push(next)
  emit('save', props.sourceFormKey, scenarios)
  visible.value = false
}
</script>

<template>
  <el-drawer v-model="visible" :title="`${sourceLabel}表单联动设置`" size="800px" destroy-on-close>
    <div v-loading="loading" class="flex h-full min-h-0 flex-col">
      <div class="m-2 flex items-center gap-2">
        <el-tag type="primary" effect="plain">{{ scenarioLabel }}</el-tag>
        <el-tooltip :content="scenarioTip" placement="top">
          <span
            class="inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-[var(--el-border-color)] text-xs text-[var(--el-text-color-secondary)]"
          >
            ?
          </span>
        </el-tooltip>
      </div>

      <el-alert
        v-if="hasDraftTargetFields"
        class="mb-4"
        type="info"
        :closable="false"
        show-icon
        title="新增字段需先保存表单后，才能参与跨表单字段映射。"
      />

      <div
        class="min-h-0 flex-1 rounded-[var(--el-border-radius-base)] bg-[var(--el-fill-color-lighter)] p-4"
      >
        <div class="mb-3 grid grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)_84px_36px] gap-3 px-1 text-sm font-medium text-[var(--el-text-color-primary)]">
          <div>当前表单</div>
          <div></div>
          <div>联动表单</div>
          <div></div>
          <div></div>
        </div>

        <div class="max-h-[calc(100vh-310px)] space-y-3 overflow-y-auto pr-1">
          <div
            v-for="(line, index) in formModel.linkFields"
            :key="index"
            class="grid grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)_84px_36px] items-center gap-3"
          >
            <el-select
              v-model="line.current"
              filterable
              placeholder="选择客户字段"
              @change="changeTarget(index)"
            >
              <el-option
                v-if="line.current && !targetFieldById(line.current)"
                :label="targetFieldLabel(line.current)"
                :value="line.current"
                disabled
              />
              <el-option
                v-for="option in targetOptions(line.current)"
                :key="option.id"
                :label="option.label"
                :value="option.id"
              />
            </el-select>

            <div class="text-center text-sm text-[var(--el-text-color-secondary)]">填充 ←</div>

            <el-select v-model="line.link" filterable placeholder="选择线索字段">
              <el-option
                v-if="line.link && !sourceFields.some((field) => field.id === line.link)"
                :label="sourceFieldLabel(line.link)"
                :value="line.link"
                disabled
              />
              <el-option
                v-for="option in sourceOptions(line.current)"
                :key="option.id"
                :label="option.label"
                :value="option.id"
              />
            </el-select>

            <div class="flex items-center justify-center gap-2 text-sm text-[var(--el-text-color-secondary)]">
              <el-switch v-model="line.enable" />
              <span>的值</span>
            </div>

            <el-button v-if="formModel.linkFields.length > 1" link @click="removeLink(index)">
              −
            </el-button>
          </div>

          <el-empty
            v-if="formModel.linkFields.length === 0"
            :image-size="56"
            description="暂未配置字段联动"
          />
        </div>

        <el-button class="mt-4" link type="primary" @click="addLink">+ 添加联动</el-button>
      </div>
    </div>

    <template #footer>
      <div class="flex w-full items-center justify-between">
        <el-button @click="clearLinks">清空</el-button>
        <div class="flex gap-2">
          <el-button @click="visible = false">取消</el-button>
          <el-button type="primary" @click="save">保存</el-button>
        </div>
      </div>
    </template>
  </el-drawer>
</template>
