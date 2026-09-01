# W3.7-9.3D DB-011 审批人任务撤回源码审计

审计日期：2026-09-01

## 1. 审计范围

本单元只实现 Cordys 的“审批人撤回自己已经执行的普通审批任务”，不复用提交人的整单 `cancel/revoke`，也不提前实现 9.3E `requireComment` / 审批附件。

第一事实来源：

- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/approval/controller/ApprovalActionController.java`
- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/approval/service/ApprovalActionService.java`
- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/approval/constants/ApprovalAction.java`
- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/approval/dto/request/ApprovalRevokeRequest.java`
- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/approval/mapper/ExtApprovalInstanceMapper.xml`

## 2. Cordys REVOKE 动作事实

`ApprovalActionController` 使用独立 `/approval-action/revoke`，请求只需要已执行任务 ID；它和业务资源撤回、提交人撤销审批实例不是同一动作。

`ApprovalActionService.revoke()` 的执行顺序是：

1. 按 task ID 读取原任务；
2. 校验当前用户就是 `task.approverId`；
3. 读取实例与审批流，并要求 `allowWithdraw=true`；
4. `revokeProcess()` 校验当前节点/下一节点是否仍处于可逆状态，并清理后续失效任务；
5. `refreshRevokeTask()` 将原任务重新置为审批中，同时把 task `action` 清空，实例 current node 回到原任务节点；
6. `saveLogAndNotice(... ApprovalAction.REVOKE)` 记录撤回操作日志/通知。

关键事实：Cordys 的 `ApprovalAction` 枚举虽然包含 `REVOKE`，但 **REVOKE 不会作为撤回后 task 的持久 action**。`refreshRevokeTask()` 明确执行 `action=null`，因此 MicroMatrix 不应为了 9.3D 给 `ApprovalTaskAction` 增加 REVOKE。

## 3. ApprovalRecord 事实

审批人撤回本身不会新增一条 `ApprovalRecord`，也不会删除原任务已经产生的审批记录。原任务恢复为待审批后，如果再次审批，Cordys 的 `saveApprovalRecord()` 会处理同 task / node / round 的既有记录。

MicroMatrix 9.3A 已把 `ApprovalRecord` 从 task 中拆为独立执行记录。9.3D 继续按 Cordys 的“同一 task / node / round 是同一个可重新执行槽位”语义处理：

- 撤回时保留原 APPROVE record；
- 不制造不存在于 Cordys approval record 模型中的 REVOKE record；
- 撤回后再次 APPROVE 且没有新的意见/附件时，继续保留原 record；
- 如果再次执行产生新的意见，或从原 APPROVE 改为 REJECT，则按 Cordys `saveApprovalRecord()` 先删除同 `instance + task + node + round` 的旧 record，再创建新 record；不能无条件追加重复记录；
- REVOKE 操作事实由独立 API 的 `@LogOperation('approval', 'revoke')` 记录，不污染 task action / ApprovalRecord。

## 4. 可撤回状态机

Cordys 对多人节点按模式分别处理：

- `ALL`：只有当前多人节点仍处于审批中时，已通过成员才能撤回；当前节点已经整体完成并流转后禁止撤回。
- `ANY`：原节点通过后已经流转到下一节点，但下一节点必须仍处于审批中；否则禁止撤回。
- `SEQUENTIAL`：还要求撤回人的下一位审批任务尚未执行，并会删除该下一位待办后重建。MicroMatrix 当前 `ApprovalMode` 只有 `ALL / ANY`，因此不在 9.3D 臆造 SEQUENTIAL 规则。
- 单人节点：下一节点不能已经结束；若下一节点是审批节点，则该节点必须仍处于审批中。

MicroMatrix 对应的 fail-closed 条件：

- 实例必须仍为 `PENDING`；
- task 必须属于当前 tenant、当前用户、`taskType=APPROVAL`、`status=APPROVED`、`action=APPROVE`；
- flow 必须仍存在且 `allowWithdraw=true`；
- task 必须带稳定 nodeId，且 nodeIndex 能对应冻结 `nodesSnapshot`；
- `ALL` 只允许当前实例仍停在同一 nodeIndex / nodeRound 且该轮还有活动待办时撤回；
- `ANY` / 单人等价路径只允许实例当前仍停在后继审批节点，且该活动节点仍有 PENDING 普通/加签任务；已结束实例或已经继续流转到更后节点的旧 task 不允许撤回。

## 5. 下游任务清理与 nodeRound 映射

Cordys `clearExpiredNode()` 会把下游当前轮次做“假删除”：

- 已完成 task 的 `node_round -> -1`；
- 审批中 task 的 `status -> NONE, node_round -> -1`；
- 同轮 `approval_record.node_round -> -1`。

MicroMatrix 已在 9.3A/9.3C 采用“历史 task/record/round 不可覆盖”的模型，因此不复制 `node_round=-1`。9.3D 的映射是：

- 原撤回 task：同一 round 恢复 `PENDING + action=null + handledAt=null`；
- 下游当前活动 round 的 PENDING task（含 APPROVAL/SIGN/CC）置为 `SKIPPED`；
- 下游已经完成的 task / ApprovalRecord 保持原 round，作为已经发生但被后续撤回失效的历史事实；撤回源 task 本身如果再次执行，则按上一节的同槽位 record 替换规则处理；
- 实例 `currentNodeIndex` 回到撤回 task 的 nodeIndex；
- 原任务再次通过后，`advance()` 复用 9.3C 的 `nextApprovalNodeRound()`，下游节点以新 round 重建，旧轮次不会参与新轮次完成判断。

该映射避免物理删除或改写历史记录，同时保持当前活动路径唯一。

## 6. API / VO / UI 边界

新增 API：

```text
POST /approvals/tasks/:id/revoke
```

无请求体，task ID 就是唯一动作目标。

审批详情增加：

- `canWithdraw`
- `myWithdrawTaskId`

服务端仍会完整重验 owner / tenant / flow / task / instance / downstream 状态，VO capability 只用于 PC/Mobile 控制按钮显示，不能作为权限依据。

流程设置只有在 9.3D 专项验收通过后才从高级配置 422 门禁中移除 `allowWithdraw`；`allowBatchProcess / requireComment / duplicateApproverRule != FIRST_ONLY` 继续 fail-closed。

## 7. 结论

9.3D 不需要数据库结构变更。正确实现是：**独立 approver revoke API + allowWithdraw 硬 gate + 已通过 task 精确回开 + 下游活动轮次失效 + currentNodeIndex 回退 + ApprovalRecord 历史保留 + PC/Mobile capability**。

完成本单元后 DB-011 仍不能关闭，下一执行单元是 **9.3E requireComment / Attachment / UI 与关闭验收**。
