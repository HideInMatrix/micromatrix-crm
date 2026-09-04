<script setup lang="ts">
import { Columns3, List } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    listValue?: string
    boardValue?: string
    listLabel?: string
    boardLabel?: string
  }>(),
  {
    listValue: 'list',
    boardValue: 'board',
    listLabel: '列表',
    boardLabel: '看板',
  },
)

const model = defineModel<string>({ required: true })
</script>

<template>
  <el-button-group class="crm-display-mode-switch">
    <el-tooltip :content="listLabel" placement="top">
      <el-button
        class="!h-8 !w-8 !p-0"
        :type="model === props.listValue ? 'primary' : 'default'"
        :plain="model === props.listValue"
        :aria-label="listLabel"
        data-display-mode="list"
        @click="model = props.listValue"
      >
        <List :size="16" :stroke-width="1.8" aria-hidden="true" />
      </el-button>
    </el-tooltip>
    <el-tooltip :content="boardLabel" placement="top">
      <el-button
        class="!h-8 !w-8 !p-0"
        :type="model === props.boardValue ? 'primary' : 'default'"
        :plain="model === props.boardValue"
        :aria-label="boardLabel"
        data-display-mode="board"
        @click="model = props.boardValue"
      >
        <Columns3 :size="16" :stroke-width="1.8" aria-hidden="true" />
      </el-button>
    </el-tooltip>
  </el-button-group>
</template>
