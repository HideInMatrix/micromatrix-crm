<script setup lang="ts">
import type {
  MessageReminderTime,
  MessageTaskConfig,
  MessageTaskSettingVO,
} from '@micromatrix/shared'
import { Plus, Trash2 } from 'lucide-vue-next'
import { computed, reactive, ref, watch } from 'vue'
import { extractErrorMessage } from '@/api/http'
import {
  memberApi,
  messageSettingApi,
  roleApi,
  type MemberOption,
  type RoleOption,
} from '@/api/system'

const props = defineProps<{
  modelValue: boolean
  item: MessageTaskSettingVO | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: []
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})
const loading = ref(false)
const saving = ref(false)
const members = ref<MemberOption[]>([])
const roles = ref<RoleOption[]>([])
const selectedUserIds = ref<string[]>([])
const form = reactive<MessageTaskConfig>({
  timeList: [],
  userIds: ['OWNER'],
  roleIds: [],
  ownerEnable: false,
  ownerLevel: 0,
  roleEnable: false,
})

function assignConfig(config: MessageTaskConfig) {
  form.timeList = config.timeList.map((item) => ({ ...item }))
  form.userIds = [...config.userIds]
  form.roleIds = [...config.roleIds]
  form.ownerEnable = config.ownerEnable
  form.ownerLevel = config.ownerLevel
  form.roleEnable = config.roleEnable
  selectedUserIds.value = config.userIds.filter((id) => id !== 'OWNER')
}

async function load() {
  if (!props.item) return
  loading.value = true
  try {
    const [{ data: config }, { data: memberOptions }, { data: roleOptions }] = await Promise.all([
      messageSettingApi.getConfig(props.item.event),
      memberApi.options(),
      roleApi.options(),
    ])
    members.value = memberOptions
    roles.value = roleOptions
    if (config) assignConfig(config)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function addTime() {
  if (form.timeList.length >= 10) return
  form.timeList.push({ timeValue: 1, timeUnit: 'DAY' })
}

function removeTime(index: number) {
  form.timeList.splice(index, 1)
}

function validateTimeList(items: MessageReminderTime[]): boolean {
  if (items.some((item) => !Number.isInteger(item.timeValue) || item.timeValue < 1)) {
    ElMessage.warning('提前时间必须是大于 0 的整数')
    return false
  }
  if (new Set(items.map((item) => item.timeValue)).size !== items.length) {
    ElMessage.warning('提前时间不能重复')
    return false
  }
  return true
}

async function save() {
  if (!props.item) return
  if (props.item.timeConfigurable && !validateTimeList(form.timeList)) return
  if (form.roleEnable && form.roleIds.length === 0) {
    ElMessage.warning('请至少选择一个通知角色')
    return
  }
  saving.value = true
  try {
    const config: MessageTaskConfig = {
      timeList: props.item.timeConfigurable ? form.timeList.map((item) => ({ ...item })) : [],
      userIds: ['OWNER', ...selectedUserIds.value],
      roleIds: [...form.roleIds],
      ownerEnable: form.ownerEnable,
      ownerLevel: form.ownerLevel,
      roleEnable: form.roleEnable,
    }
    await messageSettingApi.update(props.item.event, {
      module: props.item.module,
      config,
    })
    ElMessage.success('通知范围已保存')
    visible.value = false
    emit('saved')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

watch(
  () => [props.modelValue, props.item?.event] as const,
  ([isVisible]) => {
    if (isVisible) void load()
  },
)
</script>

<template>
  <el-drawer
    v-model="visible"
    :title="`${item?.eventName ?? ''}配置`"
    size="560px"
    destroy-on-close
  >
    <div v-loading="loading" class="message-config-form">
      <template v-if="item?.timeConfigurable">
        <div class="section-title">时间配置</div>
        <div class="time-panel">
          <div v-for="(time, index) in form.timeList" :key="index" class="time-row">
            <span class="text-sm text-[var(--el-text-color-regular)]">距到期</span>
            <el-input-number
              v-model="time.timeValue"
              :min="1"
              :precision="0"
              controls-position="right"
            />
            <span class="text-sm text-[var(--el-text-color-regular)]">天</span>
            <el-button link :icon="Trash2" aria-label="删除提醒时间" @click="removeTime(index)" />
          </div>
          <el-button :icon="Plus" :disabled="form.timeList.length >= 10" @click="addTime">
            添加
          </el-button>
          <div class="mt-2 text-xs text-[var(--el-text-color-secondary)]">
            最多添加 10 条，提前天数不能重复
          </div>
        </div>
      </template>

      <div class="section-title">范围配置</div>
      <el-form label-position="top">
        <el-form-item label="通知人员">
          <el-select
            v-model="selectedUserIds"
            multiple
            filterable
            collapse-tags
            collapse-tags-tooltip
            class="w-full"
            placeholder="除负责人外，可增加指定成员"
          >
            <el-option label="负责人（固定）" value="OWNER" disabled />
            <el-option
              v-for="member in members"
              :key="member.id"
              :label="member.name"
              :value="member.id"
            />
          </el-select>
          <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
            负责人始终接收该场景通知
          </div>
        </el-form-item>

        <el-form-item>
          <div class="flex items-center gap-2">
            <el-checkbox v-model="form.ownerEnable">向负责人及以上</el-checkbox>
            <el-input-number
              v-model="form.ownerLevel"
              :min="0"
              :max="10000"
              :precision="0"
              :disabled="!form.ownerEnable"
              controls-position="right"
              class="!w-[110px]"
            />
            <span class="text-sm text-[var(--el-text-color-regular)]">级直属上级通知</span>
          </div>
          <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">0 代表直属上级</div>
        </el-form-item>

        <el-form-item>
          <div class="w-full">
            <el-checkbox v-model="form.roleEnable">按角色通知</el-checkbox>
            <el-select
              v-if="form.roleEnable"
              v-model="form.roleIds"
              multiple
              filterable
              class="mt-2 w-full"
              placeholder="选择角色"
            >
              <el-option v-for="role in roles" :key="role.id" :label="role.name" :value="role.id" />
            </el-select>
          </div>
        </el-form-item>
      </el-form>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" data-testid="message-config-save" @click="save">
        保存
      </el-button>
    </template>
  </el-drawer>
</template>

<style scoped>
.section-title {
  margin-bottom: 12px;
  color: var(--el-text-color-primary);
  font-weight: 600;
}

.section-title:not(:first-child) {
  margin-top: 24px;
}

.time-panel {
  padding: 16px;
  background: var(--el-fill-color-lighter);
  border: 1px solid var(--el-border-color-lighter);
}

.time-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
</style>
