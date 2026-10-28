<script setup lang="ts">
const props = defineProps<{
  tabs: { id: string; title: string }[]
  active: string
}>()
const emit = defineEmits<{ change: [tabId: string] }>()
</script>

<template>
  <div
    class="relative z-[2] flex h-[32px] shrink-0 items-stretch bg-white shadow-[0_1px_3px_rgba(0,0,0,0.07)]"
  >
    <van-button
      v-for="tab in props.tabs"
      :key="tab.id"
      class="relative !h-full !min-w-0 !flex-1 !rounded-none !border-0 !bg-white !p-0"
      :class="
        props.active === tab.id
          ? '!text-[16px] !font-semibold !text-[#000000]'
          : '!text-[15px] !font-normal !text-[#999999]'
      "
      @click="emit('change', tab.id)"
    >
      {{ tab.title }}
      <span
        v-if="props.active === tab.id"
        class="absolute bottom-0 left-1/2 h-[2px] w-[24px] -translate-x-1/2 rounded-full bg-[var(--van-primary-color)]"
      />
    </van-button>
  </div>
</template>
