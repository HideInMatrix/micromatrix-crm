<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import draggable from 'vuedraggable'
import { extractErrorMessage } from '@/api/http'
import {
  opportunityStageSettingsApi,
  type OpportunityStageConfigItemVO,
} from '@/api/system'

const visible = defineModel<boolean>({ required: true })
const loading = ref(false)
const saving = ref(false)
const rows = ref<OpportunityStageConfigItemVO[]>([])
const afootRollBack = ref(true)
const endRollBack = ref(false)
const dialogVisible = ref(false)
const editingId = ref('')
const form = reactive({ name: '', rate: 10 })

async function load() {
  loading.value = true
  try {
    const { data } = await opportunityStageSettingsApi.get()
    rows.value = data.stageConfigList
    afootRollBack.value = data.afootRollBack
    endRollBack.value = data.endRollBack
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingId.value = ''
  Object.assign(form, { name: '', rate: 10 })
  dialogVisible.value = true
}

function openEdit(row: OpportunityStageConfigItemVO) {
  editingId.value = row.id
  Object.assign(form, { name: row.name, rate: Number(row.rate) })
  dialogVisible.value = true
}

async function save() {
  if (!form.name.trim()) return ElMessage.warning('请输入阶段名称')
  saving.value = true
  try {
    if (editingId.value) {
      await opportunityStageSettingsApi.update({ id: editingId.value, name: form.name.trim(), rate: String(form.rate) })
    } else {
      const target = [...rows.value].reverse().find((row) => row.type === 'AFOOT')
      await opportunityStageSettingsApi.add({
        name: form.name.trim(),
        type: 'AFOOT',
        rate: String(form.rate),
        dropPosition: 1,
        targetId: target?.id,
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

async function remove(row: OpportunityStageConfigItemVO) {
  const ok = await ElMessageBox.confirm(`确定删除阶段「${row.name}」吗？`, '删除阶段', { type: 'warning' }).catch(() => false)
  if (!ok) return
  try {
    await opportunityStageSettingsApi.remove(row.id)
    ElMessage.success('阶段已删除')
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function updateRollback() {
  try {
    await opportunityStageSettingsApi.updateRollback({
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
    await opportunityStageSettingsApi.sort(rows.value.map((row) => row.id))
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    await load()
  }
}

watch(visible, (open) => { if (open) void load() })
</script>

<template>
  <el-drawer v-model="visible" title="商机阶段设置" size="720px" destroy-on-close data-testid="opportunity-stage-settings-drawer">
    <el-alert class="mb-4" type="info" :closable="false" title="最多 15 个阶段；至少保留一个进行中阶段。成功/失败为 END 阶段，分别使用 100% / 0% 赢率。" />
    <div class="mb-4 flex items-center justify-between gap-4">
      <div class="flex items-center gap-5">
        <span class="flex items-center gap-2 text-sm">进行中允许回退 <el-switch v-model="afootRollBack" @change="updateRollback" /></span>
        <span class="flex items-center gap-2 text-sm">完结后允许回退 <el-switch v-model="endRollBack" @change="updateRollback" /></span>
      </div>
      <el-button type="primary" :disabled="rows.length >= 15" @click="openCreate">添加阶段</el-button>
    </div>
    <div v-loading="loading">
      <draggable v-model="rows" item-key="id" handle=".stage-drag" @end="sort">
        <template #item="{ element: row }">
          <div class="mb-2 flex items-center gap-3 rounded border border-[var(--el-border-color)] p-3">
            <span class="stage-drag cursor-move text-[var(--el-text-color-secondary)]">⋮⋮</span>
            <span class="min-w-0 flex-1 truncate">{{ row.name }}</span>
            <el-tag :type="row.type === 'END' ? (Number(row.rate) === 100 ? 'success' : 'danger') : 'primary'" size="small">{{ row.type }}</el-tag>
            <span class="w-16 text-right text-sm">{{ row.rate }}%</span>
            <span class="w-20 text-xs text-[var(--el-text-color-secondary)]">{{ row.stageHasData ? '已有数据' : '暂无数据' }}</span>
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" :disabled="row.type === 'END' || row.stageHasData" @click="remove(row)">删除</el-button>
          </div>
        </template>
      </draggable>
    </div>
    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑阶段' : '添加阶段'" width="420px" append-to-body>
      <el-form label-width="80px">
        <el-form-item label="阶段名称" required><el-input v-model="form.name" maxlength="16" /></el-form-item>
        <el-form-item label="赢率" required><el-input-number v-model="form.rate" :min="0" :max="100" :step="5" class="!w-full" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialogVisible = false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存</el-button></template>
    </el-dialog>
  </el-drawer>
</template>
