<script setup lang="ts">
import {
  BUILTIN_DATA_SOURCE_OPTIONS,
  FIELD_TYPE_OPTIONS,
  supportsMobileSearchSelect,
  type FieldConfig,
  type ModuleFormProp,
  type ModuleKey,
} from '@micromatrix/shared'
import { computed, ref, watch } from 'vue'
import { isDraftField, type ModuleFormFieldDraft } from './types'

const field = defineModel<ModuleFormFieldDraft | null>('field', { default: null })
const formProp = defineModel<ModuleFormProp>('formProp', { required: true })

const props = defineProps<{
  module: ModuleKey
  fields: ModuleFormFieldDraft[]
}>()

const emit = defineEmits<{
  layoutChange: [layout: 1 | 2 | 3 | 4]
}>()

const activeTab = ref<'field' | 'form'>('field')

watch(
  () => field.value?.id,
  (id) => {
    if (id) activeTab.value = 'field'
  },
)

const typeLabel = computed(
  () => FIELD_TYPE_OPTIONS.find((item) => item.value === field.value?.type)?.label ?? '-',
)
const config = computed<FieldConfig>(() => field.value?.config ?? {})
const needOptions = computed(() =>
  ['select', 'multiselect', 'radio', 'checkbox'].includes(field.value?.type ?? ''),
)
const supportsMobileMode = computed(() =>
  field.value ? supportsMobileSearchSelect(field.value.type) : false,
)
const supportsUnique = computed(() => {
  const current = field.value
  if (!current || !['lead', 'customer', 'contact'].includes(props.module)) return false
  if (!['text', 'phone', 'email'].includes(current.type)) return false
  if (!current.system) return true
  if (props.module === 'customer') return current.key === 'name'
  if (props.module === 'contact') return ['name', 'phone'].includes(current.key)
  return false
})
const duplicateName = computed(() => {
  const current = field.value
  if (!current?.label.trim()) return false
  return props.fields.some(
    (candidate) => candidate.id !== current.id && candidate.label.trim() === current.label.trim(),
  )
})
const dataSourceTypeLocked = computed(
  () =>
    Boolean(field.value) &&
    !isDraftField(field.value!) &&
    ['data_source', 'data_source_multiple'].includes(field.value!.type) &&
    Boolean(config.value.dataSourceType),
)

function addOption() {
  if (!field.value) return
  field.value.options ??= []
  field.value.options.push({
    label: `选项 ${field.value.options.length + 1}`,
    value: `option_${globalThis.crypto.randomUUID()}`,
  })
}

function removeOption(index: number) {
  field.value?.options?.splice(index, 1)
}

function changeLayout(layout: 1 | 2 | 3 | 4) {
  formProp.value.layout = layout
  emit('layoutChange', layout)
}
</script>

<template>
  <div class="h-full overflow-hidden bg-[var(--el-bg-color)]">
    <el-tabs v-model="activeTab" stretch class="h-full">
      <el-tab-pane label="字段属性" name="field" class="h-full">
        <div v-if="field" class="h-full overflow-y-auto p-4">
          <div class="space-y-6">
            <section>
              <div class="mb-2 flex items-center justify-between">
                <span class="text-sm font-semibold text-[var(--el-text-color-primary)]">字段标题</span>
                <el-tag size="small" type="info">{{ typeLabel }}</el-tag>
              </div>
              <el-input v-model="field.label" maxlength="30" show-word-limit />
              <div v-if="duplicateName" class="mt-1 text-xs text-[var(--el-color-danger)]">
                字段名称不能重复
              </div>
            </section>

            <section
              v-if="
                ![
                  'radio',
                  'checkbox',
                  'picture',
                  'attachment',
                  'formula',
                  'sub_product',
                ].includes(field.type)
              "
            >
              <div class="mb-2 text-sm font-semibold text-[var(--el-text-color-primary)]">
                占位提示
              </div>
              <el-input v-model="config.placeholder" maxlength="56" clearable />
            </section>

            <section v-if="needOptions">
              <div class="mb-2 flex items-center justify-between">
                <span class="text-sm font-semibold text-[var(--el-text-color-primary)]">选项</span>
                <el-button link type="primary" @click="addOption">添加选项</el-button>
              </div>
              <div class="space-y-2">
                <div
                  v-for="(option, index) in field.options ?? []"
                  :key="option.value"
                  class="flex items-center gap-2"
                >
                  <el-input v-model="option.label" placeholder="选项名称" />
                  <el-input v-model="option.value" placeholder="选项值" />
                  <el-button link type="danger" @click="removeOption(index)">删除</el-button>
                </div>
              </div>
            </section>

            <section v-if="['data_source', 'data_source_multiple'].includes(field.type)">
              <div class="mb-2 text-sm font-semibold text-[var(--el-text-color-primary)]">
                数据源
              </div>
              <el-select
                v-model="config.dataSourceType"
                class="w-full"
                filterable
                :disabled="dataSourceTypeLocked"
                placeholder="请选择数据源"
              >
                <el-option
                  v-for="option in BUILTIN_DATA_SOURCE_OPTIONS"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
              <div
                v-if="dataSourceTypeLocked"
                class="mt-1 text-xs leading-5 text-[var(--el-text-color-secondary)]"
              >
                已保存的数据源字段不能切换数据源类型，如需调整请删除后重建。
              </div>
            </section>

            <template v-if="field.type === 'formula'">
              <section>
                <div class="mb-2 text-sm font-semibold text-[var(--el-text-color-primary)]">
                  公式表达式
                </div>
                <el-input
                  v-model="config.formula"
                  placeholder="如：cf_amount * cf_discount / 100"
                />
              </section>
              <section>
                <div class="mb-2 text-sm font-semibold text-[var(--el-text-color-primary)]">
                  小数位数
                </div>
                <el-input-number v-model="config.precision" :min="0" :max="6" />
              </section>
            </template>

            <template v-if="field.type === 'location'">
              <section>
                <div class="mb-2 text-sm font-semibold text-[var(--el-text-color-primary)]">
                  地址范围
                </div>
                <el-radio-group v-model="config.scope">
                  <el-radio-button value="ALL">全球</el-radio-button>
                  <el-radio-button value="CN">中国</el-radio-button>
                </el-radio-group>
              </section>
              <section>
                <div class="mb-2 text-sm font-semibold text-[var(--el-text-color-primary)]">
                  地址层级
                </div>
                <el-select v-model="config.locationType" class="w-full">
                  <el-option label="省 / 市 / 区" value="PCD" />
                  <el-option label="省 / 市" value="PC" />
                  <el-option label="省" value="P" />
                  <el-option label="国家" value="C" />
                  <el-option label="详细地址" value="detail" />
                </el-select>
              </section>
            </template>

            <template v-if="field.type === 'attachment'">
              <section>
                <div class="mb-2 text-sm font-semibold text-[var(--el-text-color-primary)]">
                  附件设置
                </div>
                <div class="space-y-3">
                  <div class="flex items-center justify-between">
                    <span class="text-sm text-[var(--el-text-color-regular)]">仅允许单个附件</span>
                    <el-switch v-model="config.onlyOne" />
                  </div>
                  <el-input v-model="config.accept" placeholder=".pdf,.docx,.xlsx" />
                  <el-input v-model="config.limitSize" placeholder="单文件大小，如 20MB" />
                </div>
              </section>
            </template>

            <section v-if="supportsMobileMode">
              <div class="mb-2 text-sm font-semibold text-[var(--el-text-color-primary)]">
                移动端选择方式
              </div>
              <el-radio-group v-model="config.mobileSelectMode">
                <el-radio-button value="popup">弹出选择器</el-radio-button>
                <el-radio-button value="searchPage">搜索页面</el-radio-button>
              </el-radio-group>
            </section>

            <section>
              <div class="mb-3 text-sm font-semibold text-[var(--el-text-color-primary)]">
                字段状态
              </div>
              <div class="space-y-3">
                <div class="flex items-center justify-between">
                  <span class="text-sm text-[var(--el-text-color-regular)]">必填</span>
                  <el-switch
                    v-model="field.required"
                    :disabled="field.type === 'formula' || field.type === 'sub_product'"
                  />
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-sm text-[var(--el-text-color-regular)]">唯一值</span>
                  <el-switch v-model="config.unique" :disabled="!supportsUnique" />
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-sm text-[var(--el-text-color-regular)]">隐藏</span>
                  <el-switch
                    v-model="field.hidden"
                    :disabled="Boolean(field.system && field.required)"
                  />
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-sm text-[var(--el-text-color-regular)]">移动端显示</span>
                  <el-switch v-model="field.mobile" />
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-sm text-[var(--el-text-color-regular)]">列表显示</span>
                  <el-switch v-model="field.showInList" :disabled="field.type === 'sub_product'" />
                </div>
              </div>
            </section>

            <section>
              <div class="mb-2 text-sm font-semibold text-[var(--el-text-color-primary)]">
                字段宽度
              </div>
              <el-radio-group v-model="field.span" :disabled="field.type === 'sub_product'">
                <el-radio-button :value="6">1/4 行</el-radio-button>
                <el-radio-button :value="8">1/3 行</el-radio-button>
                <el-radio-button :value="12">半行</el-radio-button>
                <el-radio-button :value="24">整行</el-radio-button>
              </el-radio-group>
            </section>

            <section v-if="field.showInList && field.type !== 'sub_product'">
              <div class="mb-2 text-sm font-semibold text-[var(--el-text-color-primary)]">
                列表列宽
              </div>
              <el-input-number
                v-model="field.listWidth"
                :min="60"
                :max="500"
                placeholder="留空自适应"
              />
            </section>
          </div>
        </div>

        <div
          v-else
          class="flex h-full min-h-[240px] items-start justify-center px-4 pt-16 text-center text-sm text-[var(--el-text-color-secondary)]"
        >
          选中字段后，可以配置字段属性
        </div>
      </el-tab-pane>

      <el-tab-pane label="表单属性" name="form" class="h-full">
        <div class="h-full overflow-y-auto p-4">
          <div class="space-y-6">
            <section>
              <div class="mb-2 text-sm font-semibold text-[var(--el-text-color-primary)]">
                PC 表单尺寸
              </div>
              <el-radio-group v-model="formProp.viewSize">
                <el-radio-button value="large">大</el-radio-button>
                <el-radio-button value="medium">中</el-radio-button>
                <el-radio-button value="small">小</el-radio-button>
              </el-radio-group>
            </section>

            <section>
              <div class="mb-2 text-sm font-semibold text-[var(--el-text-color-primary)]">
                表单布局
              </div>
              <el-radio-group
                :model-value="formProp.layout ?? 2"
                @update:model-value="changeLayout($event as 1 | 2 | 3 | 4)"
              >
                <el-radio-button :value="1">一列</el-radio-button>
                <el-radio-button :value="2">两列</el-radio-button>
                <el-radio-button :value="3">三列</el-radio-button>
                <el-radio-button :value="4">四列</el-radio-button>
              </el-radio-group>
            </section>

            <section>
              <div class="mb-3 text-sm font-semibold text-[var(--el-text-color-primary)]">
                字段标题位置
              </div>
              <div class="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  class="rounded-[var(--el-border-radius-base)] border p-3 text-sm transition"
                  :class="
                    formProp.labelPos === 'top'
                      ? 'border-[var(--el-color-primary)] text-[var(--el-color-primary)]'
                      : 'border-[var(--el-border-color)] text-[var(--el-text-color-regular)]'
                  "
                  @click="formProp.labelPos = 'top'"
                >
                  <div class="mb-3 space-y-1 rounded bg-[var(--el-fill-color-lighter)] p-2">
                    <div class="h-2 w-10 rounded bg-[var(--el-border-color)]" />
                    <div class="h-3 w-full rounded bg-[var(--el-fill-color-dark)]" />
                  </div>
                  上下
                </button>
                <button
                  type="button"
                  class="rounded-[var(--el-border-radius-base)] border p-3 text-sm transition"
                  :class="
                    formProp.labelPos === 'left'
                      ? 'border-[var(--el-color-primary)] text-[var(--el-color-primary)]'
                      : 'border-[var(--el-border-color)] text-[var(--el-text-color-regular)]'
                  "
                  @click="formProp.labelPos = 'left'"
                >
                  <div class="mb-3 space-y-1 rounded bg-[var(--el-fill-color-lighter)] p-2">
                    <div class="flex gap-1">
                      <div class="h-3 w-7 rounded bg-[var(--el-border-color)]" />
                      <div class="h-3 flex-1 rounded bg-[var(--el-fill-color-dark)]" />
                    </div>
                    <div class="flex gap-1">
                      <div class="h-3 w-7 rounded bg-[var(--el-border-color)]" />
                      <div class="h-3 flex-1 rounded bg-[var(--el-fill-color-dark)]" />
                    </div>
                  </div>
                  左右
                </button>
              </div>
            </section>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>
