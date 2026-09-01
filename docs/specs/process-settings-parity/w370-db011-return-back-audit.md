# W3.7-9.3C DB-011 节点退回源码审计

审计日期：2026-09-01

## 1. 审计范围

本单元只实现 Cordys 审批人的“退回到历史审批节点”，不提前实现 9.3D 审批人任务撤回，也不提前实现 9.3E `requireComment` / 审批附件。

第一事实来源：

- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/approval/service/ApprovalActionService.java`
- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/approval/service/ApprovalInstanceService.java`
- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/approval/domain/ApprovalReturnBackRecord.java`
- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/approval/dto/request/ApprovalReturnBackRequest.java`
- `CordysCRM/backend/crm/src/main/java/cn/cordys/crm/approval/mapper/ExtApprovalInstanceMapper.xml`

## 2. Cordys BACK 动作事实

`ApprovalActionService.back()` 的执行顺序是：

1. 读取审批实例；
2. `backProcess()` 重建退回目标节点任务并清理目标节点到当前节点之间的活动路径；
3. `saveBackRecord()` 写独立 `ApprovalReturnBackRecord`；
4. `saveActionTask(... ApprovalAction.BACK ...)` 把执行退回的原任务写成 `action=BACK`；
5. 实例 current node 回到 `returnToNodeId`；
6. 附件属于后续独立能力，不在 9.3C 提前实现。

BACK 与普通 approve/reject 的关键差异：

- BACK 不生成 `ApprovalRecord`；
- 原任务保留为历史工作项，并记录 `action=BACK`；
- 退回原因属于 `ApprovalReturnBackRecord`，不能重新塞回 task comment；
- 已完成的 `ApprovalRecord` 不被覆盖或删除。

## 3. ApprovalReturnBackRecord

Cordys Domain 保存：

- `id`
- `instanceId`
- `taskId`
- `returnToNodeId`
- `returnReason`
- `returnUserId`

`saveBackRecord()` 在写入前删除同一 `instanceId + returnToNodeId` 的旧记录，因此同一实例退回同一目标节点时只保留**最新一条退回记录**；审批 task / ApprovalRecord 的历史轮次仍完整保留。

MicroMatrix 对应模型增加 tenant 隔离、创建/更新时间和外键，但不增加 Cordys 不存在的业务状态字段。

## 4. nodeRound 重建

Cordys `ExtApprovalInstanceMapper` 对节点轮次使用 task 与 record 的最大 `node_round`：

- 查询当前最大轮次：`max(node_round)`；
- 再次进入节点：`max(task round, record round) + 1`。

因此 9.3C 不能只在 BACK API 创建 round+1 的目标任务，还必须修复普通 `advance()`：当流程从被退回节点再次向后流转到曾经执行过的节点时，下游节点也必须进入新 round，而不是重新写回 round 1。

示例：

```text
一级审批 round 1 -> 二级审批 round 1
                         |
                         BACK
                         v
一级审批 round 2 -> 二级审批 round 2
                         |
                         BACK
                         v
一级审批 round 3 -> 二级审批 round 3
```

历史 round 1/2 的 task 与 ApprovalRecord 都必须继续可追溯。

## 5. 活动任务边界

当前 MicroMatrix task status 没有 Cordys 内部用于路径重建的完全同构状态，因此 9.3C 采用现有可表达状态：

- 执行 BACK 的源任务保持 `PENDING + action=BACK`，用于动作历史；
- `my-pending` 明确排除 `action=BACK`，避免退回后的旧任务继续出现在待办；
- `my-handled` 纳入 `PENDING + BACK`，使操作人仍可查看已执行退回；
- 目标节点到当前节点区间内其余活动 PENDING task 置为 `SKIPPED`；
- ALL/ANY 完成判断必须同时限定当前 `nodeRound`，旧轮次不能阻塞新轮次。

该映射不物理删除历史动作事实，也不新增伪造 Cordys 业务状态。

## 6. 安全与合法性门槛

节点退回必须同时满足：

- 实例仍为 PENDING；
- 当前用户是当前 PENDING 普通 APPROVAL task 的 owner；
- tenant 与 instance / task 一致；
- SIGN / CC 不允许直接执行节点退回；
- 目标 nodeId 属于当前实例冻结 `nodesSnapshot`；
- 目标节点位于当前节点之前；
- 目标节点存在历史 `ApprovalRecord`，即真实执行过；
- 已执行 BACK 的旧 task 重复调用必须拒绝；
- 目标节点当前仍能解析出有效审批人，否则 fail-closed。

## 7. API 与页面边界

MicroMatrix 增加：

```text
POST /approvals/tasks/:id/back
{
  "returnToNodeId": "...",
  "comment": "可选退回原因"
}
```

审批详情返回：

- `returnBackRecords`
- `returnBackTargets`
- `canReturnBack`

PC 与 Mobile 只在当前普通审批待办存在合法历史目标时展示退回入口；目标列表直接显示下一轮次，不把未执行/未来节点暴露成可选项。

## 8. 结论

9.3C 的正确实现不是“把 currentNodeIndex 改小”，而是完整执行：**动作审计 + 最新退回记录 + 活动路径失效 + 目标节点新 round + 后续节点 round 重建 + 历史记录不可变**。

完成该单元后 DB-011 仍不能关闭，下一执行单元是 **9.3D 审批人任务撤回**。
