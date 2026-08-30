<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import draggable from 'vuedraggable'
import { extractErrorMessage } from '@/api/http'
import {
  contractStageSettingsApi,
  type ContractStageAdvancedRowVO,
  type ContractStageConfigItemVO,
} from '@/api/system'

const visible = defineModel<boolean>({ required: true })
const loading = ref(false)
const saving = ref(false)
const rows = ref<ContractStageConfigItemVO[]>([])
const afootRollBack = ref(true)
const endRollBack = ref(false)
const circulationType = ref<'NORMAL' | 'ADVANCED'>('NORMAL')
const advancedConfigs = ref<ContractStageAdvancedRowVO[]>([])
const dialogVisible = ref(false)
const editingId = ref('')
const form = reactive({ name: '' })

const advancedMap = computed(() => {
  const map = new Map<string, Map<string, boolean>>()
  for (const row of advancedConfigs.value) {
    map.set(row.originId, new Map(row.targets.map((target) => [target.targetId, target.enable])))
  }
  return map
})

async function load() {
  loading.value = true
  try {
    const { data } = await contractStageSettingsApi.get()
    rows.value = data.stageConfigList
    afootRollBack.value = data.afootRollBack
    endRollBack.value = data.endRollBack
    circulationType.value = data.circulationType
    advancedConfigs.value = data.advancedConfigs ?? []
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingId.value = ''
  form.name = ''
  dialogVisible.value = true
}

function openEdit(row: ContractStageConfigItemVO) {
  editingId.value = row.id
  form.name = row.name
  dialogVisible.value = true
}

async function save() {
  if (!form.name.trim()) return ElMessage.warning('请输入阶段名称')
  saving.value = true
  try {
    if (editingId.value) {
      await contractStageSettingsApi.update({ id: editingId.value, name: form.name.trim() })
    } else {
      const target = [...rows.value].reverse().find((row) => row.type === 'AFOOT')
      await contractStageSettingsApi.add({
        name: form.name.trim(),
        type: 'AFOOT',
        targetId: target?.id,
        dropPosition: 1,
      })
    }
    dialogVisible.value = false
    ElMessage.success(editingId.value ? '阶段已更新' : '阶段已添加')
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

async function remove(row: ContractStageConfigItemVO) {
  const ok = await ElMessageBox.confirm(`确定删除阶段「${row.name}」吗？`, '删除阶段', { type: 'warning' }).catch(() => false)
  if (!ok) return
  try {
    await contractStageSettingsApi.remove(row.id)
    ElMessage.success('阶段已删除')
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function updateRollback() {
  try {
    await contractStageSettingsApi.updateRollback({
      afootRollBack: afootRollBack.value,
      endRollBack: endRollBack.value,
    })
    ElMessage.success('回退设置已保存')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    await load()
  }
}

async function sort() {
  try {
    await contractStageSettingsApi.sort(rows.value.map((row) => row.id))
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    await load()
  }
}

async function changeCirculationType(value: 'NORMAL' | 'ADVANCED') {
  try {
    await contractStageSettingsApi.switchCirculationType(value)
    circulationType.value = value
    ElMessage.success(value === 'ADVANCED' ? '已切换为高级流转' : '已切换为基础流转')
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    await load()
  }
}

function transitionEnabled(originId: string, targetId: string) {
  return advancedMap.value.get(originId)?.get(targetId) ?? false
}

function setTransition(originId: string, targetId: string, enable: boolean) {
  let row = advancedConfigs.value.find((item) => item.originId === originId)
  if (!row) {
    row = { originId, moduleType: 'contract', targets: [] }
    advancedConfigs.value.push(row)
  }
  const target = row.targets.find((item) => item.targetId === targetId)
  if (target) target.enable = enable
  else row.targets.push({ targetId, enable, circulationFieldValues: [] })
}

async function saveAdvanced() {
  saving.value = true
  try {
    await contractStageSettingsApi.saveAdvancedConfig({
      circulationType: 'ADVANCED',
      circulationSettings: rows.value.map((origin) => ({
        originId: origin.id,
        targets: rows.value
          .filter((target) => target.id !== origin.id)
          .map((target) => ({
            targetId: target.id,
            enable: transitionEnabled(origin.id, target.id),
            circulationFieldValues: advancedConfigs.value
              .find((item) => item.originId === origin.id)
              ?.targets.find((item) => item.targetId === target.id)
              ?.circulationFieldValues ?? [],
          })),
      })),
    })
    ElMessage.success('高级流转设置已保存')
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

</script>

<template>
  <el-drawer v-model="visible" title="合同阶段设置" size="820px" destroy-on-close data-testid="contract-stage-settings-drawer" @open="load">
    <el-alert class="mb-4" type="info" :closable="false" title="最多 15 个合同阶段。进行中阶段可新增、改名、排序；已有合同数据的阶段禁止删除。" />

    <div class="mb-4 flex flex-wrap items-center justify-between gap-4">
      <div class="flex flex-wrap items-center gap-5">
        <span class="flex items-center gap-2 text-sm">进行中允许回退 <el-switch v-model="afootRollBack" @change="updateRollback" /></span>
        <span class="flex items-center gap-2 text-sm">完结后允许回退 <el-switch v-model="endRollBack" @change="updateRollback" /></span>
        <span class="flex items-center gap-2 text-sm">
          流转模式
          <el-radio-group :model-value="circulationType" size="small" @change="changeCirculationType($event as 'NORMAL' | 'ADVANCED')">
            <el-radio-button value="NORMAL">基础流转</el-radio-button>
            <el-radio-button value="ADVANCED">高级流转</el-radio-button>
          </el-radio-group>
        </span>
      </div>
      <el-button type="primary" :disabled="rows.length >= 15" @click="openCreate">添加阶段</el-button>
    </div>

    <div v-loading="loading">
      <draggable v-model="rows" item-key="id" handle=".stage-drag" @end="sort">
        <template #item="{ element: row }">
          <div class="mb-2 flex items-center gap-3 rounded border border-[var(--el-border-color)] p-3">
            <span class="stage-drag cursor-move text-[var(--el-text-color-secondary)]">⋮⋮</span>
            <span class="min-w-0 flex-1 truncate">{{ row.name }}</span>
            <el-tag :type="row.type === 'END' ? 'warning' : 'primary'" size="small">{{ row.type }}</el-tag>
            <span class="w-20 text-xs text-[var(--el-text-color-secondary)]">{{ row.stageHasData ? '已有数据' : '暂无数据' }}</span>
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" :disabled="row.type === 'END' || row.stageHasData" @click="remove(row)">删除</el-button>
          </div>
        </template>
      </draggable>

      <div v-if="circulationType === 'ADVANCED'" class="mt-5">
        <div class="mb-2 flex items-center justify-between">
          <div>
            <div class="font-medium">高级阶段流转</div>
            <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">勾选允许的“源阶段 → 目标阶段”流转关系；同阶段无需配置。</div>
          </div>
          <el-button type="primary" :loading="saving" @click="saveAdvanced">保存高级流转</el-button>
        </div>
        <el-table :data="rows" border>
          <el-table-column prop="name" label="源阶段" fixed width="150" />
          <el-table-column v-for="target in rows" :key="target.id" :label="target.name" min-width="110" align="center">
            <template #default="{ row }">
              <span v-if="row.id === target.id" class="text-[var(--el-text-color-placeholder)]">—</span>
              <el-checkbox
                v-else
                :model-value="transitionEnabled(row.id, target.id)"
                @change="setTransition(row.id, target.id, Boolean($event))"
              />
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑阶段' : '添加阶段'" width="420px" append-to-body>
      <el-form label-width="80px">
        <el-form-item label="阶段名称" required><el-input v-model="form.name" maxlength="255" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialogVisible = false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存</el-button></template>
    </el-dialog>
  </el-drawer>
</template>
