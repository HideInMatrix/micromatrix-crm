# W3.7-9.3 DB-011 高级审批任务与动作源码审计

审计日期：2026-08-30

## 1. 审计范围

本审计只覆盖 DB-011：高级审批任务、动作、独立记录和附件。DB-012 的条件节点、动态审批人、字段权限、后置动作和 Webhook 不在本轮实现范围。

第一事实来源为项目内 `CordysCRM/` 源码：

- `backend/crm/src/main/resources/migration/1.7.0/ddl/V1.7.0_2__ga_ddl.sql`
- `approval/controller/ApprovalActionController.java`
- `approval/service/ApprovalActionService.java`
- `approval/domain/ApprovalTask.java`
- `approval/domain/ApprovalAddSignTask.java`
- `approval/domain/ApprovalReturnBackRecord.java`
- `approval/domain/ApprovalRecord.java`
- `approval/domain/ApprovalInstanceAttachment.java`
- `approval/dto/request/ApprovalActionRequest.java`
- `approval/dto/request/ApprovalAddSignRequest.java`
- `approval/dto/request/ApprovalReturnBackRequest.java`
- `approval/dto/request/ApprovalRevokeRequest.java`

## 2. Cordys 数据模型事实

### 2.1 ApprovalTask

Cordys `approval_task` 除实例、节点、审批人和状态外，还真实保存：

- `node_round`：节点轮次；
- `type`：`NL` 普通、`CC` 抄送、`SN` 加签、`BK` 退回；
- `action`：`APPROVE / REJECT / SIGN / BACK`；
- `create_time / update_time / create_user / update_user`。

MicroMatrix 当前只有 `nodeIndex/nodeName/taskType/status/comment/handledAt`，因此 9.3A 不能只扩 enum，必须补 round/action 与动作审计语义。

### 2.2 ApprovalRecord

Cordys 使用独立 `approval_record` 保存：

- `instance_id`
- `task_id`
- `node_id`
- `node_round`
- `result`
- `comment`
- 创建/更新时间与操作者

它不是 `approval_task.comment` 的别名。任务表示当前/历史待办状态，record 表示不可丢失的执行事实。

### 2.3 AddSign / ReturnBack / Attachment

`approval_add_sign_task`：

- `task_id`：加签任务；
- `sign_task_id`：被加签任务；
- `type`：BEFORE / AFTER；
- `root_task_id`：同一嵌套加签链根任务；
- `sort`：链内顺序；
- `comment`。

`approval_return_back_record`：

- `instance_id / task_id / return_to_node_id / return_reason / return_user_id`。

`approval_instance_attachment`：

- `instance_id / element_id / attachment_id`；
- `element_id` 可指具体动作元素，例如加签记录或退回记录，而不是只挂实例根节点。

## 3. Cordys Action API 事实

`ApprovalActionController` 暴露独立动作：

- `POST /approval-action/sign`
- `POST /approval-action/back`
- `POST /approval-action/revoke`
- `POST /approval-action/approve`
- `POST /approval-action/reject`
- `POST /approval-action/batch-approve`
- `POST /approval-action/batch-reject`

`ApprovalActionRequest` 包含 `task id + nodeId + instanceId + approverId + comment + attachmentIds`。

`ApprovalRevokeRequest` 只接收任务 ID。该 revoke 是“审批人撤回自己已执行的任务”，与 MicroMatrix 当前 `POST /approvals/:id/cancel` 的“提交人撤销整个申请”是两个不同动作，不能复用同一语义。

## 4. Cordys 状态机事实

### 4.1 approve / reject / record

`saveActionTask` 首先校验当前用户就是任务审批人，然后更新 task 的 `action/status`。

- APPROVE：task -> APPROVED，action -> APPROVE；
- REJECT：task -> UNAPPROVED，action -> REJECT；
- BACK：task 保持 PENDING，action -> BACK；
- SIGN BEFORE：原任务保持 PENDING，action -> SIGN；
- SIGN AFTER：原任务视为 APPROVED，action -> APPROVE。

除 BACK 与 BEFORE SIGN 外，动作会追加独立 `ApprovalRecord`。

### 4.2 BEFORE / AFTER 加签

Cordys 只有流程 `allowAddSign=true` 才允许加签。

嵌套加签通过 `rootTaskId + sort` 保持链路顺序：

- 普通任务第一次加签：root = 原任务，默认 sort 步长 100；
- 在加签任务上继续 BEFORE：在父 sort 之前插入；
- AFTER：在父任务与后一个加签任务之间取中值，无后继则 +100；
- 加签任务类型为 `SN`，完成后从同一 root 链继续取下一个待办。

### 4.3 节点退回

只有实例仍在审批中才能 back。

Cordys 会：

1. 为目标历史节点追加新一轮待办；
2. 清理“退回目标节点 -> 当前节点”之间已执行轮次的活动状态，但保留历史；
3. 写 `ApprovalReturnBackRecord`；
4. 当前任务写 BACK action；
5. 实例 current node 切回目标节点。

因此 nodeRound 是退回实现的前置条件，不能用覆盖旧 task 的方式模拟。

### 4.4 审批人任务撤回

Cordys revoke 先校验：

- 当前用户是目标 task.approver；
- flow `allowWithdraw=true`；
- 后续节点仍满足可撤回条件。

多人节点还会按 ALL / ANY / SEQUENTIAL 分别校验当前节点和下游任务是否已经继续执行。允许撤回时，当前 task 恢复审批中、action 清空，实例 current node 回到该任务节点，并清理需要重建的后续待办。

## 5. MicroMatrix 当前差异

当前已有：

- 普通 APPROVAL / CC task；
- approve / reject；
- 提交人 cancel；
- batch approve runtime；
- DB-010 通用资源恢复；
- flow 字段 `allowWithdraw / allowAddSign / allowBatchProcess / requireComment`。

当前缺失：

- task nodeRound；
- SN / BK task type；
- task action；
- 独立 ApprovalRecord；
- add-sign relation；
- return-back record；
- approver task revoke；
- action attachment relation；
- requireComment runtime gate。

`ApprovalFlowConfigService` 目前仍对 `allowBatchProcess / allowWithdraw / allowAddSign / requireComment` 的高级值统一返回 422。这个保护必须逐项等 runtime 验收后再移除，不能一次性全放开。

## 6. 实施边界

- DB-011 不重做 DB-010 资源快照；reject/cancel 的业务恢复继续复用现有 Resource boundary。
- 不在 9.3 提前实现 DB-012 的 SEQUENTIAL 流程设计器、条件分支或动态审批人；如果 Cordys revoke 对 SEQUENTIAL 有额外语义，当前只能在现有可表达节点模式范围内实现并明确 fail-closed。
- 历史 task/record 必须可追溯，退回和撤回不得物理覆盖掉已经完成的动作事实。
- 所有动作必须同时校验 tenant、instance、task owner、实例状态与任务状态，并防重复请求。

## 7. 审计结论

DB-011 是独立运行时缺口。正确顺序是：先建立 task round/action + ApprovalRecord，再实现加签、退回和审批人 revoke，最后接 requireComment/附件并逐项开放对应流程配置。只有专项 Rules/API/Browser、59+ 后续 migrations 空库 replay 和既有四业务审批回归全绿后才能标记 `VERIFIED`。
