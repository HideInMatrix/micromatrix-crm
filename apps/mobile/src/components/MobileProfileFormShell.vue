<script setup lang="ts">
withDefaults(
  defineProps<{
    saving?: boolean
    disabled?: boolean
  }>(),
  { saving: false, disabled: false },
)

const emit = defineEmits<{ save: [] }>()
</script>

<template>
  <div
    class="h-full min-h-0 overflow-y-auto bg-[#F5F5F5] px-[12px] pt-[12px] pb-[calc(28px+env(safe-area-inset-bottom))]"
  >
    <div
      class="overflow-hidden rounded-[8px] bg-white px-[12px] [&_.van-cell]:!min-h-[48px] [&_.van-cell]:!items-center [&_.van-cell]:!p-0 [&_.van-cell]:!text-[15px] [&_.van-cell]:!leading-[20px] [&_.van-cell]:!text-[#333333] [&_.van-cell::after]:!right-0 [&_.van-cell::after]:!left-0 [&_.van-cell::after]:!border-b-[#EAEAEA] [&_.van-cell:last-child::after]:!hidden [&_.van-field__label]:!mr-[12px] [&_.van-field__label]:!w-[96px] [&_.van-field__label]:!text-[#444444] [&_.van-field__control]:!text-[15px] [&_.van-field__control]:!text-[#111111] [&_.van-field__control::placeholder]:!text-[#BFC5D0]"
    >
      <slot />
    </div>
    <div
      class="mx-[36px] mt-[40px]"
      style="
        --van-button-default-height: 44px;
        --van-button-normal-font-size: 16px;
        --van-button-border-radius: 999px;
      "
    >
      <van-button
        type="primary"
        round
        block
        :loading="saving"
        :disabled="disabled"
        @click="emit('save')"
        >保存</van-button
      >
    </div>
  </div>
</template>
