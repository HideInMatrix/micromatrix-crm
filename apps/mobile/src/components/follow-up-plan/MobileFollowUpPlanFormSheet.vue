<script setup lang="ts">
import type { FollowUpPlanTargetType } from '@micromatrix/shared'
import { toRef } from 'vue'
import MobileDynamicForm from '@/components/MobileDynamicForm.vue'
import MobileFollowUpPlanSystemField from '@/components/MobileFollowUpPlanSystemField.vue'
import { useMobileFollowUpPlanForm } from '@/composables/useMobileFollowUpPlanForm'

const props = defineProps<{
  targetType?: FollowUpPlanTargetType
  targetId?: string
  targetName?: string
}>()

const emit = defineEmits<{
  (event: 'saved'): void
}>()

const form = useMobileFollowUpPlanForm(
  toRef(props, 'targetType'),
  toRef(props, 'targetId'),
  toRef(props, 'targetName'),
  () => emit('saved'),
)

function close() {
  form.show.value = false
}

defineExpose({
  open: form.open,
})
</script>

<template>
  <van-popup v-model:show="form.show.value" position="bottom" round class="h-[82%]">
    <div class="flex h-full flex-col bg-[var(--text-n10)]">
      <div
        class="flex min-h-12 items-center justify-center border-b-[0.5px] border-[var(--text-n8)] px-4 text-base font-medium text-[var(--text-n1)]"
      >
        {{ form.editing.value ? '编辑跟进计划' : '新建跟进计划' }}
      </div>

      <div class="min-h-0 flex-1 overflow-auto py-4" data-testid="mobile-follow-plan-dynamic-fields">
        <MobileDynamicForm
          v-model="form.formModel.value"
          :fields="form.fields.value"
          :members="form.fieldRefs.members.value"
          :dept-tree="form.fieldRefs.deptTree.value"
          :field-filter="form.fieldFilter"
        >
          <template #system-field="{ field, value, setValue }">
            <MobileFollowUpPlanSystemField
              :field="field"
              :model-value="value"
              :target-locked="form.targetLocked.value"
              :targets="form.targets.value"
              :contacts="form.contacts.value"
              :members="form.fieldRefs.members.value"
              @update:model-value="setValue"
            />
          </template>
        </MobileDynamicForm>
      </div>

      <div
        class="flex gap-3 border-t-[0.5px] border-[var(--text-n8)] bg-[var(--text-n10)] px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]"
      >
        <van-button block @click="close">取消</van-button>
        <van-button
          data-testid="mobile-follow-plan-save"
          type="primary"
          block
          :loading="form.saving.value"
          @click="form.save"
        >
          保存
        </van-button>
      </div>
    </div>
  </van-popup>
</template>

