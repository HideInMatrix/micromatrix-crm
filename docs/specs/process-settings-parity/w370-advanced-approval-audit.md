# W3.7.0 高级审批源码与运行时差异审计

## 1. 审计目标

本审计以项目内 `CordysCRM/` 源码为第一事实来源，对 W2.5 留下的 DB-010、DB-011、DB-012 做重新核对，并结合 W3.6.2～W3.6.6 已经落地的报价、合同、发票、订单审批运行时修正旧台账描述。

本阶段不因为 Prisma/DTO 中已经存在字段就认定能力完成；只有真实运行时、API、页面和测试均接通后，相关能力才能从 deferred backlog 关闭。

## 2. 当前 MicroMatrix 已有审批基线

当前并非从零开始。W2.5 与 W3.6 已经真实完成：

- 流程主记录、不可变 `ApprovalFlowVersion`、`START / APPROVER / END` 节点和连接；
- `CREATE / UPDATE / DELETE` 三种执行时机；
- `USER / ROLE / DIRECT_LEADER` 审批人与 `ANY / ALL` 多人模式；
- 节点 `ccUserIds`、`ApprovalTask.taskType=CC` 与审批中心 `my-copied`；
- 报价、合同、发票、订单的 CREATE 自动提审；
- 上述四类业务 UPDATE 提审前保存业务前置快照，驳回/业务撤销时恢复；
- DELETE 命中审批时延迟物理删除，审批通过后执行实际删除；
- `approved` 作为历史审批事实位保留；
- 简化入口条件 `amountGte`；
- 流程版本冻结、审批中心待办/已办/我的申请/抄送及结果通知。

因此 DB-010～012 的实现必须建立在现有运行时之上，不允许重做一套平行审批引擎。

## 3. DB-010：编辑审批资源快照与变更上下文

### 3.1 Cordys 源码事实

关键源码：

- `approval/domain/ApprovalResourceSnapshot.java`
- `approval/service/ApprovalResourceService.java`
- `approval/service/ApprovalActionService.java`
- `approval/domain/ApprovalInstance.java`

Cordys 的通用 `ApprovalResourceSnapshot` 保存：

| 字段 | 语义 |
| --- | --- |
| `formKey` | 业务表单类型 |
| `resourceId` | 业务资源 ID |
| `snapshotData` | 编辑前资源 JSON 快照 |

`ApprovalResourceService.savePreUpdateSnapshot(...)` 会先按 `resourceId` 清理旧快照，再保存 Handler 返回的编辑前资源 JSON。驳回或业务撤销时，`ApprovalActionService.revertFromSnapshot(...)` 读取该通用快照，调用对应 `ApprovalResourceHandler.revertToSnapshot(...)` 恢复业务数据，成功后删除快照。

Cordys `ApprovalInstance` 同时保存：

- `executeTime`
- `comment`
- `updateFields`

`updateFields` 会参与条件分支中的“字段是否发生修改”等判断。DELETE 的源码语义不是“先删再恢复”，而是审批通过后执行实际删除。

### 3.2 MicroMatrix 当前状态

当前 `ApprovalInstance` 已有：

- `executeTiming`
- `businessSnapshot Json?`
- `nodesSnapshot`

`ApprovalsService` 为 Quote / Contract / Invoice / Order 分别存在业务专用 snapshot interface、capture 和 restore 分支，能够真实支撑 W3.6 交易链 UPDATE 驳回/撤回恢复。

当前缺口：

1. 没有独立、通用的 `ApprovalResourceSnapshot` 真相源；
2. snapshot capture/restore 逻辑集中硬编码在 `ApprovalsService`，每新增业务对象都要继续扩 switch；
3. `ApprovalInstance` 尚无 Cordys 对应的 `updateFields` 与实例级 `comment`；
4. 当前简化 `amountGte` 条件不能利用“本次修改字段集合”；
5. 通用 snapshot 生命周期（覆盖旧快照、回退后清理、实例终态清理）没有独立约束。

### 3.3 审计结论

DB-010 不能继续描述为“MicroMatrix 不能做 UPDATE/DELETE 审批”。W3.6 已经完成四类交易业务的真实 UPDATE/DELETE 运行时。

准确状态应为：**业务级局部实现已完成，但 Cordys 通用资源快照、统一 Handler 边界和 `updateFields/comment` 上下文尚未对齐。**

DB-010 应先于 DB-011/012 实施，因为节点退回、条件分支和高级审批动作都依赖稳定的实例上下文与资源恢复语义。

## 4. DB-011：高级审批任务、动作、记录与附件

### 4.1 Cordys 源码事实

关键源码：

- `ApprovalActionService.java`
- `ApprovalAddSignTask.java`
- `ApprovalReturnBackRecord.java`
- `ApprovalRecord.java`
- `ApprovalInstanceAttachment.java`
- `ApprovalTask.java`

Cordys 高级动作至少包括：

#### 加签

- `ApprovalAddSignRequest`
- BEFORE / AFTER 两种加签方式；
- `ApprovalAddSignTask` 保存 `taskId / signTaskId / type / rootTaskId / sort / comment`；
- 支持在加签任务上再次加签，通过 `rootTaskId + sort` 维持同一加签链顺序；
- 流程必须开启 `allowAddSign` 才允许执行。

#### 节点退回

- `ApprovalReturnBackRequest`；
- `ApprovalReturnBackRecord` 保存 `instanceId / taskId / returnToNodeId / returnReason / returnUserId`；
- 退回后实例 `currentNodeId` 回到指定历史节点并重新生成对应待办；
- 非审批中实例不能执行节点退回。

#### 审批任务撤回

- Cordys 的任务撤回与“提交人撤销整个申请”不是同一动作；
- 要求流程 `allowWithdraw=true`；
- 校验当前用户是目标任务审批人；
- 根据 ANY / ALL / SEQUENTIAL 等多人模式和下游节点状态判断是否还能撤回。

#### 独立记录与附件

- `ApprovalRecord` 独立保存实例、任务、节点轮次、节点、结果和意见；
- `ApprovalInstanceAttachment` 把附件绑定到实例及具体执行元素；
- `ApprovalTask` 还具有 `nodeRound / type / action`，不仅是当前 MicroMatrix 的普通审批/抄送状态记录。

### 4.2 MicroMatrix 当前状态

截至 W3.7-9.3E 封板，DB-011 已从本审计阶段的真实缺口推进为 `VERIFIED`：

- `ApprovalRecord`、task `nodeId/nodeRound/type/action` 已落地；
- BEFORE/AFTER 与嵌套加签链已落地；
- 节点退回、`ApprovalReturnBackRecord` 与 round 重建已落地；
- 审批人 task revoke 已与 submitter cancel 分离；
- `ApprovalInstanceAttachment` 已落地，approve/reject/SIGN/BACK 均使用动作 element 绑定；
- `requireComment` 已进入 PC/Mobile 与服务端 approve/reject runtime；
- `allowAddSign / allowWithdraw / requireComment` 已按各自专项验收逐项开放；`allowBatchProcess` 与高级 duplicate rule 仍保持 fail-closed。

### 4.3 审计结论

DB-011 是真实运行时缺口，不应通过放开现有 disabled 开关来“完成”。必须先补任务状态模型和动作状态机，再开放配置及页面入口。

## 5. DB-012：高级审批节点配置与后置动作

### 5.1 Cordys 源码事实

关键源码：

- `ApprovalFlowService.java`
- `ApprovalNodeApprover.java`
- `ApprovalNodeCondition.java`
- `FieldPermissionDTO.java`
- `ApprovalPostConfigDTO.java`
- `WebHookConfig.java`

Cordys `ApprovalNodeApprover` 除审批人列表外还保存：

- `emptyApproverAction`
- `fallbackApprover`
- `sameSubmitterAction`
- `approverDirection`
- `ccType / ccDirection / ccList`
- `passPostConfig / rejectPostConfig`
- `fieldPermissions`

Cordys 条件节点使用独立 `ApprovalNodeCondition.conditionConfig`。运行时会：

- 读取业务字段值；
- 读取实例 `updateFields`；
- 支持 AND / OR 条件；
- 支持“字段与原值不同”等依赖本次修改集合的判断；
- 匹配条件分支，否则走 DEFAULT 节点。

审批节点通过/驳回后还可：

- 更新配置字段；
- 异步发送 Webhook；
- 使用业务字段占位符生成 GET/POST 请求；
- 配置并回显字段权限。

Cordys 还真实执行重复审批人规则，例如 `FIRST_ONLY / SEQUENTIAL_ALL` 的自动跳过。

### 5.2 MicroMatrix 当前状态

当前节点模型在 9.4A 后已经具备：

- `ApprovalNode`
- `ApprovalNodeApprover.approverType / approverIds / ccUserIds / mode`
- `ApprovalNodeCondition.conditionConfig`
- 显式 `ApprovalNodeLink` 图与 `link.sort`

9.4A 已完成 CONDITION / DEFAULT 图、CombineSearch DTO、资源字段条件求值、`NOT_EQUAL_ORIGINAL` 和实例实际 APPROVER path 冻结；当前线性 PC 编辑器在 9.4F 前对高级图 fail-closed。`fieldPermissions`、`webHook` 仍未接入。

流程层 `requireComment` 已在 DB-011 关闭；`duplicateApproverRule` 高级值仍保持 disabled/Service fail-closed，等待 DB-012 runtime。

### 5.3 审计结论

DB-012 必须建立在 DB-010 `updateFields` 上下文和 DB-011 稳定任务状态机之后实施。条件节点、字段权限、后置字段更新和 Webhook 不能拆成纯 UI 配置占位。

## 6. Cordys ↔ MicroMatrix 差异矩阵

| 能力 | Cordys | MicroMatrix 当前 | W3.7 归属 |
| --- | --- | --- | --- |
| CREATE/UPDATE/DELETE execute timing | REAL | REAL（交易链四域） | 保持回归 |
| UPDATE 编辑前快照 | 通用 `ApprovalResourceSnapshot + Handler` | W3.7-9.2 REAL | DB-010 已完成 |
| UPDATE 回退 | Handler 通用恢复并清理快照 | W3.7-9.2 REAL | DB-010 已完成 |
| `ApprovalInstance.updateFields` | REAL | W3.7-9.2 REAL | DB-010 已完成 |
| 实例 comment | REAL | W3.7-9.2 REAL | DB-010 已完成 |
| DELETE 延迟执行 | REAL | REAL（交易链四域） | 保持回归 |
| BEFORE/AFTER 加签 | REAL | W3.7-9.3B REAL | DB-011 已完成子项 |
| 节点退回 | REAL | W3.7-9.3C REAL | DB-011 已完成子项 |
| 审批人任务撤回 | REAL | W3.7-9.3D REAL | DB-011 已完成子项 |
| 独立 ApprovalRecord | REAL | W3.7-9.3A REAL | DB-011 已完成子项 |
| 审批附件 | REAL | W3.7-9.3E REAL | DB-011 已完成子项 |
| task nodeRound/type/action | REAL | W3.7-9.3A REAL | DB-011 已完成子项 |
| 条件节点/DEFAULT | REAL | W3.7-9.4A REAL | DB-012 已完成子项 |
| updateFields 条件 | REAL | W3.7-9.4A REAL | DB-012 已完成子项 |
| 空审批人/fallback/sameSubmitter | REAL | W3.7-9.4B REAL | DB-012 已完成子项 |
| 重复审批人高级规则 | REAL | W3.7-9.4B REAL | DB-012 已完成子项 |
| 必填审批意见 | REAL | W3.7-9.3E REAL | DB-011 已完成子项 |
| 节点字段权限 | REAL | 缺失 | DB-012 |
| pass/reject 字段更新 | REAL | 缺失 | DB-012 |
| Webhook | REAL | 缺失 | DB-012 |

## 7. 实施依赖结论

固定执行顺序：

1. **DB-010 通用资源快照与实例变更上下文**；
2. **DB-011 高级任务/动作/记录**；
3. **DB-012 条件节点、异常策略、字段权限和后置动作**；
4. UI 与 `/system` 流程设置在对应运行时完成后再逐项开放；
5. 最后做空库、Rules、专项 API/Browser、Root Smoke 和总文档封板。

不得先删除 `ApprovalInstance.businessSnapshot` 再实现通用 Handler。迁移必须先建立通用真相源并完成四个现有业务的等价回归，确认无双写/无回退后再清理旧字段与硬编码分支。

## 8. W3.7.0 关闭标准

本审计阶段只有满足以下条件才可标记完成：

- Cordys Resource / Action / Flow 三条主 Service 已完成源码级核对；
- DB-010～012 当前状态已按 W3.6 最新事实修正；
- 明确 DB-010 → DB-011 → DB-012 依赖顺序；
- requirements/design/tasks 与 deferred backlog 同步；
- 尚未实现的高级能力仍保持不可执行，不通过前端开关伪装完成。
