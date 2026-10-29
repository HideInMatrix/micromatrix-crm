<script setup lang="ts">
import type { FieldVO } from '@micromatrix/shared'
import { computed, reactive, ref, watch } from 'vue'
import { showFailToast } from 'vant'
import { leadApi, followUpApi } from '@/api/sales'
import { metadataApi } from '@/api/metadata'
import { extractErrorMessage } from '@/api/http'
import MobileCalendarPopup from '@/components/MobileCalendarPopup.vue'
import { useAuthStore } from '@/stores/auth'
import { showSuccessFeedback } from '@/utils/feedback'

const props = defineProps<{
  targetType: 'lead' | 'customer'
  targetId: string | null
  targetName?: string
}>()
const show = defineModel<boolean>({ required: true })
const emit = defineEmits<{ followed: [] }>()
const auth = useAuthStore()
const saving = ref(false)
const loadingIntent = ref(false)
const methodShow = ref(false)
const intentShow = ref(false)
const dateShow = ref(false)
const intentField = ref<FieldVO | null>(null)
const initialIntent = ref('')
const form = reactive({ type: '电话', content: '', followedOn: '', intent: '' })

const methods = [
  { text: '电话沟通', value: '电话' },
  { text: '微信沟通', value: '微信' },
  { text: '面谈', value: '会议' },
  { text: '到校参观', value: '拜访' },
]
const methodText = computed(
  () => methods.find((item) => item.value === form.type)?.text ?? form.type,
)
const intentOptions = computed(() => intentField.value?.options ?? [])
const intentText = computed(
  () => intentOptions.value.find((option) => option.value === form.intent)?.label ?? '请选择',
)
const canEditIntent = computed(
  () => props.targetType === 'lead' && auth.hasPerm('lead:update') && Boolean(intentField.value),
)

async function loadIntent() {
  if (!props.targetId || props.targetType !== 'lead' || !auth.hasPerm('lead:update')) return
  loadingIntent.value = true
  try {
    const [config, detail] = await Promise.all([
      metadataApi.formConfig('lead'),
      leadApi.get(props.targetId),
    ])
    if (!show.value) return
    const field = config.data.fields.find(
      (item) =>
        !item.hidden &&
        item.type === 'select' &&
        item.label === '意向等级' &&
        Boolean(item.options?.length),
    )
    intentField.value = field ?? null
    const current = field ? detail.data.customData[field.key] : undefined
    form.intent = typeof current === 'string' ? current : ''
    initialIntent.value = form.intent
  } catch {
    // 意向等级是线索字段的可选扩展，读取失败不影响记录跟进。
    intentField.value = null
  } finally {
    loadingIntent.value = false
  }
}

watch(show, (opened) => {
  if (opened) {
    form.type = '电话'
    form.content = ''
    form.followedOn = ''
    form.intent = ''
    initialIntent.value = ''
    intentField.value = null
    methodShow.value = false
    intentShow.value = false
    dateShow.value = false
    void loadIntent()
  } else {
    methodShow.value = false
    intentShow.value = false
    dateShow.value = false
  }
})

function chooseMethod(value: string) {
  form.type = value
  methodShow.value = false
}
function chooseIntent(value: string) {
  form.intent = value
  intentShow.value = false
}
function chooseDate(value: string) {
  form.followedOn = value
}

async function submit() {
  if (!props.targetId || saving.value) return
  const content = form.content.trim()
  if (!content) return showFailToast('请填写跟进内容')
  saving.value = true
  try {
    await followUpApi.create({
      targetType: props.targetType,
      targetId: props.targetId,
      type: form.type,
      content,
      followedAt: form.followedOn
        ? new Date(`${form.followedOn}T00:00:00`).toISOString()
        : undefined,
    })
    if (canEditIntent.value && intentField.value && form.intent !== initialIntent.value) {
      try {
        await leadApi.update(props.targetId, {
          moduleFields: [{ fieldId: intentField.value.id, fieldValue: form.intent }],
        })
      } catch (error) {
        showFailToast(`跟进已保存，但意向等级更新失败：${extractErrorMessage(error)}`)
        show.value = false
        emit('followed')
        return
      }
    }
    show.value = false
    showSuccessFeedback('跟进已保存')
    emit('followed')
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <van-popup
    v-model:show="show"
    position="bottom"
    round
    :close-on-click-overlay="false"
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
        <span
          class="max-w-[calc(100%-96px)] truncate text-[16px] leading-[20px] font-semibold text-[#000000]"
          >写跟进·{{ targetName ?? '' }}</span
        >
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

      <div class="min-h-0 flex-1 overflow-y-auto p-[12px]">
        <div
          class="overflow-hidden rounded-[8px] bg-white px-[12px]"
          style="
            --van-cell-background: #ffffff;
            --van-cell-horizontal-padding: 0px;
            --van-cell-vertical-padding: 14px;
            --van-cell-line-height: 20px;
            --van-cell-font-size: 14px;
            --van-cell-text-color: #333333;
            --van-cell-value-color: #000000;
            --van-cell-right-icon-color: #999999;
          "
        >
          <van-cell
            title="跟进方式"
            :value="methodText"
            is-link
            clickable
            :border="false"
            @click="methodShow = true"
          />
          <van-cell
            v-if="canEditIntent"
            title="更新意向等级"
            :value="intentText"
            is-link
            clickable
            :border="false"
            class="border-t border-[#F1F1F1]"
            @click="intentShow = true"
          />
          <van-cell
            title="跟进时间"
            :value="form.followedOn || '请选择跟进时间'"
            is-link
            clickable
            :border="false"
            class="border-t border-[#F1F1F1]"
            value-class="min-w-0"
            @click="dateShow = true"
          />
          <div class="h-[120px] border-t border-[#F1F1F1] pt-[12px]">
            <div class="text-[14px] leading-[20px] text-[#333333]">
              跟进内容 <span class="text-[#F04438]">*</span>
            </div>
            <van-field
              v-model="form.content"
              type="textarea"
              rows="3"
              maxlength="3000"
              placeholder="沟通要点、家长诉求、下一步动作"
              style="
                --van-cell-horizontal-padding: 0px;
                --van-cell-vertical-padding: 0px;
                --van-cell-font-size: 14px;
                --van-field-input-line-height: 21px;
                --van-field-placeholder-text-color: #999999;
                --van-field-input-text-color: #000000;
              "
              class="mt-[6px]"
            />
          </div>
        </div>
        <van-loading v-if="loadingIntent" class="!flex !justify-center !py-[12px]" size="18" />
      </div>

      <div
        class="shrink-0 border-t border-[#EAEAEA] bg-white px-[20px] pt-[8px] pb-[calc(8px+env(safe-area-inset-bottom))]"
        style="
          --van-button-default-height: 44px;
          --van-button-border-radius: 8px;
          --van-button-normal-font-size: 17px;
        "
      >
        <van-button type="primary" block :loading="saving" :disabled="!targetId" @click="submit"
          >保存跟进</van-button
        >
      </div>
    </div>
  </van-popup>

  <van-popup
    v-model:show="methodShow"
    teleport="body"
    position="bottom"
    round
    style="--van-popup-round-radius: 12px; --van-popup-background: #ffffff"
  >
    <div class="flex min-h-0 flex-col bg-white">
      <div class="relative flex h-[50px] shrink-0 items-center justify-center bg-[#F5F5F5]">
        <span class="text-[16px] font-semibold text-[#000000]">跟进方式</span>
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
            @click="methodShow = false"
            >取消</van-button
          >
        </div>
      </div>
      <div class="grid grid-cols-3 gap-[10px] p-[12px]">
        <van-button
          v-for="option in methods"
          :key="option.value"
          type="default"
          block
          class="min-w-0"
          style="
            --van-button-default-height: 36px;
            --van-button-normal-padding: 0px;
            --van-button-default-font-size: 14px;
            --van-button-radius: 6px;
          "
          :color="form.type === option.value ? 'var(--van-primary-color)' : '#F3F4F8'"
          :plain="form.type === option.value"
          @click="chooseMethod(option.value)"
        >
          <span
            :class="
              form.type === option.value ? 'text-[var(--van-primary-color)]' : 'text-[#333333]'
            "
            >{{ option.text }}</span
          >
        </van-button>
      </div>
      <div class="shrink-0 pb-[env(safe-area-inset-bottom)]" />
    </div>
  </van-popup>

  <van-popup
    v-model:show="intentShow"
    teleport="body"
    position="bottom"
    round
    style="--van-popup-round-radius: 12px; --van-popup-background: #ffffff"
  >
    <div class="flex min-h-0 flex-col bg-white">
      <div class="relative flex h-[50px] shrink-0 items-center justify-center bg-[#F5F5F5]">
        <span class="text-[16px] font-semibold text-[#000000]">更新意向等级</span>
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
            @click="intentShow = false"
            >取消</van-button
          >
        </div>
      </div>
      <div class="grid grid-cols-3 gap-[10px] p-[12px]">
        <van-button
          v-for="option in intentOptions"
          :key="option.value"
          type="default"
          block
          class="min-w-0"
          style="
            --van-button-default-height: 36px;
            --van-button-normal-padding: 0px;
            --van-button-default-font-size: 14px;
            --van-button-radius: 6px;
          "
          :color="form.intent === option.value ? 'var(--van-primary-color)' : '#F3F4F8'"
          :plain="form.intent === option.value"
          @click="chooseIntent(option.value)"
          ><span
            :class="
              form.intent === option.value ? 'text-[var(--van-primary-color)]' : 'text-[#333333]'
            "
            >{{ option.label }}</span
          ></van-button
        >
      </div>
      <div class="shrink-0 pb-[env(safe-area-inset-bottom)]" />
    </div>
  </van-popup>

  <MobileCalendarPopup
    v-model:show="dateShow"
    label="跟进时间"
    :value="form.followedOn"
    @confirm="chooseDate"
  />
</template>
