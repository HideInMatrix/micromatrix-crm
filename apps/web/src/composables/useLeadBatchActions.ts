import type { LeadVO } from '@micromatrix/shared'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Ref } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { leadApi } from '@/api/sales'

interface LeadBatchOptions {
  selectedRows: Ref<LeadVO[]>
  isPoolMode: Readonly<Ref<boolean>>
  selectedPoolId: Ref<string>
  batchEditVisible: Ref<boolean>
  batchTransferVisible: Ref<boolean>
  transferSaving: Ref<boolean>
  moveToPoolTarget: Ref<LeadVO | null>
  moveToPoolBatch: Ref<boolean>
  moveToPoolVisible: Ref<boolean>
  batchPoolAssignVisible: Ref<boolean>
  loadData: () => Promise<void>
}

/** 线索列表批量操作：由父视图提供选择状态、弹窗状态和刷新回调。 */
export function useLeadBatchActions({
  selectedRows,
  isPoolMode,
  selectedPoolId,
  batchEditVisible,
  batchTransferVisible,
  transferSaving,
  moveToPoolTarget,
  moveToPoolBatch,
  moveToPoolVisible,
  batchPoolAssignVisible,
  loadData,
}: LeadBatchOptions) {
  async function handleBatchEdit(payload: { fieldId: string; fieldValue: unknown }) {
    if (selectedRows.value.length === 0) return
    try {
      const ids = selectedRows.value.map((row) => row.id)
      if (isPoolMode.value) {
        if (!selectedPoolId.value) throw new Error('请先选择线索池')
        await leadApi.poolBatchUpdate({ poolId: selectedPoolId.value, ids, ...payload })
      } else {
        await leadApi.batchUpdate({ ids, ...payload })
      }
      ElMessage.success(`已修改 ${selectedRows.value.length} 条线索`)
      batchEditVisible.value = false
      await loadData()
    } catch (error) {
      ElMessage.error(extractErrorMessage(error))
    }
  }

  async function handleBatchDelete() {
    if (selectedRows.value.length === 0) return
    const selected = [...selectedRows.value]
    const convertedCount = selected.filter((row) => row.transitionType === 'CUSTOMER').length
    const convertedHint = convertedCount
      ? `其中 ${convertedCount} 条已转化为客户，将强制删除原线索，但不会删除或修改对应客户。`
      : ''
    const confirmed = await ElMessageBox.confirm(
      `确定永久删除所选 ${selected.length} 条线索？${convertedHint}此操作不可恢复。`,
      '批量删除线索',
      { type: 'warning', confirmButtonText: '确认删除', confirmButtonClass: 'el-button--danger' },
    ).catch(() => false)
    if (!confirmed) return
    try {
      const ids = selected.map((row) => row.id)
      if (isPoolMode.value) {
        if (!selectedPoolId.value) throw new Error('请先选择线索池')
        await leadApi.poolBatchDelete(selectedPoolId.value, ids)
      } else {
        await leadApi.batchDelete(ids)
      }
      ElMessage.success(`已删除 ${selected.length} 条线索`)
      await loadData()
    } catch (error) {
      ElMessage.error(extractErrorMessage(error))
    }
  }

  function openBatchTransfer() {
    if (selectedRows.value.length === 0) return
    batchTransferVisible.value = true
  }

  async function handleBatchTransferConfirm(userId: string, note: string) {
    if (selectedRows.value.length === 0 || transferSaving.value) return
    transferSaving.value = true
    try {
      const count = selectedRows.value.length
      await leadApi.batchTransfer(
        selectedRows.value.map((row) => row.id),
        userId,
        note,
      )
      batchTransferVisible.value = false
      ElMessage.success(`已转移 ${count} 条线索`)
      await loadData()
    } catch (error) {
      ElMessage.error(extractErrorMessage(error))
    } finally {
      transferSaving.value = false
    }
  }

  function handleBatchToPool() {
    if (selectedRows.value.length === 0) return
    moveToPoolTarget.value = null
    moveToPoolBatch.value = true
    moveToPoolVisible.value = true
  }

  async function confirmMoveToPool(poolId?: string, reasonId?: string) {
    try {
      if (moveToPoolBatch.value) {
        const { data } = await leadApi.batchToPool(
          selectedRows.value.map((row) => row.id),
          poolId,
          reasonId,
        )
        if (data.fail > 0) ElMessage.warning(`成功 ${data.success} 条，失败 ${data.fail} 条`)
        else ElMessage.success(`已将 ${data.success} 条线索移入线索池`)
      } else if (moveToPoolTarget.value) {
        await leadApi.toPool(moveToPoolTarget.value.id, poolId, reasonId)
        ElMessage.success('已移入线索池')
      }
      moveToPoolVisible.value = false
      await loadData()
    } catch (error) {
      ElMessage.error(extractErrorMessage(error))
    }
  }

  async function handleBatchPick() {
    if (!selectedPoolId.value || selectedRows.value.length === 0) return
    const confirmed = await ElMessageBox.confirm(
      `确定领取已选择的 ${selectedRows.value.length} 条线索？`,
      '批量领取',
      { type: 'warning', confirmButtonText: '领取' },
    ).catch(() => false)
    if (!confirmed) return
    try {
      const { data } = await leadApi.poolBatchPick(
        selectedPoolId.value,
        selectedRows.value.map((row) => row.id),
      )
      if (data.fail > 0) ElMessage.warning(`成功 ${data.success} 条，失败 ${data.fail} 条`)
      else ElMessage.success(`已领取 ${data.success} 条线索`)
      await loadData()
    } catch (error) {
      ElMessage.error(extractErrorMessage(error))
    }
  }

  function openBatchPoolAssign() {
    if (!selectedPoolId.value || selectedRows.value.length === 0) return
    batchPoolAssignVisible.value = true
  }

  async function handleBatchPoolAssignConfirm(userId: string) {
    if (!selectedPoolId.value || selectedRows.value.length === 0) return
    try {
      const { data } = await leadApi.poolBatchAssign(
        selectedPoolId.value,
        selectedRows.value.map((row) => row.id),
        userId,
      )
      batchPoolAssignVisible.value = false
      if (data.fail > 0) ElMessage.warning(`成功 ${data.success} 条，失败 ${data.fail} 条`)
      else ElMessage.success(`已分配 ${data.success} 条线索`)
      await loadData()
    } catch (error) {
      ElMessage.error(extractErrorMessage(error))
    }
  }

  return {
    handleBatchEdit,
    handleBatchDelete,
    openBatchTransfer,
    handleBatchTransferConfirm,
    handleBatchToPool,
    confirmMoveToPool,
    handleBatchPick,
    openBatchPoolAssign,
    handleBatchPoolAssignConfirm,
  }
}
