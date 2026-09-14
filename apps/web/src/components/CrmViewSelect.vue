<script setup lang="ts">
import { ChevronDown, Copy, GripVertical, Pin, Plus } from 'lucide-vue-next'
import { computed, ref } from 'vue'

interface CrmViewSelectItem {
  id: string
  label: string
  fixed?: boolean
  pinnable?: boolean
  copyable?: boolean
  reorderable?: boolean
}

type ViewGroup = 'system' | 'personal'
type MoveMode = 'BEFORE' | 'AFTER'

const props = withDefaults(
  defineProps<{
    modelValue: string
    systemViews?: CrmViewSelectItem[]
    personalViews?: CrmViewSelectItem[]
    loading?: boolean
    triggerLabel?: string
    systemGroupLabel?: string
    personalGroupLabel?: string
  }>(),
  {
    systemViews: () => [],
    personalViews: () => [],
    loading: false,
    triggerLabel: '视图',
    systemGroupLabel: '系统视图',
    personalGroupLabel: '我的视图',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  create: []
  manage: []
  pin: [item: CrmViewSelectItem]
  copy: [item: CrmViewSelectItem]
  reorder: [payload: { group: ViewGroup; moveId: string; targetId: string; moveMode: MoveMode }]
}>()

const visible = ref(false)
const dragging = ref<{ id: string; group: ViewGroup } | null>(null)
const dropTarget = ref<{ id: string; mode: MoveMode } | null>(null)
const suppressSelection = ref(false)

const activeItem = computed(() =>
  [...props.systemViews, ...props.personalViews].find((item) => item.id === props.modelValue),
)

function selectView(item: CrmViewSelectItem) {
  if (suppressSelection.value) return
  emit('update:modelValue', item.id)
  visible.value = false
}

function handleCreate() {
  visible.value = false
  emit('create')
}

function handleManage() {
  visible.value = false
  emit('manage')
}

function startDrag(event: DragEvent, item: CrmViewSelectItem, group: ViewGroup) {
  if (!item.reorderable) {
    event.preventDefault()
    return
  }
  dragging.value = { id: item.id, group }
  suppressSelection.value = true
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', item.id)
  }
}

function updateDropTarget(event: DragEvent, item: CrmViewSelectItem, group: ViewGroup) {
  if (!dragging.value || dragging.value.group !== group || dragging.value.id === item.id) return
  event.preventDefault()
  const element = event.currentTarget as HTMLElement
  const mode: MoveMode =
    event.clientY < element.getBoundingClientRect().top + element.offsetHeight / 2
      ? 'BEFORE'
      : 'AFTER'
  dropTarget.value = { id: item.id, mode }
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}

function finishDrop(event: DragEvent, item: CrmViewSelectItem, group: ViewGroup) {
  if (!dragging.value || dragging.value.group !== group || dragging.value.id === item.id) return
  event.preventDefault()
  emit('reorder', {
    group,
    moveId: dragging.value.id,
    targetId: item.id,
    moveMode: dropTarget.value?.id === item.id ? dropTarget.value.mode : 'BEFORE',
  })
  endDrag()
}

function endDrag() {
  dragging.value = null
  dropTarget.value = null
  window.setTimeout(() => {
    suppressSelection.value = false
  }, 0)
}

function rowClasses(item: CrmViewSelectItem) {
  return {
    'is-active': props.modelValue === item.id,
    'is-dragging': dragging.value?.id === item.id,
    'is-drop-before': dropTarget.value?.id === item.id && dropTarget.value.mode === 'BEFORE',
    'is-drop-after': dropTarget.value?.id === item.id && dropTarget.value.mode === 'AFTER',
  }
}
</script>

<template>
  <el-popover
    v-model:visible="visible"
    placement="bottom-end"
    trigger="click"
    :width="288"
    :show-arrow="false"
    :persistent="false"
    popper-class="crm-view-select-popper"
  >
    <template #reference>
      <button
        type="button"
        class="crm-view-select__trigger"
        :class="{ 'is-open': visible }"
        :aria-expanded="visible"
        aria-haspopup="listbox"
        data-testid="crm-view-select-trigger"
      >
        <span class="crm-view-select__trigger-prefix">{{ triggerLabel }}</span>
        <span class="crm-view-select__trigger-value">{{ activeItem?.label ?? '选择视图' }}</span>
        <ChevronDown
          :size="16"
          :stroke-width="1.8"
          class="crm-view-select__chevron"
          aria-hidden="true"
        />
      </button>
    </template>

    <div v-loading="loading" class="crm-view-select__menu" data-testid="crm-view-select-menu">
      <button type="button" class="crm-view-select__create" @click="handleCreate">
        <Plus :size="17" :stroke-width="1.8" aria-hidden="true" />
        <span>新建视图</span>
      </button>

      <section class="crm-view-select__group" aria-labelledby="crm-view-system-label">
        <div id="crm-view-system-label" class="crm-view-select__group-label">
          <slot name="system-group-label">{{ systemGroupLabel }}</slot>
        </div>
        <div role="listbox" :aria-label="systemGroupLabel">
          <div
            v-for="item in systemViews"
            :key="item.id"
            role="option"
            tabindex="0"
            class="crm-view-select__row"
            :class="rowClasses(item)"
            :aria-selected="modelValue === item.id"
            @click="selectView(item)"
            @keydown.enter.prevent="selectView(item)"
            @keydown.space.prevent="selectView(item)"
          >
            <span class="crm-view-select__row-main">
              <GripVertical
                :size="14"
                class="crm-view-select__drag is-disabled"
                aria-hidden="true"
              />
              <Pin
                :size="14"
                :fill="item.fixed ? 'currentColor' : 'none'"
                class="crm-view-select__pin is-static"
                aria-hidden="true"
              />
              <span class="crm-view-select__row-label">
                <slot name="item-label" :item="item" group="system">{{ item.label }}</slot>
              </span>
            </span>
          </div>
        </div>
      </section>

      <section class="crm-view-select__group" aria-labelledby="crm-view-personal-label">
        <div id="crm-view-personal-label" class="crm-view-select__group-label">
          <slot name="personal-group-label">{{ personalGroupLabel }}</slot>
        </div>
        <div v-if="personalViews.length" role="listbox" :aria-label="personalGroupLabel">
          <div
            v-for="item in personalViews"
            :key="item.id"
            role="option"
            tabindex="0"
            class="crm-view-select__row"
            :class="rowClasses(item)"
            :aria-selected="modelValue === item.id"
            @click="selectView(item)"
            @keydown.enter.prevent="selectView(item)"
            @keydown.space.prevent="selectView(item)"
            @dragover="updateDropTarget($event, item, 'personal')"
            @drop="finishDrop($event, item, 'personal')"
          >
            <span class="crm-view-select__row-main">
              <GripVertical
                :size="14"
                class="crm-view-select__drag"
                :class="{ 'is-disabled': !item.reorderable }"
                :draggable="item.reorderable"
                aria-hidden="true"
                @dragstart.stop="startDrag($event, item, 'personal')"
                @dragend.stop="endDrag"
              />
              <button
                v-if="item.pinnable"
                type="button"
                class="crm-view-select__icon-button"
                :class="{ 'is-fixed': item.fixed }"
                :aria-label="item.fixed ? `取消固定${item.label}` : `固定${item.label}`"
                :title="item.fixed ? '取消固定' : '固定视图'"
                @click.stop="emit('pin', item)"
              >
                <Pin :size="14" :fill="item.fixed ? 'currentColor' : 'none'" aria-hidden="true" />
              </button>
              <Pin
                v-else
                :size="14"
                :fill="item.fixed ? 'currentColor' : 'none'"
                class="crm-view-select__pin is-static"
                aria-hidden="true"
              />
              <span class="crm-view-select__row-label">
                <slot name="item-label" :item="item" group="personal">{{ item.label }}</slot>
              </span>
            </span>
            <button
              v-if="item.copyable"
              type="button"
              class="crm-view-select__icon-button crm-view-select__copy"
              :aria-label="`复制${item.label}`"
              title="复制视图"
              @click.stop="emit('copy', item)"
            >
              <Copy :size="14" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div v-else class="crm-view-select__empty">
          <slot name="personal-empty">暂无个人视图</slot>
        </div>
      </section>

      <button type="button" class="crm-view-select__manage" @click="handleManage">
        <slot name="manage-label">管理视图</slot>
      </button>
    </div>
  </el-popover>
</template>

<style scoped>
.crm-view-select__trigger {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  width: 200px;
  height: var(--el-component-size, 32px);
  padding: 0 10px 0 12px;
  color: var(--el-text-color-regular);
  font: inherit;
  text-align: left;
  background: var(--el-fill-color-blank);
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  cursor: pointer;
  outline: none;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.crm-view-select__trigger:hover,
.crm-view-select__trigger.is-open,
.crm-view-select__trigger:focus-visible {
  border-color: var(--el-color-primary);
}

.crm-view-select__trigger:focus-visible {
  box-shadow: 0 0 0 2px var(--el-color-primary-light-8);
}

.crm-view-select__trigger-prefix {
  margin-right: 6px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}

.crm-view-select__trigger-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.crm-view-select__chevron {
  color: var(--el-text-color-placeholder);
  transition: transform 0.18s ease;
}

.crm-view-select__trigger.is-open .crm-view-select__chevron {
  transform: rotate(180deg);
}

.crm-view-select__menu {
  overflow: hidden;
  color: var(--el-text-color-primary);
  background: var(--el-bg-color-overlay);
  border-radius: var(--el-border-radius-base);
}

.crm-view-select__create,
.crm-view-select__manage {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 42px;
  padding: 0 14px;
  color: var(--el-color-primary);
  font: inherit;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.crm-view-select__create {
  justify-content: flex-start;
}

.crm-view-select__create:hover,
.crm-view-select__manage:hover {
  background: var(--el-color-primary-light-9);
}

.crm-view-select__group-label {
  padding: 7px 14px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 20px;
  background: var(--el-fill-color-light);
}

.crm-view-select__row {
  position: relative;
  display: flex;
  min-height: 36px;
  margin: 2px 6px;
  padding: 0 8px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-radius: var(--el-border-radius-small);
  cursor: pointer;
  outline: none;
}

.crm-view-select__row:hover,
.crm-view-select__row:focus-visible,
.crm-view-select__row.is-active {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.crm-view-select__row.is-active .crm-view-select__row-label {
  font-weight: 500;
}

.crm-view-select__row.is-dragging {
  opacity: 0.45;
}

.crm-view-select__row.is-drop-before::before,
.crm-view-select__row.is-drop-after::after {
  position: absolute;
  right: 8px;
  left: 8px;
  height: 2px;
  background: var(--el-color-primary);
  border-radius: 2px;
  content: '';
}

.crm-view-select__row.is-drop-before::before {
  top: -2px;
}

.crm-view-select__row.is-drop-after::after {
  bottom: -2px;
}

.crm-view-select__row-main {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
}

.crm-view-select__drag {
  flex: 0 0 auto;
  color: var(--el-text-color-secondary);
  cursor: grab;
}

.crm-view-select__drag.is-disabled {
  opacity: 0.45;
  cursor: default;
}

.crm-view-select__pin {
  flex: 0 0 auto;
  color: var(--el-color-primary);
}

.crm-view-select__pin:not([fill='currentColor']) {
  color: var(--el-text-color-regular);
}

.crm-view-select__row-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.crm-view-select__icon-button {
  display: inline-grid;
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  place-items: center;
  padding: 0;
  color: var(--el-text-color-secondary);
  background: transparent;
  border: 0;
  border-radius: var(--el-border-radius-small);
  cursor: pointer;
}

.crm-view-select__icon-button:hover,
.crm-view-select__icon-button:focus-visible,
.crm-view-select__icon-button.is-fixed {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  outline: none;
}

.crm-view-select__copy {
  opacity: 0;
}

.crm-view-select__row:hover .crm-view-select__copy,
.crm-view-select__row:focus-within .crm-view-select__copy {
  opacity: 1;
}

.crm-view-select__empty {
  padding: 11px 14px;
  color: var(--el-text-color-placeholder);
  font-size: 13px;
  text-align: center;
}

.crm-view-select__manage {
  border-top: 1px solid var(--el-border-color-lighter);
  box-shadow: 0 -1px 4px rgb(31 35 41 / 10%);
}

@media (prefers-reduced-motion: reduce) {
  .crm-view-select__trigger,
  .crm-view-select__chevron {
    transition: none;
  }
}
</style>

<style>
.crm-view-select-popper.el-popper {
  padding: 0;
  overflow: hidden;
}
</style>
