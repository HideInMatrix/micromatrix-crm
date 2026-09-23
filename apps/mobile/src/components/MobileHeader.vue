<script setup lang="ts">
defineProps<{
  title: string
  leftArrow?: boolean
}>()

defineEmits<{
  back: []
}>()
</script>

<template>
  <van-nav-bar
    :title="title"
    :left-arrow="leftArrow"
    @click-left="$emit('back')"
  />
</template>
