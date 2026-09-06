<script setup lang="ts">
import type {
  FieldConfig,
  FieldLinkOption,
  FieldOption,
  FieldType,
  FieldVO,
} from '@micromatrix/shared'
import { computed } from 'vue'

const props = defineProps<{
  fieldType: FieldType
  fieldOptions: FieldOption[]
  fields: FieldVO[]
  currentFieldId?: string
}>()

const config = defineModel<FieldConfig>({ required: true })

const canShowControl = computed(() =>
  ['select', 'multiselect', 'radio', 'checkbox'].includes(props.fieldType),
)
const canLink = computed(() => ['select', 'multiselect'].includes(props.fieldType))
const targetFields = computed(() =>
  props.fields.filter(
    (field) => !field.system && !field.hidden && field.id !== props.currentFieldId,
  ),
)
const linkTargetFields = computed(() =>
  targetFields.value.filter((field) => ['select', 'multiselect'].includes(field.type)),
)
const linkTarget = computed(() =>
  linkTargetFields.value.find((field) => field.id === config.value.linkProp?.targetField),
)

function addShowRule() {
  const rules = [...(config.value.showControlRules ?? [])]
  rules.push({ value: props.fieldOptions[0]?.value ?? '', fieldIds: [] })
  config.value.showControlRules = rules
}

function removeShowRule(index: number) {
  const rules = [...(config.value.showControlRules ?? [])]
  rules.splice(index, 1)
  config.value.showControlRules = rules.length ? rules : undefined
}

function enableLink() {
  const target = linkTargetFields.value[0]
  if (!target) return
  config.value.linkProp = {
    targetField: target.id,
    linkOptions: [defaultLinkOption(target)],
  }
}

function clearLink() {
  config.value.linkProp = undefined
}

function defaultCurrent(): string | string[] {
  const value = props.fieldOptions[0]?.value ?? ''
  return props.fieldType === 'multiselect' ? (value ? [value] : []) : value
}

function defaultTarget(
  field: FieldVO,
  method: FieldLinkOption['method'] = 'AUTO',
): string | string[] {
  const value = field.options?.[0]?.value ?? ''
  if (method === 'HIDDEN' || field.type === 'multiselect') return value ? [value] : []
  return value
}

function defaultLinkOption(target: FieldVO): FieldLinkOption {
  return {
    current: defaultCurrent(),
    method: 'AUTO',
    target: defaultTarget(target),
  }
}

function changeLinkTarget(targetId: string) {
  if (!config.value.linkProp) return
  const target = linkTargetFields.value.find((field) => field.id === targetId)
  config.value.linkProp.targetField = targetId
  config.value.linkProp.linkOptions = target ? [defaultLinkOption(target)] : []
}

function addLinkOption() {
  if (!config.value.linkProp || !linkTarget.value) return
  config.value.linkProp.linkOptions.push(defaultLinkOption(linkTarget.value))
}

function removeLinkOption(index: number) {
  const linkProp = config.value.linkProp
  if (!linkProp) return
  linkProp.linkOptions.splice(index, 1)
  if (!linkProp.linkOptions.length && linkTarget.value) {
    linkProp.linkOptions.push(defaultLinkOption(linkTarget.value))
  }
}

function changeMethod(option: FieldLinkOption, method: FieldLinkOption['method']) {
  option.method = method
  if (linkTarget.value) option.target = defaultTarget(linkTarget.value, method)
}

function updateCurrent(option: FieldLinkOption, value: string | string[]) {
  option.current = value
}

function updateTarget(option: FieldLinkOption, value: string | string[]) {
  option.target = value
}
</script>

<template>
  <div v-if="canShowControl" class="mb-4 rounded-2 border border-[var(--el-border-color)] p-3">
    <div class="mb-3 flex items-start justify-between gap-3">
      <div>
        <div class="text-sm font-600">字段显隐</div>
        <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
          当前字段命中任一规则时显示目标字段；多个控制字段之间按 OR 语义计算。
        </div>
      </div>
      <el-button plain type="primary" @click="addShowRule">添加规则</el-button>
    </div>

    <div
      v-if="!config.showControlRules?.length"
      class="py-3 text-center text-sm text-[var(--el-text-color-secondary)]"
    >
      未配置显隐规则
    </div>
    <div
      v-for="(rule, index) in config.showControlRules ?? []"
      :key="index"
      class="mb-2 grid grid-cols-[180px_1fr_60px] items-start gap-2 last:mb-0"
    >
      <el-select v-model="rule.value" placeholder="触发值" class="w-full">
        <el-option
          v-for="option in fieldOptions"
          :key="option.value"
          :label="option.label"
          :value="option.value"
        />
      </el-select>
      <el-select
        v-model="rule.fieldIds"
        multiple
        filterable
        placeholder="选择显示字段"
        class="w-full"
      >
        <el-option
          v-for="field in targetFields"
          :key="field.id"
          :label="field.label"
          :value="field.id"
        />
      </el-select>
      <el-button text type="danger" @click="removeShowRule(index)">删除</el-button>
    </div>
  </div>

  <div v-if="canLink" class="mb-4 rounded-2 border border-[var(--el-border-color)] p-3">
    <div class="mb-3 flex items-start justify-between gap-3">
      <div>
        <div class="text-sm font-600">字段联动</div>
        <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
          AUTO 自动赋值；范围限制只约束目标字段可选项，不会隐藏目标字段。
        </div>
      </div>
      <el-button
        v-if="!config.linkProp"
        plain
        type="primary"
        :disabled="!linkTargetFields.length"
        @click="enableLink"
      >
        配置联动
      </el-button>
      <el-button v-else text type="danger" @click="clearLink">清除联动</el-button>
    </div>

    <template v-if="config.linkProp">
      <div class="mb-3 grid grid-cols-[120px_1fr] items-center gap-2">
        <span class="text-sm text-[var(--el-text-color-regular)]">目标字段</span>
        <el-select
          :model-value="config.linkProp.targetField"
          class="w-full"
          @update:model-value="changeLinkTarget"
        >
          <el-option
            v-for="field in linkTargetFields"
            :key="field.id"
            :label="field.label"
            :value="field.id"
          />
        </el-select>
      </div>

      <div
        class="mb-2 grid grid-cols-[1fr_120px_1fr_60px] gap-2 text-xs text-[var(--el-text-color-secondary)]"
      >
        <span>当前字段值</span>
        <span>联动方式</span>
        <span>目标字段值</span>
        <span></span>
      </div>
      <div
        v-for="(option, index) in config.linkProp.linkOptions"
        :key="index"
        class="mb-2 grid grid-cols-[1fr_120px_1fr_60px] items-start gap-2 last:mb-0"
      >
        <el-select
          :model-value="option.current"
          :multiple="fieldType === 'multiselect'"
          class="w-full"
          @update:model-value="updateCurrent(option, $event)"
        >
          <el-option
            v-for="item in fieldOptions"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <el-select
          :model-value="option.method"
          class="w-full"
          @update:model-value="changeMethod(option, $event)"
        >
          <el-option label="自动选择" value="AUTO" />
          <el-option label="范围限制" value="HIDDEN" />
        </el-select>
        <el-select
          :model-value="option.target"
          :multiple="option.method === 'HIDDEN' || linkTarget?.type === 'multiselect'"
          class="w-full"
          @update:model-value="updateTarget(option, $event)"
        >
          <el-option
            v-for="item in linkTarget?.options ?? []"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <el-button text type="danger" @click="removeLinkOption(index)">删除</el-button>
      </div>
      <el-button class="mt-2" text type="primary" @click="addLinkOption">添加联动条件</el-button>
    </template>
  </div>
</template>
