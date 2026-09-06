<script setup lang="ts">
import type {
  DataSourceLinkField,
  DataSourceSubFieldLinkField,
  DataSourceType,
  FieldConfig,
  FieldVO,
} from '@micromatrix/shared'
import { computed, ref, watch } from 'vue'
import { loadDataSourceFields } from '@/api/data-source'
import { extractErrorMessage } from '@/api/http'

const props = defineProps<{
  sourceType?: DataSourceType
  fields: FieldVO[]
  currentFieldId?: string
  multiple: boolean
}>()

const config = defineModel<FieldConfig>({ required: true })
const sourceFields = ref<FieldVO[]>([])
const loading = ref(false)

const currentTopFields = computed(() =>
  props.fields.filter(
    (field) =>
      !field.system &&
      !field.hidden &&
      field.id !== props.currentFieldId &&
      !['formula', 'sub_product'].includes(field.type),
  ),
)
const currentSubTables = computed(() =>
  props.fields.filter((field) => !field.system && !field.hidden && field.type === 'sub_product'),
)
const sourceSubTables = computed(() =>
  sourceFields.value.filter((field) => field.type === 'sub_product'),
)

const showFieldsModel = computed<string[]>({
  get: () => config.value.showFields ?? [],
  set: (value) => {
    config.value.showFields = value.length ? value : undefined
  },
})

async function loadFields() {
  const sourceType = props.sourceType
  if (!sourceType) {
    sourceFields.value = []
    return
  }
  loading.value = true
  try {
    sourceFields.value = await loadDataSourceFields(sourceType)
  } catch (error) {
    sourceFields.value = []
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

watch(
  () => props.sourceType,
  () => void loadFields(),
  { immediate: true },
)

function compatible(target: FieldVO, source: FieldVO) {
  if (target.type === 'text' || target.type === 'textarea') {
    return !['sub_product', 'picture', 'attachment'].includes(source.type)
  }
  if (['number', 'currency', 'percent'].includes(target.type)) {
    return ['number', 'currency', 'percent', 'formula'].includes(source.type)
  }
  if (['select', 'multiselect'].includes(target.type)) {
    return ['select', 'multiselect', 'radio', 'checkbox'].includes(source.type)
  }
  if (['data_source', 'data_source_multiple'].includes(target.type)) {
    return (
      ['data_source', 'data_source_multiple'].includes(source.type) &&
      target.config?.dataSourceType === source.config?.dataSourceType
    )
  }
  return target.type === source.type
}

function sourceCandidates(target?: FieldVO) {
  if (!target) return sourceFields.value.filter((field) => field.type !== 'sub_product')
  return sourceFields.value.filter(
    (field) => field.type !== 'sub_product' && compatible(target, field),
  )
}

function topTarget(link: DataSourceLinkField) {
  return currentTopFields.value.find((field) => field.id === link.current)
}

function addTopLink() {
  const target = currentTopFields.value[0]
  if (!target) return
  const source = sourceCandidates(target)[0]
  if (!source) return
  config.value.linkFields = [
    ...(config.value.linkFields ?? []),
    { current: target.id, link: source.id, method: 'fill', enable: true },
  ]
}

function removeTopLink(index: number) {
  const links = [...(config.value.linkFields ?? [])]
  links.splice(index, 1)
  config.value.linkFields = links.length ? links : undefined
}

function changeTopTarget(link: DataSourceLinkField, targetId: string) {
  link.current = targetId
  const target = currentTopFields.value.find((field) => field.id === targetId)
  link.link = sourceCandidates(target)[0]?.id ?? ''
}

function targetParent(link: DataSourceSubFieldLinkField) {
  return currentSubTables.value.find((field) => field.id === link.current)
}

function sourceParent(link: DataSourceSubFieldLinkField) {
  return sourceSubTables.value.find((field) => field.id === link.link)
}

function addParentLink() {
  const target = currentSubTables.value[0]
  const source = sourceSubTables.value[0]
  if (!target || !source) return
  const link: DataSourceSubFieldLinkField = {
    current: target.id,
    link: source.id,
    method: 'fill',
    enable: true,
    childLinks: [],
  }
  addChildLink(link)
  config.value.childLinkFields = [...(config.value.childLinkFields ?? []), link]
}

function removeParentLink(index: number) {
  const links = [...(config.value.childLinkFields ?? [])]
  links.splice(index, 1)
  config.value.childLinkFields = links.length ? links : undefined
}

function changeTargetParent(link: DataSourceSubFieldLinkField, id: string) {
  link.current = id
  link.childLinks = []
  addChildLink(link)
}

function changeSourceParent(link: DataSourceSubFieldLinkField, id: string) {
  link.link = id
  link.childLinks = []
  addChildLink(link)
}

function childSourceCandidates(parentLink: DataSourceSubFieldLinkField, target?: FieldVO) {
  const fields = sourceParent(parentLink)?.subFields ?? []
  return target ? fields.filter((field) => compatible(target, field)) : fields
}

function addChildLink(parentLink: DataSourceSubFieldLinkField) {
  const target = (targetParent(parentLink)?.subFields ?? []).find(
    (field) => field.type !== 'formula',
  )
  if (!target) return
  const source = childSourceCandidates(parentLink, target)[0]
  if (!source) return
  parentLink.childLinks.push({
    current: target.id,
    link: source.id,
    method: 'fill',
    enable: true,
    childLinks: [],
  })
}

function removeChildLink(parentLink: DataSourceSubFieldLinkField, index: number) {
  parentLink.childLinks.splice(index, 1)
}

function changeChildTarget(
  parentLink: DataSourceSubFieldLinkField,
  childLink: DataSourceSubFieldLinkField,
  id: string,
) {
  childLink.current = id
  const target = targetParent(parentLink)?.subFields?.find((field) => field.id === id)
  childLink.link = childSourceCandidates(parentLink, target)[0]?.id ?? ''
}
</script>

<template>
  <div class="mb-4 rounded-2 border border-[var(--el-border-color)] p-3">
    <div class="mb-3 flex items-start justify-between gap-3">
      <div>
        <div class="text-sm font-600">数据源展示与填充</div>
        <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
          派生字段只读展示，不写入当前表单；字段填充会在选择一条源记录后立即执行。
        </div>
      </div>
      <span v-if="loading" class="text-xs text-[var(--el-text-color-secondary)]"
        >加载源字段...</span
      >
    </div>

    <div v-if="!multiple" class="mb-4">
      <div class="mb-1.5 text-sm">派生显示字段</div>
      <el-select
        v-model="showFieldsModel"
        multiple
        filterable
        clearable
        class="w-full"
        placeholder="选择数据源中需要只读展示的字段"
      >
        <el-option
          v-for="field in sourceFields"
          :key="field.id"
          :label="field.label"
          :value="field.id"
        />
      </el-select>
    </div>

    <template v-if="!multiple">
      <div class="mb-2 flex items-center justify-between">
        <div class="text-sm font-600">当前表单字段填充</div>
        <el-button
          text
          type="primary"
          :disabled="!currentTopFields.length || !sourceFields.length"
          @click="addTopLink"
        >
          添加映射
        </el-button>
      </div>
      <div
        v-if="!config.linkFields?.length"
        class="mb-3 py-2 text-center text-sm text-[var(--el-text-color-secondary)]"
      >
        未配置字段填充
      </div>
      <div
        v-for="(link, index) in config.linkFields ?? []"
        :key="index"
        class="mb-2 grid grid-cols-[1fr_40px_1fr_70px_60px] items-center gap-2 last:mb-3"
      >
        <el-select
          :model-value="link.current"
          filterable
          placeholder="当前字段"
          @update:model-value="changeTopTarget(link, $event)"
        >
          <el-option
            v-for="field in currentTopFields"
            :key="field.id"
            :label="field.label"
            :value="field.id"
          />
        </el-select>
        <span class="text-center text-xs text-[var(--el-text-color-secondary)]">←</span>
        <el-select v-model="link.link" filterable placeholder="数据源字段">
          <el-option
            v-for="field in sourceCandidates(topTarget(link))"
            :key="field.id"
            :label="field.label"
            :value="field.id"
          />
        </el-select>
        <el-switch v-model="link.enable" inline-prompt active-text="启用" inactive-text="停用" />
        <el-button text type="danger" @click="removeTopLink(index)">删除</el-button>
      </div>

      <div
        class="mt-4 mb-2 flex items-center justify-between border-t border-[var(--el-border-color-lighter)] pt-3"
      >
        <div>
          <div class="text-sm font-600">子表填充</div>
          <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
            仅支持源 SUB_PRODUCT 到当前 SUB_PRODUCT 的逐行字段映射。
          </div>
        </div>
        <el-button
          text
          type="primary"
          :disabled="!currentSubTables.length || !sourceSubTables.length"
          @click="addParentLink"
        >
          添加子表映射
        </el-button>
      </div>

      <div
        v-if="!config.childLinkFields?.length"
        class="py-2 text-center text-sm text-[var(--el-text-color-secondary)]"
      >
        未配置子表填充
      </div>

      <div
        v-for="(parentLink, parentIndex) in config.childLinkFields ?? []"
        :key="parentIndex"
        class="mb-3 rounded-1.5 bg-[var(--el-fill-color-light)] p-3 last:mb-0"
      >
        <div class="grid grid-cols-[1fr_40px_1fr_70px_60px] items-center gap-2">
          <el-select
            :model-value="parentLink.current"
            placeholder="当前子表"
            @update:model-value="changeTargetParent(parentLink, $event)"
          >
            <el-option
              v-for="field in currentSubTables"
              :key="field.id"
              :label="field.label"
              :value="field.id"
            />
          </el-select>
          <span class="text-center text-xs text-[var(--el-text-color-secondary)]">←</span>
          <el-select
            :model-value="parentLink.link"
            placeholder="源子表"
            @update:model-value="changeSourceParent(parentLink, $event)"
          >
            <el-option
              v-for="field in sourceSubTables"
              :key="field.id"
              :label="field.label"
              :value="field.id"
            />
          </el-select>
          <el-switch
            v-model="parentLink.enable"
            inline-prompt
            active-text="启用"
            inactive-text="停用"
          />
          <el-button text type="danger" @click="removeParentLink(parentIndex)">删除</el-button>
        </div>

        <div class="mt-2 space-y-2 pl-4">
          <div
            v-for="(childLink, childIndex) in parentLink.childLinks"
            :key="childIndex"
            class="grid grid-cols-[1fr_40px_1fr_70px_60px] items-center gap-2"
          >
            <el-select
              :model-value="childLink.current"
              placeholder="当前子字段"
              @update:model-value="changeChildTarget(parentLink, childLink, $event)"
            >
              <el-option
                v-for="field in targetParent(parentLink)?.subFields?.filter(
                  (item) => item.type !== 'formula',
                ) ?? []"
                :key="field.id"
                :label="field.label"
                :value="field.id"
              />
            </el-select>
            <span class="text-center text-xs text-[var(--el-text-color-secondary)]">←</span>
            <el-select v-model="childLink.link" placeholder="源子字段">
              <el-option
                v-for="field in childSourceCandidates(
                  parentLink,
                  targetParent(parentLink)?.subFields?.find(
                    (item) => item.id === childLink.current,
                  ),
                )"
                :key="field.id"
                :label="field.label"
                :value="field.id"
              />
            </el-select>
            <el-switch
              v-model="childLink.enable"
              inline-prompt
              active-text="启用"
              inactive-text="停用"
            />
            <el-button text type="danger" @click="removeChildLink(parentLink, childIndex)"
              >删除</el-button
            >
          </div>
          <el-button text type="primary" @click="addChildLink(parentLink)"
            >添加子字段映射</el-button
          >
        </div>
      </div>
    </template>

    <div v-else class="text-xs text-[var(--el-text-color-secondary)]">
      多选数据源仅支持候选过滤；派生展示、字段填充和子表填充按 Cordys 首批边界只开放给单选数据源。
    </div>
  </div>
</template>
