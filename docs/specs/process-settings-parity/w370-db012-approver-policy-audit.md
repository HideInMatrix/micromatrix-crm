# W3.7-9.4B DB-012 审批人异常策略源码审计

审计日期：2026-09-02

## 1. 审计范围

本单元只审计并关闭以下 Cordys 高级审批能力：

- empty approver：`AUTO_PASS / ASSIGN_SPECIFIC / ASSIGN_ADMIN`；
- same submitter：`SKIP / ALLOW / ASSIGN_SUPERIOR`；
- approver direction：`BOTTOM_UP / TOP_DOWN`；
- 指定层级直属上级、连续多级直属上级、指定层级部门负责人、连续多级部门负责人；
- duplicate approver：`FIRST_ONLY / SEQUENTIAL_ALL / EACH`。

字段权限、pass/reject 后置字段更新、Webhook 和完整 Vue Flow 高级编辑器仍属于 9.4C～9.4F。

## 2. Cordys 源码事实

主要依据：

- `EmptyApproverActionEnum.java`
- `SameSubmitterActionEnum.java`
- `DuplicateApproverRuleEnum.java`
- `ApproverDirectionEnum.java`
- `ApproverLevelEnum.java`
- `ApprovalFlowService.java`

`ApprovalFlowService` 的真实异常处理顺序是：

1. 根据审批人类型、层级和方向解析实际审批人；
2. 审批人为空时执行 empty approver 策略；
3. 实际审批人与提交人相同时执行 sameSubmitter 策略；
4. 最后执行 duplicate approver rule。

这个顺序必须保持，不能把 duplicate 提前到动态审批人解析之前，否则同一配置在组织层级变化后会产生不同语义。

## 3. empty approver

- `AUTO_PASS`：当前节点自动通过并继续向后流转，同时留下自动审批记录。
- `ASSIGN_SPECIFIC`：将配置的 `fallbackApprover` 作为实际审批人。
- `ASSIGN_ADMIN`：Cordys runtime 同样读取节点的 `fallbackApprover`，管理员身份的选择属于配置来源，而不是运行时临时猜测某个管理员角色。

因此 MicroMatrix runtime 不新增“自动找管理员”隐式规则；非 AUTO_PASS 必须配置有效、租户内且启用的 fallback 用户。

## 4. same submitter

- `ALLOW`：提交人仍可正常收到审批任务。
- `SKIP`：
  - 单审批人或 `ANY`：当前节点整体自动通过；
  - `ALL`：只跳过提交人，其他审批人继续处理。
- `ASSIGN_SUPERIOR`：把与提交人相同的审批人替换为提交人的直属上级；若直属上级不存在，则当前节点自动通过。

自动通过/跳过必须留下可审计事实，不能只移动 `currentNodeIndex`。

## 5. 动态审批方向与层级

Cordys 层级值固定为 1～10。

- `BOTTOM_UP`：从提交人最近的直属上级/当前部门开始向上计算。
- `TOP_DOWN`：从已解析层级链的顶部向下计算。
- 单级类型选择目标层级的一人。
- 连续多级类型选择目标方向上的前 N 人。

MicroMatrix 当前 `User.leaderId` 和 `Department.parentId/leaderId` 已具备所需组织链，无需建立第二套组织关系。

## 6. duplicate approver

- `FIRST_ONLY`：当前实例中，审批人若已在其他节点完成 APPROVED task，则后续重复节点自动通过/跳过。
- `SEQUENTIAL_ALL`：只比较紧邻上一审批节点当前 round 的已审批人；非连续历史审批不触发。
- `EACH`：每次出现都必须重新审批。

对于单审批人或 `ANY` 节点，只要命中需要跳过的重复审批人，节点整体自动通过；`ALL` 节点仅过滤命中的重复审批人，其他审批人继续执行。

## 7. MicroMatrix 差异结论

9.4B 实施前：

- `ApprovalFlow.duplicateApproverRule` 已存在，但高级值被配置服务拒绝，runtime 未执行真实策略；
- `ApprovalNodeApprover` 缺 empty/fallback/sameSubmitter/direction；
- `DEPT_LEADER / DIRECT_LEADER` 只支持固定最近一级；
- `advance()` 对空审批人直接向后跳过，没有 Cordys 自动审批审计记录；
- 无连续多级直属上级/部门负责人类型。

因此 9.4B 必须同时改 schema、DTO、FlowVersion 持久化、冻结快照和 task advancement，不能只开放已有 `duplicateApproverRule` 字段。

## 8. 数据策略

项目当前没有发布历史数据，本单元采用最终模型直接前进：

- Migration 65 只建立 9.4B 最终字段/枚举与 Cordys 对齐所需的 nullable automatic-record task relation；
- 不编写历史配置 backfill；
- 不为旧 `nodesSnapshot` 增加双协议兼容分支；
- `AUTO_PASS / SKIP / BOTTOM_UP` 作为 Cordys 业务默认值保留，它们不是历史兼容策略。

