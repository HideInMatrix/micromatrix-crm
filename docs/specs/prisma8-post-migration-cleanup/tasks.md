# PRISMA8-002 执行任务

状态：`VERIFIED`

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

- [x] P3.1 476 个 VarChar 字段按 ID/枚举协议/自由文本分类。
- [x] P3.2 existing DB 长度与 ID 格式 precheck。
- [x] P3.3 设计并生成保持等价约束的 forward migration。
- [x] P3.4 逐批删除 `prisma8Varchar/prisma8Varchars/prisma8Id32` 调用。

## P4 Numeric / JSON domain 收口

- [x] P4.1 Numeric 输入统一精确 decimal domain，不降级为浮点。
- [x] P4.2 JSON 输入统一 JsonValue/DTO serializer。
- [x] P4.3 删除无引用的 values compatibility helper。

## P5 Canonicalization 与最终验收

- [x] P5.1 `Prisma8Client/Service/Module` 改为正式 canonical 名称。
- [x] P5.2 删除 migration-only `prisma8*` 文件名和测试命名。
- [x] P5.3 全量 typecheck/lint/build/API Rules。
- [x] P5.4 existing/fresh PostgreSQL migration/seed/verify/status。
- [x] P5.5 Docker release smoke。
- [x] P5.6 Browser 代表性回归与 API runtime log 扫描。
- [x] P5.7 文档封板为 `VERIFIED`。

## 当前执行指针

当前执行指针：**无**。P1-P5 全部完成，`PRISMA8-002` 已正式封板为 `VERIFIED`。

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

P3.1 已完成，详见 `varchar-inventory.md`：476 个 VarChar 字段完整分类为 IDENTIFIER **361**、PROTOCOL **38**、TEXT **52**、SERIALIZED_VALUE **16**、BOUNDED_VALUE **6**、BUSINESS_KEY **3**。generated contract 已确认普通 `String` 为 `pg/text@1` / plain string，而 `VarChar(n)` 才生成 `Varchar<n>` branded type。

P3.2 existing DB precheck 已完成，详见 `varchar-precheck.md`：476/476 物理列长度与 contract 一致，173 列存在非空数据，共 2467 个值，**0 个长度违规**。361 个 ID/reference 字段中已有 1794 个非空值：CUID/CUID-like 1621、32-hex 17、RFC UUID 0、其它历史/协议标识 157；存在 `SYSTEM/system`、`u<hex>`、`org-<hex>`、`NONE` 等值，因此本轮明确禁止整体迁移为 PostgreSQL UUID。

当前 Prisma 8 varchar compatibility helper 规模：production `prisma8Varchar` **2003 calls / 50 files**、`prisma8Varchars` **247 calls / 34 files**、`prisma8Id32` **82 calls / 32 files**。P3.3 的目标是通过数据库 contract 正规化一次性消除前两类 branded cast，再在 P3.4 清理 ID 生成 helper 的迁移期命名。

P3.3 已完成。先做两轮隔离 rehearsal：

- 普通文本列：`BusinessTitle.name varchar(255) -> text + CHECK`，255 字符可写、256 字符被 DB CHECK 拒绝，Seed / verify / status 全绿；
- PK/FK 关系：`BusinessTitle.id` 与 `ContractInvoice.businessTitleId` 同步迁为 text，原 `contract_invoice_business_title_id_fkey` 保持存在且语义不变，Seed / verify / status 全绿。

正式 migration 为 `20260918T0923_varchar_text_length_constraints`，storage hash `0d036f3fcbf3d2169c7530c49e3d96ae1c1961b75c8d3bbfe89bddebb274e0fe`，共 **952 operations = 476 ALTER TYPE + 476 ADD CHECK**。Planner 初始生成的 476 个 type-change dataTransform placeholder 在 P3.2 0-length-violation 与 rehearsal 证据基础上全部删除，最终 migration **0 placeholder**，`migration check` PASS。

existing DB 已正式应用：目标列 **476/476 = text**、P3 长度 CHECK **476/476**；迁移前后 476 列、2467 个非空值逐列 count/maxLen/value multiset fingerprint **0 mismatch**；`db verify` PASS，`migration status` Up to date，`db` ref 已前移到新 storage hash。

fresh PostgreSQL 从空库执行 baseline **672** + timestamp **126** + varchar **952**，合计 **1750 operations**；Seed / `db verify` / `migration status` 全绿。API typecheck/build exit 0，完整 API Rules **346/346 PASS、0 fail、0 skip**，`git diff --check` PASS。P3.3 正式完成，执行指针进入 **P3.4**。

P3.4 已完成：

- 通过 TypeScript AST 一次性删除 `prisma8Varchar/prisma8Varchars` **2769 个调用**，并清理 123 个对应 import specifier；
- `prisma8Id32()` **210 个调用 / 65 个 import** 统一迁到正式业务 helper `createLegacyId32(): string`；生成算法保持 `randomUUID().replaceAll('-', '')`，但不再以 Prisma migration compatibility 命名；
- 删除 `src/prisma/prisma8-varchar.ts`，并删除 `prisma8-values.ts` 中已无引用的 `prisma8Varchar` cast；
- `apps/api` 中 `prisma8Varchar` / `prisma8Varchars` / `prisma8Id32` / `prisma8-varchar` **全部 0 refs**；
- 长度越界测试改为验证正式 PostgreSQL CHECK violation，确认约束职责已经从应用 branded cast 下沉到数据库 contract；
- API typecheck/build、`git diff --check` 全绿，完整 API Rules **346/346 PASS、0 fail、0 skip**。

P3 正式完成，执行指针进入 **P4 Numeric / JSON domain 收口**。

P4 inventory 详见 `value-domain-inventory.md`：canonical contract 含 **12 个 Numeric** 与 **21 个 Jsonb** 字段。阶段开始时 `prisma8Numeric` 共 **66 calls / 23 files**（production 43 / 11），`prisma8JsonValue` 共 **52 calls / 24 files**（production 27 / 12）。

P4.1 已完成：新增 canonical `DecimalString` / `decimalString()` / `numericValue()` / `tryNumericValues()`。production **43/43** Numeric ORM 写入均强制先通过 precision/scale 校验；高级筛选不再经过 `Number()`；Contract / SalesOrder 未修改金额时不再把 DB Numeric 转为 JS number 后重新写回。专项测试固定 `0.1 + 0.2` 对 scale=2 必须拒绝，禁止隐式浮点舍入。

P4.2 已完成：新增统一 `jsonValue()` serializer；新 JSONB 对象统一经 JSON 序列化边界归一化，并拒绝 top-level undefined、BigInt、circular、NaN/Infinity 等非法/会静默失真的输入。production 的 `as JsonValue` 只保留 canonical serializer 内部唯一 cast，ExportTasks 私有重复 serializer 已删除。

P4.3 已完成：删除 `src/prisma/prisma8-values.ts`，`prisma8Numeric` / `prisma8JsonValue` / `prisma8-values` **全部 0 refs**。

P4 最终门禁：API typecheck/build、`git diff --check` 全绿；value-domain 专项 **2/2 PASS**；完整 API Rules 因新增两条 domain 专项变为 **348/348 PASS、0 fail、0 skip**。P4 正式完成，执行指针进入 **P5.1 / P5.2**。

P5.1/P5.2 已完成 canonicalization：

- runtime 文件正式命名为 `prisma-client.ts / prisma.service.ts / prisma.module.ts / temporal.ts`；
- 导出正式命名为 `PrismaClient / createPrismaClient / PrismaService / PrismaModule`，Temporal 边界为 `nowInstant / instantFromDate / instantFromISOString / instantFromEpochMilliseconds / instantToISOString`；
- Seed 正式命名为 `seed-bootstrap.ts / seed-demo.ts`，入口函数改为 `runBootstrapSeed / runDemoSeed`；
- 原 `*.prisma8.test.ts` / `*prisma8-test-harness.ts` / `prisma8-orm-test-stub.ts` 全部改为正式测试/辅助文件名；`*.compat.test.ts` 同步改为正式测试名；
- `apps/api/src` 与 `apps/api/prisma` 源码中 `Prisma8 / prisma8 / .prisma8.` **0 refs**；
- 清空旧 `apps/api/dist` 后重新 production build，新的 dist 中 `*prisma8*` / `*compat*` 文件 **0**；
- API typecheck 与 production build **exit 0**。

P5.1/P5.2 完成后执行指针进入 **P5.3**。

P5.3 最终工程门禁已完成：

- canonical test scripts 已同步：API `test:rules` 改为包含 `src/prisma/*.test.ts`，专项脚本改为 `test:prisma`，root 对应改为 `prisma:test`；
- `test:rules` 增加 `--import dotenv/config`，避免真实 PostgreSQL tests 因 `DATABASE_URL` 未载入而被静默 skip；
- root typecheck 等价执行：shared build/typecheck、frontend-shared typecheck、API contract emit/typecheck、Web typecheck、Mobile typecheck **全部 exit 0**；
- root production build 等价执行：shared、frontend-shared、API、Web、Mobile **全部 exit 0**；
- root lint：**exit 0，0 errors / 80 warnings**；
- API Rules：**348/348 PASS、0 fail、0 skip**；
- canonicalization 后发现并修正 Announcements CRUD 测试关键词仍保留旧 `PRISMA 8` 文案的问题，单测与全量 Rules 均已复验；
- `git diff --check` PASS。

P5.3 完成后执行指针进入 **P5.4**。

P5.4 existing/fresh PostgreSQL 最终复验已完成：

- canonical contract storage hash：`0d036f3fcbf3d2169c7530c49e3d96ae1c1961b75c8d3bbfe89bddebb274e0fe`；
- existing DB：`contract emit / db verify / migration status / migration check` 全部 **exit 0**，marker/current/target 三者一致；
- migration graph 精确为：
  - `20260918T0338_baseline`：**672 operations**；
  - `20260918T0826_timestamp_absolute_instants`：**126 operations**；
  - `20260918T0923_varchar_text_length_constraints`：**952 operations**；
  - 合计 **1750 operations**；
- fresh PostgreSQL 从空库执行三段 migration：**3/3 applied、1750/1750 operations**；
- fresh bootstrap Seed、`db verify`、`migration status` 全绿；
- fresh Seed 后：tenant **1**、users **4**、roles **3**、departments **4**、plans **2**；
- fresh schema 物理核验：`timestamptz` 列 **126**，P3 `char_length` CHECK **476**；
- fresh 临时数据库已正常删除，无残留。

P5.4 完成后执行指针进入 **P5.5**。

P5.5 Docker release smoke 已完成：

- 仓库原始 `docker/release-smoke.sh` 在隔离 Docker-in-Docker daemon 中最终 **STATUS=0 / PASS**；
- API / Migration / Web 三张 release image 均完成真实构建；
- release smoke 首轮暴露 `docker/migrate.Dockerfile` 仍引用 P5.2 已删除的 `prisma8-client.ts / prisma8-temporal.ts / prisma8-values.ts`，已精确修正为 canonical `prisma-client.ts / temporal.ts / numeric-value.ts`；
- 修正后的 migration image 专项构建成功，并在最终完整 smoke 中再次通过；
- fresh PostgreSQL 中三段 migration **3/3 applied、1750 operations**，marker hash 为 canonical storage hash；
- bootstrap initialization、`db verify`、`migration status` 全绿；
- Worker entry 与 API image 均正常启动；
- bootstrap administrator login 与 Redis-backed read cache 验证通过；
- 重复 initialization 不会重置 administrator password；
- Web image 启动后 PC/Mobile SPA fallback 与 `/api` proxy 验证通过；
- 最终脚本输出：`PASS: slim API/worker runtime, Redis cache integration, automatic bootstrap initialization, PC/Mobile SPA fallback and /api proxy are healthy`；
- DinD 与 smoke 临时资源已全部清理，无本地归档/容器残留。

P5.5 完成后执行指针进入 **P5.6**。

P5.6 Browser 代表性真实回归与 API runtime log gate 已完成：

- 使用 Desktop Host 隔离 Browser profile 登录真实本地 CRM，bootstrap administrator 登录成功并进入 Dashboard，首页真实数据正常加载；
- 商机页真实加载 `测试线索变更-商机`；高级筛选 popover、字段/操作符、添加条件与文本输入交互均完成实际 Browser 覆盖且无页面/runtime 异常。由于 Element Plus teleported popover 在 Host automation 下 selector/ref 会随响应式刷新失效，本次不把负向筛选结果声明为自动化断言，只记录已真实覆盖的筛选编辑交互链；
- 客户页真实加载 **48** 条数据，第一条 `测试线索变更` 的 Customer Overview Drawer 正常打开，客户基础信息、负责人及 12 个 Customer 360 关联 tab 正常装配；
- 线索页使用 `搜索名称 / 手机号` 输入 `测试线索变更` 并回车，真实返回 **1** 条匹配线索；
- 当前 3000 dev API 的 stdout/stderr 最终由 dev runner 写入 `/dev/ttys002`，无可检索日志文件；因此另以本次 Workbench 实时探测到的项目 Node **25.7.0** 启动同一 canonical `dist/main.js` 于隔离端口 3001，并捕获完整 stdout/stderr；
- 3001 runtime gate：`/api/health` 200，Redis / coordination / async-jobs ready；随后重放 login、auth-me、Dashboard page、Opportunity page、Customer page/detail、Lead keyword page，全部返回 2xx，数据量与 Browser 会话一致（Opportunity **1**、Customer **48**、Lead **1**）；
- 3001 stdout 约 169 KB / stderr 340 B 的 retained log 扫描：Nest ERROR **0**、Exception **0**、Unhandled **0**、TypeError **0**、RangeError **0**、codec error **0**、Prisma runtime error **0**；
- 临时 3001 API、一次性 runtime-gate 脚本与隔离 Browser session 均已关闭/删除，无测试资源残留。

P5.6 完成后执行指针进入 **P5.7**。

P5.7 最终文档封板已完成：

- `requirements.md / design.md / tasks.md` 状态统一切换为 **`VERIFIED`**；
- `docs/specs/README.md`、`docs/README.md`、`docs/project-progress.md`、`docs/alignment-log.md` 已同步 PRISMA8-002 最终事实；
- `docs/architecture.md` 已删除过时的 `Prisma8Module / Prisma8Service` 与 fixture adapter 描述，改为 canonical `PrismaModule / PrismaService` + native PostgreSQL tests；
- `docs/prisma-migration-policy.md` 已更新当前 migration graph 与 storage hash，同时保留 PRISMA8-001 handoff 时的历史证据语义；
- 当前 canonical storage hash 为 `0d036f3fcbf3d2169c7530c49e3d96ae1c1961b75c8d3bbfe89bddebb274e0fe`；
- 当前正式 migration graph 为 baseline **672** + timestamp **126** + varchar **952**，合计 **3 migrations / 1750 operations**；
- 最终工程基线：root typecheck/build exit 0，lint **0 errors / 80 warnings**，API Rules **348/348 PASS、0 fail、0 skip**，existing/fresh PostgreSQL verify/status 全绿，原始 Docker release smoke **STATUS=0 / PASS**，Browser/runtime log gate 全绿；
- 最终文档变更 `git diff --check` **PASS**；
- `PRISMA8-002` 当前执行指针归零，不保留后续迁移期 cleanup task。

