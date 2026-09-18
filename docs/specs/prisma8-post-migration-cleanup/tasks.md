# PRISMA8-002 执行任务

状态：`IN_PROGRESS`

## P0 基线与规则

- [x] P0.1 固定 PRISMA8-001 为已封板基线，不修改正式 baseline。
- [x] P0.2 核实 `moduleFormat = "cjs"` 适用范围；确认当前 contract runtime 不支持该配置。
- [x] P0.3 实测当前 Prisma 8 runtime 可由 CommonJS 加载，删除动态 import workaround。
- [x] P0.4 盘点类型面：VarChar 476、Timestamp 126、Numeric 12、Jsonb 21、BigInt 110。
- [x] P0.5 明确时间职责：DB 保存语义、API 输出机器格式、前端负责展示。

## P1 测试兼容层

- [x] P1.1 建立 Prisma 8 原生 test database helper。
- [x] P1.2 第一批迁移基础设施/认证/公共服务测试，停止使用通用 Prisma 7 delegate facade。
- [x] P1.3 迁移 Customers / Leads / Metadata / Pool tests。
- [x] P1.4 迁移交易链 / 审批 / 通知 / 企业集成 tests。
- [x] P1.5 `createPrismaFixtureClient` 引用归零。
- [x] P1.6 删除 `prisma-fixture-client.ts` 与 `prisma-fixture-metadata.ts`。

## P2 时间语义与 API contract

- [x] P2.1 对 126 个 Timestamp 字段按 absolute/local/schedule 分类。
- [x] P2.2 建立统一 API 时间 serializer，禁止业务内部 Date/Temporal 往返。
- [x] P2.3 前端 Web/Mobile 时间展示统一从 API ISO 值格式化。
- [x] P2.4 existing DB UTC/时区历史数据 precheck。
- [x] P2.5 对确认属于 absolute instant 的字段生成 forward migration，并验证旧数据转换。
- [x] P2.6 删除无引用的 `prisma8-temporal` compatibility functions。

## P3 VarChar / ID 数据库治理

- [ ] P3.1 476 个 VarChar 字段按 ID/枚举协议/自由文本分类。
- [ ] P3.2 existing DB 长度与 ID 格式 precheck。
- [ ] P3.3 设计并生成保持等价约束的 forward migration。
- [ ] P3.4 逐批删除 `prisma8Varchar/prisma8Varchars/prisma8Id32` 调用。

## P4 Numeric / JSON domain 收口

- [ ] P4.1 Numeric 输入统一精确 decimal domain，不降级为浮点。
- [ ] P4.2 JSON 输入统一 JsonValue/DTO serializer。
- [ ] P4.3 删除无引用的 values compatibility helper。

## P5 Canonicalization 与最终验收

- [ ] P5.1 `Prisma8Client/Service/Module` 改为正式 canonical 名称。
- [ ] P5.2 删除 migration-only `prisma8*` 文件名和测试命名。
- [ ] P5.3 全量 typecheck/lint/build/API Rules。
- [ ] P5.4 existing/fresh PostgreSQL migration/seed/verify/status。
- [ ] P5.5 Docker release smoke。
- [ ] P5.6 Browser 代表性回归与 API runtime log 扫描。
- [ ] P5.7 文档封板为 `VERIFIED`。

## 当前执行指针

当前执行 **P3.1**。P1 测试兼容层与 P2 时间语义/API contract 已完成收口；下一阶段开始对 476 个 `VarChar` 字段按 ID / 枚举协议 / 自由文本分类，并为 existing DB 长度与 ID 格式 precheck 建立清单。

第一批已完成 native 化并通过真实 PostgreSQL：

- `src/prisma/prisma8.compat.test.ts`：CRUD / rollback / raw lane / service lifecycle；
- `src/auth/auth.prisma8.test.ts`：register / login / refresh / change password / LoginLog；
- `src/common/guards/auth.guard.prisma8.test.ts`：API Key + User/UserRole/Role；
- `src/common/services/business-change-log.prisma8.test.ts`：transaction + JSONB readback；
- `src/common/services/data-scope.prisma8.test.ts`；
- `src/common/services/scope-resolver.prisma8.test.ts`。

P1.2 已继续覆盖 PersonalCenter / PersonalApiKey / MessageSettings / HomeDepartmentScope / HomeOverview / HomeStatistics / DashboardAccess / DashboardModule / DashboardResource / Departments / Logs / OperationLogCleanup。累计 native PostgreSQL gate **20/20 PASS、0 skip**；API typecheck/build exit 0。

通用 fixture facade 的 `createPrismaFixtureClient` 引用已从本阶段开始时的 **155** 持续下降。

P1.3 已完成 Customers / Leads / Metadata / Pool 共 **7/7** 真实 PostgreSQL gate，API typecheck/build 与 `git diff --check` 全绿。该批测试中的 `VarChar/Numeric/BigInt` storage 继续通过现有 Prisma 8 类型边界 helper 表达，没有把类型治理混入测试 facade 清理。

P1.4 第一批已完成 Announcements CRUD/Cron、Dictionaries、Products/ProductPrice、Roles、UserViews 共 **6/6** 真实 PostgreSQL gate，且暴露并消除了旧 fixture 曾隐式补齐 `Announcements.updatedAt` 的兼容行为；native 测试现在直接遵守正式 Prisma 8 contract。Products 专项同时补齐了 quotation/opportunity/stage 测试数据清理，避免随机组织数据残留。

P1.4 第二批已完成 Notifications **4/4**、EnterpriseIntegrations / EnterpriseSettings / DingTalk-Lark-WeCom SSO 整批 **16/16**、OrganizationSync preview/apply/rollback **3/3** 真实 PostgreSQL gate；其中组织同步失败用例继续验证主事务回滚、独立失败审计与 OperationLog JSONB。OpportunityRule CRUD / auto-close 也已完成 native 化并通过 **2/2** 真实 PostgreSQL gate。

P1.4 审批低耦合批次已完成 ApprovalFlowConfig / ApprovalResource / Capture / Restore / Snapshot / Webhook 共 **6/6** 真实 PostgreSQL gate；API typecheck/build 与 `git diff --check` 全绿。

P1.4 审批状态机批次已继续完成 reads / approve-reject / sign / advance / return-back / revoke / cancel，Approval 整组累计 **13/13 PASS、0 skip**；审批测试已不再引用 Prisma 7 fixture facade。

P1.4 后续批次已完成 Attachments / Bidding / FollowUpPlans / Members 共 **4/4** 真实 PostgreSQL gate；真实附件磁盘 CRUD、提醒 CAS/失败释放、成员删除保护与标讯转线索语义均保持。

当前全仓 `createPrismaFixtureClient` 搜索共 **32** 个匹配 / **16** 个文件，其中包含 fixture 实现自身的定义；业务侧剩余 **15** 个文件，集中在 Contacts / Contracts / Orders / Quotes / Opportunities / FollowUps / ImportExport / CustomForms。下一步继续逐批 native 化，直至 P1.5 引用归零。

P1.4 交易链低耦合批次已继续完成 Contacts / BusinessTitle / ContractStage / OrderStage，共 **4/4** 真实 PostgreSQL PASS；原生测试同时暴露并补齐了 Contract `amount` 的正式 Numeric contract 要求。

当前全仓 `createPrismaFixtureClient` 搜索已降至 **24** 个匹配 / **12** 个文件，其中 fixture 实现自身 1 个文件；业务侧只剩 **11** 个测试文件。

P1.4 合同子域批次已完成 ContractInvoice / ContractPaymentPlan+Record / ProductSubtableRead，共 **3/3** 真实 PostgreSQL PASS；normal/blob 子表合并、跨租户隔离、金额聚合与精确 Numeric contract 均由原生 Prisma 8 测试覆盖。

当前全仓 `createPrismaFixtureClient` 只剩 **18** 个匹配 / **9** 个文件，其中 fixture 实现自身 1 个文件；业务侧剩余 **8** 个测试文件。

P1.4 最终批次已完成 Contracts / Orders / Quotes / Opportunities 主 CRUD、FollowUps / FollowComments、ExportTasks、CustomForms 等剩余业务测试的 native 化；最后业务批次 **5/5 PASS**，主交易链 **4/4 PASS**。

P1.5/P1.6 已完成：

- `apps/api/src` 中 `createPrismaFixtureClient` 业务引用归零；
- 删除 `src/testing/prisma-fixture-client.ts`（414 行）；
- 删除 `src/testing/prisma-fixture-metadata.ts`（5523 行）；
- 源码中 `prisma-fixture-client` / `prisma-fixture-metadata` 引用归零，文档仅保留历史收口记录；
- 删除后 `prisma contract emit`、API typecheck、API build、`git diff --check` 全绿；
- API Rules 在保留真实 PostgreSQL、显式清空 Redis 环境以满足“未配置 Redis”专项前提后 **346/346 PASS、0 fail、0 skip**。

P1 正式完成。P2.1 inventory 已写入 `timestamp-inventory.md`：126 个字段全部属于 absolute instant，其中 AUDIT 89、EVENT_INSTANT 27、SCHEDULED_INSTANT 10；未发现真正 local/wall-clock 或 recurring time-of-day 字段。

P2.4 existing DB 只读 precheck 已通过：开发库当前 TimeZone=UTC；126/126 目标列均为 timestamp without time zone；52 列存在非空历史数据，最早值为 2026-09-07 03:47:17.978；50 个列 default 为 CURRENT_TIMESTAMP，76 个无 DB default；AUDIT / EVENT_INSTANT 字段未发现超过当前 UTC + 24h 的异常未来值。Users / OperationLogs / BiddingInfos / Subscriptions 抽样使用 AT TIME ZONE 'UTC' 后保持原 wall value 并明确成为 +00 instant。

P2.5 已完成：新增 `20260918T0826_timestamp_absolute_instants` forward migration，共 **126 operations**。每列显式使用 `USING <column> AT TIME ZONE 'UTC'`；Prisma 8 RC 对 `timestamptz(3)` 的 postcheck 采用 PostgreSQL canonical `timestamp(3) with time zone` 修正后，`migration check` PASS。

existing DB 已应用该 migration 并把 `db` ref 前移到 storage hash `07748bd3c63b9a5cad29fe7ca01d2112d369c952703a483fb95f34ecd715c0a9`。迁移前后 126 列的 UTC epoch 指纹均为 `1a7e4fcdfaacffe4b3536924b4b67b90b8aa89998757bae914ef4b2ffe8395b4`，52 个有数据列数量一致，物理类型 **126/126 = timestamp with time zone**；`db verify` 与 `migration status` 全绿。

fresh PostgreSQL 从空库执行 baseline **672 operations** + forward migration **126 operations**，合计 **798 operations**，随后 bootstrap Seed / `db verify` / `migration status` 全绿，fresh 库同样为 **126 个 timestamptz 列**。API typecheck / production build exit 0；完整 API Rules 在正确清空 Redis 配置的专项环境下 **346/346 PASS、0 fail、0 skip**。

P2.2 已完成：Prisma 8 timestamptz runtime 统一以 `Temporal.Instant` 表达；API instant 输出统一走 `prisma8TimestampToISOString`。生产代码中的 `Temporal.Instant -> Date -> ISO/getTime` 往返已清零；DTO ISO 字符串使用 `prisma8TimestampFromISOString`，epoch 窗口使用 `prisma8TimestampFromEpochMilliseconds`，`prisma8TimestampFromDate` 只保留 Cron / Provider / 第三方库 / 已明确 Date 参数等真正边界。源码中 `Temporal.PlainDateTime` 与旧 timestamp raw SQL 的 `AT TIME ZONE 'UTC'` 均为 **0 refs**。

P2.3 已完成：Web/Mobile 时间展示继续由前端消费 API ISO instant 后调用 `Date` / locale formatter 展示；公告等输入提交仍发送 ISO 机器值，不把 locale 展示字符串写回 API。Web typecheck/build 与 Mobile typecheck/build 均 **exit 0**。

P2.6 已完成：`prisma8TimestampToDate` 引用归零并删除；保留的 `prisma8Now / prisma8TimestampFromDate / prisma8TimestampFromISOString / prisma8TimestampFromEpochMilliseconds / prisma8TimestampToISOString` 均有当前正式 runtime 边界用途，不再承担 Prisma 7 `Date` compatibility。

P2 最终门禁：API typecheck/build **exit 0**，完整 API Rules **346/346 PASS、0 fail、0 skip**，时间相关专项 **91/91 PASS**，Web/Mobile typecheck/build 全绿，`git diff --check` PASS。P2 正式完成，执行指针进入 **P3.1**。

