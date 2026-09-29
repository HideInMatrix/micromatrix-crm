<script setup lang="ts">
import type { FieldVO, ModuleFormProp } from '@micromatrix/shared'
import { ref, watch } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'

const visible = defineModel<boolean>({ required: true })
type LeadUniqueScope = NonNullable<ModuleFormProp['leadUniqueScope']>

const loading = ref(false)
const saving = ref(false)
const scope = ref<LeadUniqueScope>('RESOURCE_POOL')
const uniqueFields = ref<FieldVO[]>([])

async function load() {
  loading.value = true
  try {
    const { data } = await metadataApi.formConfig('lead')
    scope.value = data.formProp.leadUniqueScope ?? 'RESOURCE_POOL'
    uniqueFields.value = data.fields.filter((field) => field.config?.unique)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    await metadataApi.updateFormProp('lead', { leadUniqueScope: scope.value })
    ElMessage.success('线索判重设置已保存')
    visible.value = false
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

watch(visible, (open) => {
  if (open) void load()
})
</script>

<template>
  <el-drawer v-model="visible" title="线索判重设置" size="640px" destroy-on-close>
    <div v-loading="loading" class="space-y-6">
      <el-alert
        type="info"
        :closable="false"
        title="字段是否参与判重仍在线索表单设置中通过“唯一值”控制；这里只设置唯一字段的入库校验范围。"
      />

      <section>
        <div class="mb-3 text-sm font-medium">唯一值校验范围</div>
        <el-radio-group v-model="scope" class="flex !flex-col !items-start gap-3">
          <el-radio value="RESOURCE_POOL">
            <div>
              <div>按目标线索池判重</div>
              <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
                同一线索池内唯一；不同且互相隔离的线索池允许相同唯一值。
              </div>
            </div>
          </el-radio>
          <el-radio value="ORGANIZATION">
            <div>
              <div>按整个组织判重</div>
              <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
                所有线索共用唯一值；任一线索池存在相同值都会阻止入库。
              </div>
            </div>
          </el-radio>
        </el-radio-group>
      </section>

      <section>
        <div class="mb-3 text-sm font-medium">当前唯一字段</div>
        <div v-if="uniqueFields.length" class="flex flex-wrap gap-2">
          <el-tag v-for="field in uniqueFields" :key="field.id">{{ field.label }}</el-tag>
        </div>
        <el-empty v-else description="暂无；请在线索表单设置中为需要判重的字段开启“唯一值”" />
      </section>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-drawer>
</template>
