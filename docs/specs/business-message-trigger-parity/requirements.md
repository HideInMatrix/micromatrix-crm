# W2.4 业务消息触发链路对齐需求

## 1. 目标与范围

以项目内 `CordysCRM/` 的业务 Service、审批结束通知、资源池回收 Listener 和 `NoticeExpireJob` 为事实来源，将 W2.3 的消息事件目录接入当前 NestJS 已存在的真实业务动作。事件关闭后不得落库或触发 SSE；事件开启时，接收人、排除操作者和到期时间应与 Cordys 语义一致。

本阶段覆盖当前领域模型能够准确表达的 29 个事件；W2.3 已接入的 3 个跟进计划事件继续保留。`CONTRACT_ARCHIVED`、`CONTRACT_VOID`、`INVOICE_APPROVAL` 因当前项目尚无等价业务状态或审批对象，本阶段不伪造触发点。

## 2. 源码事实

- 客户、联系人、协作人、线索和商机的新增、转移、删除、移池、分配通知分别位于 Cordys 对应业务 Service；所有人工操作通知均使用 `excludeSelf=true`。
- `CustomerPoolRecycleListener` 与 `CluePoolRecycleListener` 在自动回收完成时通知原负责人。
- 线索转客户发送 `CLUE_CONVERT_CUSTOMER`；同时创建商机时再发送 `CLUE_CONVERT_BUSINESS`，两条事件不能合并。
- 报价、合同、订单的审批结束通知由 `ApprovalActionService.sendFinishNotice` 按业务对象映射事件；审批待办仍属于通用审批通知。
- `NoticeExpireJob` 每天按租户读取事件开关、提前天数和通知范围，分别处理报价、合同、回款计划的即将到期与到期事件。
- 可配置事件接收范围由固定负责人、指定成员、角色成员和负责人所在部门及上级部门负责人共同组成，并最终去重。

## 3. 用户故事与验收条件

### R1：统一事件发送语义

- 当业务动作发送目录事件时，通知系统 shall 在落库和 SSE 前检查对应租户的系统消息开关。
- 当接收人包含当前操作者且该动作使用 Cordys `excludeSelf=true` 语义时，通知系统 shall 排除当前操作者。
- 当多个来源解析出同一接收人时，通知系统 shall 去重，且 shall 不向不存在、禁用或其他租户的成员发送消息。
- 未绑定目录事件的通用审批待办、预回收提示等兼容通知 shall 保持现有行为。

### R2：客户模块事件

- 当新建客户且负责人不是操作者时，系统 shall 以 `CUSTOMER_ADD` 通知负责人。
- 当新建联系人时，系统 shall 以 `CUSTOMER_CONCAT_ADD` 通知客户负责人。
- 当新增客户协作人时，系统 shall 以 `CUSTOMER_COLLABORATION_ADD` 通知客户负责人，并在内容中标明协作成员；不得把该事件错误发送给协作成员本人。
- 当客户负责人被人工变更时，系统 shall 以 `CUSTOMER_TRANSFERRED_CUSTOMER` 通知新负责人。
- 当客户被人工移入公海时，系统 shall 以 `CUSTOMER_MOVED_HIGH_SEAS` 通知原负责人。
- 当客户被自动回收进公海时，系统 shall 以 `CUSTOMER_AUTOMATIC_MOVE_HIGH_SEAS` 通知原负责人。
- 当公海客户被分配给其他成员时，系统 shall 以 `HIGH_SEAS_CUSTOMER_DISTRIBUTED` 通知新负责人。
- 当客户被删除时，系统 shall 以 `CUSTOMER_DELETED` 通知删除前负责人。

### R3：线索模块事件

- 当新建线索且负责人不是操作者时，系统 shall 以 `CLUE_ADD` 通知负责人。
- 当线索负责人被人工变更时，系统 shall 以 `TRANSFER_CLUE` 通知新负责人。
- 当线索被人工移入线索池时，系统 shall 以 `CLUE_MOVED_POOL` 通知原负责人。
- 当线索被自动回收进线索池时，系统 shall 以 `CLUE_AUTOMATIC_MOVE_POOL` 通知原负责人。
- 当池内线索被分配给其他成员时，系统 shall 以 `CLUE_DISTRIBUTED` 通知新负责人。
- 当线索被删除时，系统 shall 以 `CLUE_DELETED` 通知删除前负责人。
- 当线索关联或转换为客户时，系统 shall 以 `CLUE_CONVERT_CUSTOMER` 通知线索负责人；若同次转换创建商机，shall 额外发送 `CLUE_CONVERT_BUSINESS`。

### R4：商机、报价与审批结果事件

- 当新建、转移或删除商机时，系统 shall 分别以 `BUSINESS_ADD`、`BUSINESS_TRANSFER`、`BUSINESS_DELETED` 通知负责人或新负责人。
- 当报价被删除时，系统 shall 以 `BUSINESS_QUOTATION_DELETED` 通知报价负责人。
- 当报价审批结束时，系统 shall 以 `BUSINESS_QUOTATION_APPROVAL` 通知提交人。
- 当合同审批结束时，系统 shall 以 `CONTRACT_APPROVAL` 通知提交人。
- 当订单审批结束时，系统 shall 以 `ORDER_APPROVAL` 通知提交人。
- 回款记录审批不 shall 错误映射为 `INVOICE_APPROVAL`；在发票审批领域补齐前保持通用审批结果通知。

### R5：到期通知执行器

- 每天执行到期任务时，系统 shall 按租户和事件开关分别处理 `BUSINESS_QUOTATION_EXPIRING/EXPIRED`、`CONTRACT_EXPIRING/EXPIRED`、`CONTRACT_PAYMENT_EXPIRING/EXPIRED`。
- 对 `EXPIRING` 事件，系统 shall 逐条使用租户配置的 `timeList` 精确匹配目标日期；配置为空时不得发送。
- 对 `EXPIRED` 事件，系统 shall 只匹配当天到期的业务对象。
- 回款计划已足额回款、作废报价及已终止/完成合同 shall 不产生到期通知。
- 通知内容 shall 包含业务对象名称、到期日期和提前天数（如适用），链接 shall 指向可访问的现有页面。

### R6：可配置接收范围

- 当到期事件配置包含 `OWNER` 时，系统 shall 加入业务对象负责人。
- 当配置包含指定成员或启用角色通知时，系统 shall 加入有效的租户内成员和角色成员。
- 当启用负责人上级通知时，系统 shall 从负责人所在部门开始，按 `ownerLevel` 解析当前及上级部门负责人；`0` 表示当前部门负责人。
- 接收范围为空时，系统 shall 安全跳过发送，不得回退成全员通知。

### R7：验证与可追溯性

- 每类事件映射 shall 有自动化测试验证事件编码、接收人和排除操作者语义。
- 关闭事件的测试 shall 证明通知不落库；开启后 shall 恢复发送。
- 到期任务 shall 有固定时钟测试覆盖提前提醒、当天到期、开关关闭、范围解析和已完成业务过滤。
- Smoke shall 至少覆盖客户人工移池、线索转换、商机转移和审批结果，并在结束前恢复消息设置；无公开手工入口的到期任务 shall 由固定时钟自动化测试覆盖，禁止仅为测试增加 Cordys 不存在的公开 API。

## 4. 非目标

- 不在 W2.4 新增合同归档/作废状态，也不伪造 `CONTRACT_ARCHIVED`、`CONTRACT_VOID`。
- 不把回款审批冒充发票审批；`INVOICE_APPROVAL` 等发票审批模型和页面真实存在后再接入。
- 不接入邮件、企微、钉钉、飞书发送器，不建设消息模板编辑器。
- 不改变 W2.3 的五组 35 事件目录和页面信息架构。

## 5. 暂缓项与数据模型缺口管理

- 当前阶段不实施但已从 Cordys 源码确认的能力 shall 登记到 [`docs/cordys-deferred-backlog.md`](../../cordys-deferred-backlog.md)。
- 当暂缓原因涉及缺少表、字段、枚举、关系或审计信息时，台账 shall 明确记录数据模型缺口和进入实施的前置条件。
- W2.4 shall 不把 `CONTRACT_ARCHIVED`、`CONTRACT_VOID`、`INVOICE_APPROVAL` 标记为已接入；对应 DB-001、DB-002、DB-003 关闭后才能更新完成状态。
- 每个后续复刻阶段 shall 在提交前检查并更新台账，确保整体复刻验收时不存在未登记缺口。
