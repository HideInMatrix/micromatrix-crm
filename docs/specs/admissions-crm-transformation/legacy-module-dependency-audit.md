# ADMISSIONS-001 旧交易链模块依赖审计

> 审计日期：2026-09-24
>
> 目标：为通用招生 CRM 收敛阶段确定 `opportunities / products / quotes / contracts / orders / bidding` 的真实依赖边界和物理删除顺序。本文件只描述现状与删除前置条件，不代表 T1 阶段立即删除代码。

## 1. 总体结论

当前传统销售链不是六个彼此独立的菜单，而是同时嵌入 Lead 转 Customer、首页统计、Customer 360、Mobile、Metadata、User Views、Approval、Notification、Import/Export、Prisma 和测试。

| 模块 | T1 结论 | 主要原因 |
| --- | --- | --- |
| Bidding | **可优先退出** | 与交易链基本独立，只向 Lead 单向转换；外部依赖主要是导航、权限、Prisma、自身 Cron/测试 |
| Opportunity | **Lead 转换阻塞已解除，仍需继续解耦** | 首页商机统计、Customer360 后端、FollowUpPlan、Quote 仍直接依赖 |
| Quote | **先拆合同/审批/通知，暂不能删** | 强依赖 Opportunity/Product/ProductPrice；Contract 可从 Quote 读取产品明细；Approval/Expiry 直接操作 Quote |
| Contract | **先拆外围调用，暂不能删** | Customer360、回款、发票、审批、通知、订单审批桥接、首页快捷创建均直接引用 |
| Order | **先拆合同审批/产品/Customer360，暂不能删** | Contract 模块注入 OrdersService；Approval 直接操作订单；订单产品子表直接查询 Product |
| Product | **最后处理，不能单独删** | Opportunity、Quote、Order 及合同产品子表都读取 Product/ProductPrice；若招生未来需要课程/项目，应先抽轻量 Business Item |

## 2. Opportunity

### 2.1 Lead 转换阻塞已解除

Lead 转换主链已经完成去商机化：

- `oppCreated / oppName / opportunityId` 契约已删除；
- 不再初始化或查询 Opportunity Stage；
- 不再创建 Opportunity，也不再执行 Lead → Opportunity 动态字段映射；
- 不再发送“线索转商机”通知；
- PC/Mobile 转换页只创建或复用 Customer、Contact；
- `LeadsModule` 已移除 `OpportunitiesModule` import。

Contact、FollowUp、FollowUpPlan、Attachment 等通用转换副作用继续保留，因此 Lead 转换已经不再阻塞 Opportunity 后续物理删除。

### 2.2 首页直接依赖 Opportunity

`HomeStatisticService` 注入 `HomeOpportunityStatisticQuery`，固定提供 opportunity / opportunity-underway / opportunity-success。

PC `DashboardView.vue` 直接请求这些接口，并以 Opportunity 为固定首页统计事实。

删除前置：首页改成 ADMISSIONS-001 定义的可配置指标层，统计目标改为 Lead / Stage / FollowUp / Customer 动态字段等通用事实。

### 2.3 Customer 360 直接查询 Opportunity

`customers.service.ts -> relatedResource()` 直接访问 `Opportunity` / `OpportunityStageConfig`；前端 `CustomerOverviewContent.vue` 也维护 opportunities tab、分页和详情入口。

删除前置：Customer 360 移除传统交易 tabs，保留 Customer、Contact、FollowUp、FollowUpPlan、附件、关系、协作等招生核心信息。

### 2.4 Quote 依赖 Opportunity

`QuotesService` 的主表是 `OpportunityQuotation`，包含 `opportunityId`，搜索和列表会直接查询 Opportunity。

因此 Quote 未退出前，Opportunity Prisma 模型不能物理删除。

## 3. Quote

Quote 不只是一个页面：

- `OpportunityQuotation.opportunityId` 强依赖 Opportunity；
- `QuotationFieldsService` 保存/读取产品子表时直接校验 `Product` 和 `ProductPrice`；
- `ContractsModule` 直接 imports `QuotesModule`；
- `ContractsService` 允许通过 `fromQuoteId` 读取报价及产品明细；
- `ApprovalResourceService` 对 quotation 有 targetInfo / setStatus / delete / snapshot / restore；
- `MessageExpiryService` 直接查询 `opportunity_quotation` 生成到期消息。

结论：Quote 必须在 Contract 的“从报价创建/复制”能力退出、Approval handler 清理、Expiry 清理后才能物理删除。

## 4. Contract

Contract 当前实际是一个聚合：

- Contract；
- ContractStage；
- ContractPaymentPlan；
- ContractPaymentRecord；
- ContractInvoice；
- BusinessTitle；
- ApprovalResourceController。

`ContractsModule` imports `QuotesModule` 和 `OrdersModule`；`ApprovalResourceController` 直接注入 `OrdersService`。

Customer 360 后端直接查询 Contract / ContractPaymentPlan / ContractPaymentRecord / ContractInvoice，并计算已回款金额；前端也固定维护这些 tabs。

`MessageExpiryService` 直接查询 contract_payment_plan / contract / contract_stage_config。

结论：合同链必须先从 Customer 360、首页快捷入口、审批资源、消息到期任务中解耦，再整体退出。招生的“缴费成功”不得通过保留 ContractPaymentRecord 来实现；该事实按 requirements v4 由第三方 API 更新 Customer 动态字段。

## 5. Order

Order 不是完全独立模块：

- `ContractsModule` imports `OrdersModule`；
- `ApprovalResourceController` 注入 `OrdersService`；
- `OrderFieldsService` / `OrdersService` 使用 orderProduct / orderProductPrice / orderProductNumber / orderProductAmount；
- 保存、导入、读取订单时直接查询 `Product`；
- Approval Resource 支持 `order`；
- Customer 360 固定包含 `orders`。

结论：Order 需要先从 Contract approval bridge、Approval Resource、Customer360、Metadata/UserView 中移除，再物理删除。

## 6. Product

当前 Product 是传统销售“产品 + 价格表”体系，不宜直接作为招生课程模型保留。

现有消费方至少包括：

- Opportunity：校验 `Product`，保存 products；
- Quote：校验和读取 `Product + ProductPrice`；
- Order：校验和读取 `Product`；
- Contract/Quote/Order 产品子表读模型和测试。

结论：Product 必须晚于 Opportunity / Quote / Contract / Order 处理。

如果后续招生需要“课程 / 项目 / 班型”作为可复用业务对象，应单独抽取轻量 `BusinessItem`，只保留名称、状态、自定义字段和必要展示信息，不继承 ProductPrice、报价、订单交易语义。

## 7. Bidding

Bidding 与交易链耦合最低：

- 自身 Prisma：BiddingInfos / BiddingKeywordSubs / BiddingSources；
- 自身 Controller/Service/Provider；
- Cron 使用 DistributedCoordinator；
- 支持“一键转线索”；
- scheduled-coordination test 显式实例化 BiddingService。

没有发现核心 Lead/Customer 模块反向依赖 BiddingService。

结论：Bidding 是第一批可退出候选。删除时同步清理 AppModule、Web/Mobile 路由/API、NavigationModuleKey/MENUS、menu:bidding 权限、Prisma models 和 scheduled coordination tests。

其“一键转线索”不需要抽成公共能力，因为 Lead 本身已有通用创建/导入/API 能力。

## 8. 共享基础设施中的交易链注册

### 8.1 Metadata

`system-fields.ts` 当前包含 opportunity、quotation、contract、contractPaymentPlan、contractPaymentRecord、invoice、order 和产品子表字段。

### 8.2 User Views

`USER_VIEW_RESOURCE_TYPES` 和路由表包含 OPPORTUNITY、OPPORTUNITY_QUOTATION、CONTRACT、CONTRACT_PAYMENT_PLAN、CONTRACT_PAYMENT_RECORD、CONTRACT_INVOICE、ORDER。

### 8.3 Approval

Approval Resource 当前固定支持 quotation、contract、invoice、order。审批引擎本身必须保留，只删除业务 handler。

### 8.4 Notifications

消息模板、到期任务目前包含商机、报价、合同、回款计划、订单审批等。消息基础设施保留，交易链专属模板和扫描任务退出。

### 8.5 Import / Export

Import/Export 基础设施本身通用，应保留。删除旧模块时只移除对应调用方，不删除 SpreadsheetService / ExportTasksService 等公共能力。

## 9. 导航和产品入口

当前 `NavigationModuleKey` 仍包含 opportunity / product / contract / bidding / order。

当前默认配置：

- opportunity: false；
- product: false；
- contract: false；
- bidding: false；
- order: **true**。

第一阶段产品收敛可以先关闭/移除传统销售入口，再进行底层解耦。菜单隐藏只代表产品入口退出，不代表后端和 Prisma 已可删除。

## 10. 建议实施顺序

### Phase A：产品入口退出

1. 默认关闭/移除 Opportunity / Product / Contract / Order / Bidding；
2. 首页快捷创建移除交易链；
3. Mobile 入口、搜索入口同步收敛；
4. Customer 360 隐藏传统交易 tabs。

### Phase B：核心链路解耦

1. Lead 转 Customer 移除 Opportunity 副作用；
2. Home 移除 HomeOpportunityStatisticQuery；
3. FollowUpPlan 的 opportunity target 退出；
4. Customer360 后端 relatedResource 删除交易资源；
5. Approval 删除 quote/contract/invoice/order handler；
6. Notification 删除交易链 expiry/template；
7. UserView/Metadata 移除旧资源注册。

### Phase C：业务模块删除

建议物理删除顺序：

1. Bidding；
2. Contract/Order/Quote 交易聚合（先取消相互 module import）；
3. Opportunity；
4. Product/ProductPrice。

其中 2～4 的数据库删除必须以外键/字段值/快照依赖实际迁移结果为准，不机械按目录顺序执行。

### Phase D：数据库与验证

1. 删除确认无调用方的 Prisma models；
2. 更新 baseline/migration 策略；
3. 清理 Metadata、permissions、Seed、tests；
4. 空库 migration + seed；
5. Prisma generate；
6. API rules/typecheck/lint/build；
7. PC + Mobile Browser Smoke；
8. 验证后台无旧交易接口请求和定时扫描。

## 11. T1 判定

- **可优先退出**：Bidding。
- **先抽公共能力/解除外围耦合**：Opportunity、Quote、Contract、Order。
- **最后处理**：Product/ProductPrice。
- **必须保留的公共能力**：Metadata/Dynamic Form、User View 基础设施、Approval Engine、Notification 基础设施、Import/Export、Data Scope、Distributed Coordinator。

进入 T2 时先做产品结构和入口收敛，不在入口收敛阶段直接删除 Prisma 模型。
