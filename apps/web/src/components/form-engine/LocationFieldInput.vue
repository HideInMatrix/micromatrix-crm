<script setup lang="ts">
import {
  getLocationOptions,
  isLocationCodeAllowed,
  splitLocationValue,
  type LocationScope,
  type LocationType,
} from '@micromatrix/shared'
import { computed, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    scope?: LocationScope
    locationType?: LocationType
    placeholder?: string
    readonly?: boolean
  }>(),
  { scope: 'ALL', locationType: 'PCD', placeholder: '请选择地址', readonly: false },
)

const model = defineModel<string>({ default: '' })
const regionCode = ref('')
const detail = ref('')

const options = computed(() => getLocationOptions(props.scope, props.locationType))
const showDetail = computed(() => props.locationType === 'detail')

function syncFromModel() {
  const parsed = splitLocationValue(model.value)
  regionCode.value = parsed?.code ?? ''
  detail.value = parsed?.detail ?? ''
}

function emitValue() {
  if (!regionCode.value) {
    model.value = ''
    return
  }
  model.value = `${regionCode.value}-${showDetail.value ? detail.value : ''}`
}

watch(model, syncFromModel, { immediate: true })
watch(
  () => [props.scope, props.locationType] as const,
  () => {
    if (
      regionCode.value &&
      !isLocationCodeAllowed(regionCode.value, props.scope, props.locationType)
    ) {
      regionCode.value = ''
      detail.value = ''
      model.value = ''
      return
    }
    if (!showDetail.value && detail.value) {
      detail.value = ''
      emitValue()
    }
  },
)
</script>

<template>
  <div class="w-full space-y-2">
    <el-cascader
      v-model="regionCode"
      :options="options"
      :props="{ emitPath: false }"
      :placeholder="placeholder"
      :disabled="readonly"
      clearable
      filterable
      class="!w-full"
      @change="emitValue"
    />
    <el-input
      v-if="showDetail"
      v-model="detail"
      type="textarea"
      :rows="2"
      maxlength="200"
      show-word-limit
      placeholder="请输入详细地址"
      :disabled="readonly"
      @input="emitValue"
    />
  </div>
</template>
