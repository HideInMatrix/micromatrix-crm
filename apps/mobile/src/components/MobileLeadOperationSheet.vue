<script setup lang="ts">
import type { DictionaryItemVO, MemberOption } from '@/api/system'
import { computed, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    mode: 'transfer' | 'move'
    resource?: 'lead' | 'customer'
    leadName?: string
    targetName?: string
    members?: MemberOption[]
    pools?: Array<{ id: string; name: string }>
    reasonEnabled?: boolean
    reasons?: DictionaryItemVO[]
    loading?: boolean
    submitting?: boolean
  }>(),
  {
    resource: 'lead',
    leadName: '',
    targetName: '',
    members: () => [],
    pools: () => [],
    reasons: () => [],
  },
)
const show = defineModel<boolean>({ required: true })
const emit = defineEmits<{
  confirm: [value: { ownerId?: string; poolId?: string; reasonId?: string; note?: string }]
}>()

const selecting = ref<'member' | 'pool' | 'reason' | null>(null)
const selectingVisible = computed({
  get: () => selecting.value !== null,
  set: (value: boolean) => {
    if (!value) selecting.value = null
  },
})
const selectedOwner = ref('')
const selectedPool = ref('__auto__')
const selectedReason = ref('')
const note = ref('')
const search = ref('')

const isTransfer = computed(() => props.mode === 'transfer')
const isCustomer = computed(() => props.resource === 'customer')
const resourceTitle = computed(() => (isCustomer.value ? '客户' : '线索'))
const poolTitle = computed(() => (isCustomer.value ? '客户公海' : '线索池'))
const title = computed(() =>
  isTransfer.value ? `转移${resourceTitle.value}` : `移入${poolTitle.value}`,
)
const targetLabel = computed(() => (isTransfer.value ? '转移给' : `目标${poolTitle.value}`))
const targetText = computed(() => {
  if (isTransfer.value)
    return props.members.find((item) => item.id === selectedOwner.value)?.name ?? '请选择'
  if (!isCustomer.value && selectedPool.value === '__auto__') return '自动匹配(按原负责人范围)'
  return props.pools.find((item) => item.id === selectedPool.value)?.name ?? '请选择'
})
const reasonText = computed(
  () => props.reasons.find((item) => item.id === selectedReason.value)?.name ?? '请选择',
)
const valid = computed(
  () =>
    !props.loading &&
    !props.submitting &&
    (isTransfer.value
      ? Boolean(selectedOwner.value)
      : (!isCustomer.value || Boolean(selectedPool.value)) &&
        (!props.reasonEnabled || Boolean(selectedReason.value))),
)
const options = computed(() => {
  if (selecting.value === 'member')
    return props.members.map((item) => ({ id: item.id, name: item.name }))
  if (selecting.value === 'pool')
    return isCustomer.value
      ? props.pools
      : [{ id: '__auto__', name: '自动匹配(按原负责人范围)' }, ...props.pools]
  if (selecting.value === 'reason')
    return props.reasons.map((item) => ({ id: item.id, name: item.name }))
  return []
})
const filteredOptions = computed(() => {
  const keyword = search.value.trim().toLocaleLowerCase()
  return keyword
    ? options.value.filter((item) => item.name.toLocaleLowerCase().includes(keyword))
    : options.value
})
const selectionTitle = computed(() => {
  if (selecting.value === 'member') return '选择转移负责人'
  if (selecting.value === 'pool') return `目标${poolTitle.value}`
  return `移入${poolTitle.value}原因`
})
const selectedValue = computed(() =>
  selecting.value === 'member'
    ? selectedOwner.value
    : selecting.value === 'pool'
      ? selectedPool.value
      : selectedReason.value,
)

function openSelect(type: 'member' | 'pool' | 'reason') {
  if (props.loading) return
  search.value = ''
  selecting.value = type
}
function select(id: string) {
  if (selecting.value === 'member') selectedOwner.value = id
  else if (selecting.value === 'pool') selectedPool.value = id
  else if (selecting.value === 'reason') selectedReason.value = id
  selecting.value = null
}
function submit() {
  if (!valid.value) return
  emit(
    'confirm',
    isTransfer.value
      ? { ownerId: selectedOwner.value, note: note.value.trim() || undefined }
      : {
          poolId: selectedPool.value === '__auto__' ? undefined : selectedPool.value,
          reasonId: selectedReason.value || undefined,
          note: note.value.trim() || undefined,
        },
  )
}
watch(show, (visible) => {
  if (visible) {
    selectedOwner.value = ''
    selectedPool.value = isCustomer.value ? '' : '__auto__'
    selectedReason.value = ''
    note.value = ''
    selecting.value = null
  } else selecting.value = null
})
</script>

<template>
  <van-popup
    v-model:show="show"
    position="bottom"
    round
    style="
      height: min(600px, 74dvh);
      max-height: calc(100dvh - 88px);
      overflow: hidden;
      --van-popup-round-radius: 12px;
      --van-popup-background: #f5f5f5;
    "
  >
    <div class="flex h-full min-h-0 flex-col bg-[#F5F5F5]">
      <div class="relative flex h-[50px] shrink-0 items-center justify-center bg-white px-[12px]">
        <span class="text-[16px] leading-[20px] font-semibold text-[#000000]">{{ title }}</span>
        <div class="absolute right-[12px]">
          <van-button
            type="default"
            size="small"
            style="
              --van-button-border-width: 0px;
              --van-button-small-height: 34px;
              --van-button-small-padding: 0;
              --van-button-small-font-size: 14px;
              --van-button-default-background: transparent;
              --van-button-default-color: #777777;
            "
            @click="show = false"
            >取消</van-button
          >
        </div>
      </div>
      <div
        class="flex shrink-0 items-start gap-[5px] bg-[color-mix(in_srgb,var(--van-primary-color)_10%,white)] px-[12px]"
        :class="isTransfer ? 'min-h-[28px] py-[7px]' : 'min-h-[50px] py-[8px]'"
      >
        <span
          class="flex w-[12px] shrink-0 items-center justify-center"
          :class="isTransfer ? 'h-[14px]' : 'h-[17px]'"
        >
          <van-icon name="info-o" :size="10" color="var(--van-primary-color)" />
        </span>
        <span
          class="min-w-0 flex-1 text-[12px] text-[var(--van-primary-color)]"
          :class="isTransfer ? 'leading-[14px]' : 'leading-[17px]'"
        >
          <template v-if="isTransfer">转移后系统将通过企业微信通知对应顾问。</template>
          <template v-else-if="isCustomer"
            >将「{{
              targetName || '该客户'
            }}」移入客户公海？移入后负责人清空，并按照目标公海规则等待领取或分配。</template
          >
          <template v-else
            >将「{{
              targetName || leadName || '该线索'
            }}」退回线索池？移入后负责人清空，回到对应渠道线索池等待重新分配。</template
          >
        </span>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-[12px]">
        <van-loading v-if="loading" class="!flex !justify-center !py-[24px]" />
        <div v-else class="overflow-hidden rounded-[8px] bg-white px-[12px]">
          <div
            style="
              --van-cell-horizontal-padding: 0px;
              --van-cell-vertical-padding: 14px;
              --van-cell-line-height: 20px;
              --van-cell-font-size: 14px;
              --van-cell-background: #ffffff;
              --van-cell-text-color: #333333;
              --van-cell-value-color: #000000;
              --van-cell-right-icon-color: #999999;
            "
          >
            <van-cell
              is-link
              clickable
              :border="false"
              title-class="!flex-none whitespace-nowrap"
              value-class="min-w-0 whitespace-nowrap"
              @click="openSelect(isTransfer ? 'member' : 'pool')"
            >
              <template #title>
                <span>{{ targetLabel }} <span class="text-[#F04438]">*</span></span>
              </template>
              <template #value>
                <span
                  class="block truncate"
                  :class="
                    (isTransfer && !selectedOwner) || (isCustomer && !selectedPool)
                      ? 'text-[#999999]'
                      : 'text-[#333333]'
                  "
                  >{{ targetText }}</span
                >
              </template>
            </van-cell>
            <van-cell
              v-if="!isTransfer && reasonEnabled"
              is-link
              clickable
              :border="false"
              title-class="!flex-none whitespace-nowrap"
              value-class="min-w-0 whitespace-nowrap"
              class="border-t border-[#F1F1F1]"
              @click="openSelect('reason')"
            >
              <template #title>
                <span>移入原因 <span class="text-[#F04438]">*</span></span>
              </template>
              <template #value>
                <span
                  class="block truncate"
                  :class="selectedReason ? 'text-[#333333]' : 'text-[#999999]'"
                  >{{ reasonText }}</span
                >
              </template>
            </van-cell>
          </div>
          <div v-if="!isCustomer" class="h-[120px] border-t border-[#F1F1F1] pt-[15px]">
            <div class="text-[14px] leading-[18px] text-[#333333]">补充说明</div>
            <van-field
              v-model="note"
              type="textarea"
              rows="3"
              maxlength="500"
              :placeholder="isTransfer ? '请输入转移说明（选填）' : '请输入转移线索池说明（选填）'"
              class="mt-[6px]"
              style="
                --van-cell-vertical-padding: 0px;
                --van-cell-horizontal-padding: 0px;
                --van-field-input-text-color: #000000;
                --van-field-placeholder-text-color: #999999;
                --van-field-input-line-height: 20px;
                --van-cell-font-size: 14px;
              "
            />
          </div>
        </div>
        <div
          v-if="!isTransfer && reasonEnabled && !reasons.length && !loading"
          class="mt-[8px] text-[12px] text-[#F04438]"
        >
          暂无可选原因，请先在模块设置中维护。
        </div>
      </div>
      <div
        class="shrink-0 border-t border-[#EAEAEA] bg-white px-[20px] pt-[8px] pb-[calc(8px+env(safe-area-inset-bottom))]"
        style="
          --van-button-default-height: 44px;
          --van-button-border-radius: 8px;
          --van-button-normal-font-size: 16px;
        "
      >
        <van-button type="primary" block :disabled="!valid" :loading="submitting" @click="submit">{{
          isTransfer ? '确认转移' : isCustomer ? '确认移入客户公海' : '确认退回线索池'
        }}</van-button>
      </div>
    </div>
  </van-popup>

  <van-popup
    v-model:show="selectingVisible"
    position="bottom"
    round
    style="
      height: min(480px, 60dvh);
      --van-popup-round-radius: 12px;
      --van-popup-background: #ffffff;
    "
    @close="selecting = null"
  >
    <div class="flex h-full min-h-0 flex-col bg-white">
      <div class="relative flex h-[50px] shrink-0 items-center justify-center bg-[#F5F5F5]">
        <strong class="text-[16px] text-[#000000]">{{ selectionTitle }}</strong>
        <div class="absolute right-[12px]">
          <van-button
            type="default"
            size="small"
            style="
              --van-button-border-width: 0px;
              --van-button-small-height: 34px;
              --van-button-small-padding: 0;
              --van-button-default-background: transparent;
              --van-button-default-color: #777777;
            "
            @click="selecting = null"
            >取消</van-button
          >
        </div>
      </div>
      <van-search
        v-model="search"
        shape="round"
        placeholder="搜索"
        style="--van-search-background: #ffffff; --van-search-content-background: #f3f4f8"
      />
      <div class="min-h-0 flex-1 overflow-y-auto">
        <van-cell
          v-for="option in filteredOptions"
          :key="option.id"
          :title="option.name"
          clickable
          @click="select(option.id)"
        >
          <template v-if="selectedValue === option.id" #right-icon
            ><van-icon name="success" :size="20" color="var(--van-primary-color)"
          /></template>
        </van-cell>
        <van-empty v-if="!filteredOptions.length" description="暂无可选数据" image-size="72" />
      </div>
      <div class="shrink-0 pb-[env(safe-area-inset-bottom)]" />
    </div>
  </van-popup>
</template>
