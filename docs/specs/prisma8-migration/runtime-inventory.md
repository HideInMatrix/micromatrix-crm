# PRISMA8-001 Runtime 迁移清单

## 1. 扫描基线

P3.1 以 `apps/api/src` 的 production TypeScript 为范围，排除 `*.test.ts` 与 Prisma 8 新 runtime 目录。

截至 2026-09-15：

- `PrismaService`：192 个文本引用点，覆盖业务 Service、Guard、Interceptor、Worker 与公共基础设施；
- `generated/prisma/client`：80 个命中，其中 1 个为 generated client 内说明性注释，production 直接 import 点为 79 个；
- `$transaction`：201 个命中，其中 3 个来自 generated client 声明/示例，其余为 production 调用或 transaction client 类型耦合；
- `Prisma.sql`：62 个 production 调用点；
- atomic `{ increment: ... }`：10 个 production 调用点；
- nested `upsert`：5 个；
- interactive transaction `maxWait/timeout`：2 个；
- Prisma JSON path filter：至少 1 个。

该清单作为 P3 每一批迁移后的递减基线。任何批次完成后必须重新扫描，不能只以“代码能编译”为迁移完成证据。

## 2. 风险分组

### A. 低风险只读 / 单模型访问

优先迁移不依赖 raw SQL、transaction、nested write、动态 Prisma 类型的查询路径。首个生产迁移目标：

- `EnterpriseAiRuntimeService`：仅按 `tenantId + modelId` 读取一条 `EnterpriseAiModels`，其余逻辑为凭据解密和外部 HTTP provider 调用。

后续候选需要逐个确认 DTO/时间类型和现有测试后再进入本组，不因为文件短小自动判定低风险。

### B. 普通 CRUD / 局部事务

包括产品、价格、成员、联系人、普通配置等模块。此组必须先解决：

- Prisma 7 `@default(cuid())` 的 client-side ID 生成；
- `@updatedAt` 自动更新时间；
- Prisma 7 `Date` 与 Prisma 8 `Temporal.PlainDateTime` DTO 边界；
- `updateMany/deleteMany/upsert` 在 Prisma 8 RC 的对应语义。

### C. 动态查询 / raw SQL / DataScope

包括 custom forms、metadata、home statistics、filter builder、DataScope、pool 查询等。此组需要把 `Prisma.sql/raw/join/empty` 转为 Prisma 8 raw lane，并保持参数化、动态字段和租户边界。

### D. 高风险事务 / 并发 / 外部身份

最后迁移：

- approvals；
- organization sync；
- WeCom / DingTalk / Lark SSO；
- notifications / message outbox；
- distributed coordinator；
- pool ownership / recycle；
- follow-up 原子评论与计数；
- export worker / cron / seed。

这些模块依赖跨表事务、锁、幂等、重放保护或外部副作用，必须有真实 PostgreSQL integration 与专项 Rules 后才能切换。

## 3. P3.2 第一批

第一批只迁移 `EnterpriseAiRuntimeService` 的模型读取，不同时迁移 `EnterpriseAiModelsService` 的写路径。

验收要求：

1. feature module 显式 import `Prisma8Module`；
2. Service production code 不再 import/inject `PrismaService`；
3. Prisma 8 查询只 select 业务实际需要字段，避免无意义 Temporal/关系加载；
4. provider HTTP 行为、错误语义和凭据解密逻辑不变；
5. API Rules、typecheck、production API image build 继续通过。

### P3.2 结果

`EnterpriseAiRuntimeService` 已完成切换并通过：API typecheck、272/272 API Rules、正式 Node 25 production image build。该 canary 证明 feature-module 级 Prisma 8 opt-in 可工作，且不要求把整个 Nest API 切为 ESM 或把 Prisma 8 runtime 全局化。

进入 P3.3 前暂不迁移 `EnterpriseAiModelsService`。它同时涉及 create/update/delete、route transaction、case-insensitive filter、`in/not`、Prisma 7 `cuid()`/`@updatedAt` 和 Date/Temporal 边界，必须先收口 client-side default 策略。

## 4. P3.3 普通写路径

Client-side default 策略已经通过真实 runtime gate 收口：

- 135 个 Prisma 7 `cuid()`：53 个 PostgreSQL `text` ID 由 Prisma 8 contract `@default(cuid(2))` 承接；82 个 `varchar(32)` ID 不能使用 RC 的 cuid2 contract default，留给统一应用层 ID helper；
- 40 个 Prisma 7 `@updatedAt`：当前 `@prisma/orm-postgres@8.0.0-rc.10` 的 timestamp preset 使用 Instant generator，与 `timestamp without time zone` 的 PlainDateTime codec 不兼容，因此不在 contract 中恢复；迁移写路径统一显式调用 `prisma8Now()`；
- 上述最终 contract 与原 live-inferred storage deep-equal，数据库结构和 migration ownership 均未变化。

P3.3 第一条写 canary 为 `EnterpriseMailSettingsService`：

- Prisma 7 `findUnique/upsert/update` 已切为 Prisma 8 Collection API；
- `EnterpriseMailSettings.id` 属于 PostgreSQL `text`，由 contract CUID2 自动生成；
- `updatedAt` 由应用层 `prisma8Now()` 显式维护；`lastTestedAt` 使用 Date/Temporal 边界 helper；
- 密码留空保留已有密文、SMTP probe、成功/失败结果写回及返回 VO 保持原语义；
- 真实 PostgreSQL integration 已证明 Prisma 8 写入可由 Prisma 7 正确读回。

第二条 transaction / batch canary 为 `EnterpriseAiModelsService`：

- Prisma 7 delegate 已切到 Prisma 8 Collection API，普通 create/update/delete 均保持 tenant 边界；
- 模型搜索使用 Prisma 8 `or + ilike`，路由合法性使用 `in`，不再依赖 Prisma 7 case-insensitive filter / `in` 语法；
- 模型删除使用 Prisma 8 callback transaction，在同一事务执行关联 route `deleteAll` 与 model `delete`；
- 路由策略替换使用同一 callback transaction 执行 `deleteAll + createAll`，批量写入显式补 `updatedAt: prisma8Now()`；
- 真实 PostgreSQL integration 已证明 Prisma 8 模型 create/update、`or + ilike` 关键词查询、批量 route replacement 和 transaction delete 均正常；Prisma 8 写入可由 Prisma 7 正确读回，API Key 留空保留旧密文、路由顺序与删除语义保持不变；
- Enterprise Settings 在数据库环境下 9/9 PASS，Prisma 8 compatibility 1/1 PASS，API typecheck 与 API build 均 PASS；完整 API Rules 在同一本地 PostgreSQL 环境下为 274/274 PASS、0 FAIL、0 SKIP；migration immutable checksum 与 `git diff --check` 均 PASS。

P3.3 的普通 transaction / batch 功能覆盖已经完成，但 production image gate 仍由外部 Host 隔离阻塞：Docker Desktop 与 Buildx 均可发现，正式 `docker build` 仍在 Buildx 更新 `~/.docker/buildx/activity` 时收到 `operation not permitted`，`default` context 的 `/var/run/docker.sock` 同样被拒绝；Host identity 又不接受 `BUILDX_CONFIG` env override，因此无法仅把 Buildx 状态目录迁到 workspace。`micromatrix-crm-api:prisma8-p3-batch2` 尚未成功产出，因此 P3.3 暂不封板。该外部 gate 不再阻塞 migration mainline，P3.4 在保留此待补 gate 的前提下继续推进。

## 5. P3.4 Raw SQL / 动态字段 / DataScope

P3.4 已完成，并建立 Prisma 8 raw lane 的真实 runtime 基线：

- `client.raw.sql\`...\`` 负责 whole-statement raw authoring；读取结果必须 `.returnsRow(...)`，再由 `client.runtime().query(plan.build())` 执行；
- 普通 interpolation 只承担 value parameter 语义，不能作为 table/column identifier；动态 identifier 必须来自封闭枚举，并通过静态 SQL 分支进入查询；
- compatibility raw canary 已在真实 PostgreSQL 通过，证明绑定参数与 declared codec row decode 正常。

`CustomFormsService` 已完成整组 raw 迁移：

- `CustomFormsModule` opt-in `Prisma8Module`；
- 非内置数据源的 `loadDataSourceOptionsByIds / loadDataSourceOptionsByName` 已从 Prisma 7 `$queryRaw` 切到 Prisma 8 raw lane；
- 13 类内置业务数据源不再使用 `Prisma.raw(dynamicTable)`，改为封闭枚举对应静态 SQL；by-id/by-name 共 26 个分支已在真实 PostgreSQL 执行；
- 高级筛选的系统字段、普通动态字段、Blob、多选 JSON、数值、日期、空值与 AND/OR 均改为 Prisma 8 raw expression；
- 真实 PostgreSQL integration 覆盖 organization/customFormId 隔离、ID 集合、跨边界数据、含单引号参数与上述筛选语义，PASS；该服务内 `Prisma.sql/$queryRaw` 已归零。

`ResourceFieldValueService` 也已完成筛选查询迁移：

- 14 个 `ResourceFieldType` 的主表以及对应 normal/blob Field 表全部通过静态 switch 选择，不把 identifier 当 value interpolation；
- `buildFilter/filterResourceIds` 走 Prisma 8 `raw.sql -> returnsRow -> runtime().query`；
- 真实 PostgreSQL gate 逐一执行 14 类主表查询，并在 customer 上覆盖普通 Field、Blob 多选、ISO datetime 范围与跨 tenant 隔离；
- datetime 存储契约为 ISO 字符串，因此范围比较使用 `::timestamptz`。旧 builder 对 ISO 调 `Number(...)` 再做 `::numeric` 的不可执行路径已随迁移修正；
- 该服务仅剩两处 `pg_advisory_xact_lock` Prisma 7 raw 调用，明确划入 P3.5。

P3.4 最终扫描：production `Prisma.raw = 0`、`Prisma.join = 0`、`Prisma.sql` 从基线 **62 降至 5**。5 处全部为 advisory lock；另有 organization-sync tagged `$queryRaw` advisory lock，全部划入 P3.5。PrismaService 启动 `SELECT 1` 属于 P3.6 公共基础设施。

最终 gate：API typecheck PASS、API build PASS、Prisma 8 compatibility 2/2 PASS、Custom Forms / Metadata 真实 PostgreSQL integration PASS、完整 API Rules **277/277 PASS（0 skip）**、migration immutable checksum PASS、`git diff --check` PASS。P3.4 正式封板，迁移主线进入 P3.5。

## 6. P3.5 审批 / 组织同步 / Message Outbox / 并发协调

P3.5 已先从可以保持完整 transaction ownership 的并发路径切入：

- `DistributedCoordinatorService.runScheduledWithPostgresFallback` 已由 Prisma 8 transaction 持有 PostgreSQL xact advisory lock。该 callback 不向业务 task 暴露 transaction client，因此锁事务可以完整迁移，不存在 Prisma 8 持锁、Prisma 7 写业务数据的跨连接问题；
- 真实双 client gate 证明同 key `pg_try_advisory_xact_lock` 在首个 Prisma 8 transaction 生命周期内保持互斥，transaction 结束后正常释放；
- `ExportTasksService.enqueue` 的 advisory lock、PENDING 配额、module 去重和 create 已整体迁到 Prisma 8 transaction；其它 worker/list/download 路径暂留 Prisma 7；
- `MessageDeliveryService` 的 outbox 创建采用 Prisma 8 callback transaction + `MessageDeliveries.createAll`。text ID 使用 contract CUID2，`createdAt/attempts/maxAttempts` 继续走 storage default，旧 `@updatedAt` 路径显式写 `prisma8Now()`；
- MessageDelivery worker CAS 使用 Prisma 8 raw `UPDATE ... RETURNING id`，业务参数仍绑定；由于表字段未使用 `@map`，camelCase physical columns 必须 quoted，真实 PostgreSQL gate 已验证；
- MessageDelivery 成功/失败/终止回写使用 Prisma 8 Collection update，Date 边界通过 Temporal helper；Provider 调用、delivery detail read 与管理列表关系装配暂留 Prisma 7，避免一次性扩大关系查询迁移面；
- MessageDelivery 手工 `retry` 的状态重置已切到 Prisma 8 Collection update，随后仍由 Prisma 7 读取 VO 关系字段；Cron stale `SENDING` 恢复使用 Prisma 8 `updateAll`，due ID 扫描也已切到 Prisma 8 Collection，按 channel/status/`nextAttemptAt` 参数化过滤、createdAt 排序并限制 50 条。这样 outbox 的 create / stale recovery / due scan / claim / result / retry 控制链均已由 Prisma 8 持有，仅列表、Provider 所需 detail read 与 VO 关系装配继续保留 Prisma 7；
- 真实 PostgreSQL cross-runtime gate 覆盖 PENDING/DEAD 批量创建、两个 worker 并发 claim、retry due/future、SUCCEEDED、FAILED 与 attempts 耗尽后的 DEAD，Prisma 7 均可读回一致结果。
- 审批首条 transaction canary 选择 `ApprovalsService.cancel`：读取/权限判断暂留 Prisma 7，真正的状态提交由 Prisma 8 callback transaction 执行 `ApprovalTasks.where(instanceId + PENDING).updateAll(SKIPPED)` 与 `ApprovalInstances.where(id).update(CANCELED)`；task/instance `updatedAt` 以及 `finishedAt` 显式使用 Temporal。真实 PostgreSQL 验证 PENDING 批量跳过、已 APPROVED 历史不修改、instance 取消结果与事务外资源恢复链均保持原语义。
- 审批第二条 transaction canary `ApprovalsService.revokeTask` 已整体由 Prisma 8 transaction 持有：source task / instance / flow / task snapshot 查询、下游 PENDING task `updateAll(SKIPPED)`、source task reopen 与 instance nodeIndex 回退均在同一 transaction 内；撤回判断只依赖状态、nodeId/index/round 与冻结节点 JSON，因此通过结构化最小类型同时兼容 Prisma 7/8 row，而不泄漏两套 ORM 的名义类型。真实 PostgreSQL gate 验证撤回后的 source task、下游 task 与 instance 状态，并验证重复撤回 fail-closed。
- Approval write lane 已进一步覆盖 `approveTask/rejectTask/signTask/returnBackTask/advance/finalizeApproved` 及字段/后置字段摘要回写：ApprovalRecord 与附件关系、AddSign/ReturnBack 记录、APPROVAL/CC/SKIPPED task 批量写和 instance 状态推进均通过 Prisma 8 Collection/transaction 完成；真实 PostgreSQL 专项现为 **16/16 PASS**。`ApprovalsService` 对 Approval* 模型的 production Prisma 7 write 调用已扫描归零，剩余 legacy client 仅用于读取、关系装配和规则判断。
- RC10 migration compatibility：`createMany(skipDuplicates)` 无直接 Prisma 8 等价参数时，附件关系使用 `create()` + SQLSTATE `23505` 精确吞唯一冲突；`varchar(N)` branded input 与 `JsonValue` 的边界统一隔离到 `prisma8-values.ts`，避免业务代码散落强制 cast；nullable enum inequality 使用 `neq()` 并显式 OR `isNull()` 保持 PostgreSQL 三值逻辑。
- `OrganizationSyncApplyService.applyCore` 已按整笔 transaction ownership 迁入 Prisma 8：`pg_advisory_xact_lock`、batch/integration/role/conflict gate、Department/User/UserRole、Department/User mapping、item result、department leader、batch SUCCEEDED、integration SUCCEEDED 与 tenant `enterpriseSynced` 均在同一 callback transaction；Prisma 7 nested UserRole create 拆成同事务的 `Users.create + UserRoles.create`，复合 mapping upsert 改为持锁事务内 `first -> update/create`。
- organization-sync 主事务失败后需要独立持久化的 batch FAILED、integration FAILED、OperationLog/Blob 审计也已切到 Prisma 8，但继续位于回滚事务之外；OperationLog nested blob create 拆成单独 Prisma 8 transaction 内的 `OperationLogs.create + OperationLogBlobs.create`。真实 PostgreSQL 成功 gate 验证所有实体可由 Prisma 7 cross-runtime 读回；失败 gate 验证业务写全部 rollback、item 保持 PENDING，同时失败审计独立持久化。

Toolchain side note：项目主 `typescript` 已统一为 **7.0.2**。API/shared 等主编译直接使用 TS7；Vue SFC checker 与 ESLint 因上游仍依赖 TypeScript 6 JavaScript API，通过隔离 `@typescript/old@6.0.3` backend 运行。该兼容层仅存在于 `tools/vue-tsc.mjs` / `tools/eslint-ts6.mjs`，不改变 production TypeScript 主版本。

P3.5 阶段中期 legacy 并发 SQL inventory 曾为 production `Prisma.sql` **3** 处（Pool transaction lock 1、`ResourceFieldValueService` unique field lock 2）；随后 Pool / Metadata 父 transaction 已按“锁与受保护写必须同 connection + 同 transaction”整体迁入 Prisma 8。最终 production `PrismaService`、legacy Prisma Client package、`Prisma.sql` 与 legacy Prisma runtime import 扫描均为 **0**。

最终 gate：P3.5 已完成并纳入 P5 封板；API Rules **346/346 PASS（0 fail / 0 skip）**，root typecheck/lint/build 均 exit 0，fresh PostgreSQL baseline/bootstrap/`db verify`/migration status 全绿，原始 Docker release smoke exit 0，代表性 Browser 回归全绿。PRISMA8-001 状态为 `VERIFIED`。

## 7. P3.6 Seed / Worker / Cron / 公共基础设施

- `ExportWorkerService` 已改由 Prisma 8 显式读取 Users/UserRoles/Roles 恢复导出 worker 的 AuthUser 上下文；
- `ResourceFieldAttachmentCleanupService` orphan/temp cleanup Cron 候选扫描使用 Prisma 8 参数化 raw lane；
- `MessageExpiryService` 的报价 / 合同 / 回款计划到期扫描均改为 Prisma 8 static join raw，真实 PostgreSQL gate PASS；
- `OperationLogSettingsService` 与 `OperationLogCleanupService` 已脱离 Prisma 7。settings 使用 PostgreSQL atomic upsert；cleanup 使用 `DELETE ... RETURNING` 批删。RC10 raw enum decoder 对 `OperationLogCleanupSource` 缺 type params，raw `RETURNING` 显式 cast `::text` 后使用 nullable `pg/text@1`；
- `AnnouncementsService.publishDueAnnouncements/publishIfDue` 的 Cron 数据路径已切 Prisma 8，真实 PostgreSQL gate 验证时间窗口与 notice CAS；
- `OpportunityRuleService.executeAutoClose` Cron 已切 Prisma 8，包括 scope user 展开与 Opportunity fail-stage 回写。为 Prisma 8 contract `Varchar<N>` 输入新增 `prisma8-varchar.ts` 的长度校验 branded boundary；
- `MessageDeliveryService` Cron 的 worker scalar read 已切 Prisma 8；Cron 的 stale recovery / due scan / claim / read / result write 已全部属于 Prisma 8；
- `BiddingService` 08:00 抓取链已切 Prisma 8：enabled source / keyword 扫描、抓取去重写入、Numeric/Temporal 编码、`lastFetchAt` 回写均不再依赖 Prisma 7；真实 PostgreSQL gate 验证二次抓取 unique hash 不重复；
- `FollowUpPlansService` 09:00 reminder 链已切 Prisma 8：due scan、`UPDATE ... RETURNING` CAS claim、Clue/Customer/Opportunity 名称读取及通知失败 release 均由 Prisma 8 执行；真实 PostgreSQL gate 验证同日去重和失败回滚；
- `PrismaService` 不再执行 legacy `$queryRaw SELECT 1`；数据库启动 fail-fast 由 `Prisma8Service.onModuleInit()` 执行 Prisma 8 raw probe。`AppModule` 与 `WorkerAppModule` 均显式加载 `Prisma8Module`，compat 新增 lifecycle 真库 gate并 **3/3 PASS**；
- Seed 已整体切 Prisma 8：`prisma/seed.ts` 的 bootstrap/default demo 两条正式入口都只调用 Prisma 8 seed；`seed-demo-legacy.ts` 已删除。demo seed 覆盖 4 users / 9 forms / stage / pool / capacity / views / dashboard / approval flow / bidding / Customer/Clue/Contact 业务样例，全部使用 contract CUID2 或显式 `prisma8Id32()`；
- fresh PostgreSQL Seed 最终 gate PASS：3 个现有 migration deploy 后，默认 `prisma/seed.ts` 连续执行两次，得到稳定的 4 users / 3 roles / 47 message settings / 9 forms / 2 clue pools / 2 customer pools / 5 views / 1 approval flow / 6 customers / 3 clues 等完整 demo 数据，第二次不重复增长。`packages/migrate` / `docker/migrate.Dockerfile` 已携带 Prisma 8 runtime、Temporal 与 contract JSON；P4 前 Prisma 7 仍只负责 migration deploy ownership；
- P3.6 当前完整 Rules **295/295 PASS**，root typecheck/build/lint PASS，migration checksum PASS，`git diff --check` PASS。

P3.6 `COMPLETE`。唯一仍使用 Prisma 7 的 Cron 是 `PoolRecycleService`；它与 Pool transaction advisory lock 和 Metadata 父 transaction ownership 强耦合，已明确转入 P3.7 production import sweep，必须与父事务整体迁移，不允许跨 runtime 假锁。

## 8. P3.7 Production Prisma 7 import sweep

- production runtime 最终精确扫描：按 `apps/api/src/**/*.ts` 排除 test/spec、`src/prisma/**`、`src/prisma/**` 后，`generated/prisma/client`、`PrismaService`、`legacy Prisma Client package`、`Prisma.*` 均为 **0 FILES / 0 REFS**；P3.7 开始时 `PrismaService` production 文件为 **67** 个；
- `DashboardAccessService` 已完全切到 Prisma 8：部门路径、用户/部门 scope 校验与成员装配均使用 contract ORM；legacy `Dashboard -> DashboardModule` relation include 改为显式两段查询后装配，保留原上层返回结构；真实 PostgreSQL gate **1/1 PASS**；
- `DashboardModuleService` 已完全切到 Prisma 8：legacy `varchar(32)` ID 使用 `prisma8Id32/prisma8Varchar` 边界，目录 CRUD、树/收藏统计、环检测及拖拽重排 callback transaction 全部脱离 Prisma 7；真实 PostgreSQL gate **1/1 PASS**；
- `DashboardResourceService` 已完全切到 Prisma 8：资源 CRUD、分页、详情、收藏、收藏分页、relation 装配和跨目录拖拽重排均使用 Prisma 8；`DashboardCollection` 唯一冲突按 PostgreSQL SQLSTATE `23505` 收口；真实 PostgreSQL gate **1/1 PASS**；
- `HomeDepartmentScopeService` 已切 Prisma 8 部门树与 ACTIVE 成员范围读取，保留缓存与 DataScope 组合语义；原首页 scope 单测 **4/4 PASS**，真 PostgreSQL gate **1/1 PASS**；
- `ScopeResolverService` 与 `DataScopeService` 已切 Prisma 8 Users/Departments 读取；前者真库验证 `user:/dept:` token、后代展开及跨租户隔离，后者真库验证 CUSTOM 后代范围和 ACTIVE owner/creator 过滤，两条 gate 均 **1/1 PASS**；
- `LogsService` 已切 Prisma 8 Collection 数据库分页/aggregate：OperationLog 关键词 OR `ilike`、Blob 显式分表详情、LoginLog email `ilike` 均由真 PostgreSQL gate 验证 **1/1 PASS**；
- `HomeClueStatisticQuery` / `HomeOpportunityStatisticQuery` 的统计读库已切 Prisma 8；列表跳转协议使用本地结构类型，已移除 generated Prisma where 类型依赖。真库 gate **1/1 PASS**，覆盖线索转换/公海排除、AFOOT 与 END+100 阶段及 Numeric amount sum；
- `AuthGuard` 已切 Prisma 8 `UserKey -> Users -> UserRoles -> Roles` 显式装配，API Key Temporal 过期判断、权限合并和缓存写入真库 **1/1 PASS**；
- `MessageDeliveryService` 已清掉剩余 Prisma 7 integration/mapping/list/retry 读路径；管理列表使用 Prisma 8 user-name `ilike` + DB offset/limit/aggregate，原专项 **13/13 PASS**，真库 cross-runtime **1/1 PASS**；
- `CustomerAccessService`、`CustomerPoolConfigService`、`CluePoolConfigService` 已切 Prisma 8 独立读取；Pool Repository 写事务保持原样。三条真实 PostgreSQL gate 均 **1/1 PASS**，覆盖客户协作/租户隔离、noPick、阶段校验、用户名称和 `dept:` 管理员 scope；
- `NotificationsService` 已完全切 Prisma 8 Collection：来源幂等冲突按 PostgreSQL SQLSTATE `23505` 收口，列表/未读数走 DB aggregate，已读更新使用 `updateAndCount`，来源清理使用 `deleteAndCount`；原专项 **7/7 PASS**，真 PostgreSQL gate **1/1 PASS**；
- `ContractStageService` / `OrderStageService` 已切 Prisma 8 `groupBy + aggregate`、显式 legacy varchar ID、callback transaction 排序和高级流转 `deleteAndCount/createAll/updateAndCount`；真实 PostgreSQL gate **2/2 PASS**。其中 `sales_order.stage` 的 `varchar(50)` 与阶段配置主键 `varchar(32)` 已按真实 storage codec 分开处理；
- `UserViewsService` 已切 Prisma 8：View / Condition relation include 与 nested create 改为 callback transaction 内显式两表写入，4096 排序、条件替换、ownership、启停/固定、拖拽重排和同名唯一冲突均保持；原专项 **7/7 PASS**，真 PostgreSQL gate **1/1 PASS**；
- `AnnouncementsService` 已完成剩余 Prisma 7 CRUD/read 清退：列表分页、公告 CRUD、部门递归接收范围、ACTIVE 用户校验和 VO 名称装配均使用 Prisma 8；JSONB receiver snapshot 与 Temporal 时间由真实 PostgreSQL CRUD + Cron gate **2/2 PASS** 验证；
- `ApprovalWebhookService` 已切 Prisma 8 `ApprovalWebhookDeliveries` 写链，`updatedAt/startedAt/finishedAt` 统一显式 Temporal，错误字段走 varchar 边界；成功/失败 delivery 状态机真 PostgreSQL gate **1/1 PASS**，Prisma 7 cross-runtime 可读回 SENT/FAILED 审计结果；
- `ContractFieldsService` / `ProductPriceFieldsService` / `OrderFieldsService` / `QuotationFieldsService` 的 batch reader 与父级保存 transaction ownership 均已收口到 Prisma 8；读取侧通过资源表先做 organization scope，再读取 normal/blob field 并装配 Product/ProductPrice 名称；组合真 PostgreSQL gate **1/1 PASS**，覆盖跨租户 resourceId 排除与 normal/blob 合并；
- `FollowCommentServiceBase` + `FollowCommentsService` + `FollowPlanCommentsService` 已整体切 Prisma 8：add/update/remove 的 Comment/Mention/commentCount 均位于同一 callback transaction，分页 aggregate、两层回复、mention ACTIVE 校验、Users/UserExtensions 装配与目标资源名称读取也已脱离 Prisma 7；原评论专项 **10/10 PASS**，FollowRecord/FollowPlan 组合真 PostgreSQL gate **1/1 PASS**；
- `AuthService` 已完成 Prisma 8 全量迁移：注册链 Tenant/Department/Role/User/UserRole/optional Subscription 位于单一 callback transaction；login / external login / refresh / me 使用显式 User/Tenant/Department/UserExtension/UserRole/Role 装配，LoginLog 与 changePassword/authVersion 写链也已脱离 Prisma 7。真 PostgreSQL gate **1/1 PASS**，覆盖注册、大小写不敏感登录、成功/失败登录审计、refresh、me、改密后旧 refresh token 失效及新密码重新登录；
- `HomeOverviewService` 已完成 Prisma 8 只读聚合迁移：summary / funnel / ranking / trend / conversion 统一将 DataScope owner filter 归一为 owner ID 集合，StageConfig 关系条件改为显式 stage ID 查询；真 PostgreSQL gate **1/1 PASS**，覆盖 owner scope、赢单/输单阶段、金额聚合、排行、6 个月趋势和线索转化，跨 scope 数据不泄漏；
- `AttachmentsService` 已完成 Prisma 8 CRUD/read 清退：upload/list/batch/temporary/remove、target scope 与 ApprovalInstanceAttachment 删除保护全部使用 Prisma 8，VO 时间显式 Temporal→Date；真实 PostgreSQL + LocalDiskStorage gate **1/1 PASS**，`attachments/*.test.ts` 已加入完整 Rules；
- `ExportTasksService` 已完成剩余 Prisma 7 清退：enqueue advisory transaction、beginAttempt attempts/startedAt、taskForWorker、complete/fail PENDING CAS、recover/list/download/cancel/expired cleanup 均使用 Prisma 8；原专项 **5/5 PASS**，扩展真 PostgreSQL gate **1/1 PASS** 覆盖 enqueue 配额/去重、beginAttempt、FAILED、SUCCESS 文件落盘与 cancel 清理；
- `OrganizationSyncApplyService` 的事务外残余读取已切 Prisma 8：初始 Batch、DISABLE user IDs、直属下级与 APPLIED user IDs 均使用 contract ORM；原 advisory-lock 主事务、失败审计和回滚语义保持不变，成功/失败真实 PostgreSQL gate **2/2 PASS**；
- `ApprovalResourceCaptureService` 已切 Prisma 8 四类审批资源快照读取：Quote/Contract/Invoice/SalesOrder 主资源先做 organization scope，再显式读取 normal/blob/snapshot 子表；JSON 快照结构及 Numeric/BigInt 字符串化语义保持不变。Contract 真 PostgreSQL gate **1/1 PASS**，覆盖跨租户 fail-closed；
- `ApprovalResourceRestoreService` 已切 Prisma 8 四类审批资源恢复：主表回滚与 normal/blob/snapshot 全量替换位于同一 callback transaction，后置 snapshot JSON 继续保留当前 approvalStatus/approved。Contract 真 PostgreSQL gate **1/1 PASS**，并通过故意 varchar(255) 越界验证失败时整笔恢复回滚；
- `OpportunityRuleService` 已完成 Prisma 8 全量迁移，legacy generated Prisma 类型 import 也已移除：规则 CRUD、关键词分页 aggregate、阶段有效性校验、scope/owner 名称装配和原 auto-close 均使用 contract ORM。真实 PostgreSQL **2/2 PASS**，`opportunities/*.test.ts` 已加入完整 Rules；
- `RolesService` 已完成 Prisma 8 全量迁移：Role/UserRole CRUD、成员计数、members 分页的 Role/Department/leader 显式装配、唯一角色保护、重复成员分配去重与 CUSTOM 部门有效性校验均使用 contract ORM；真 PostgreSQL gate **1/1 PASS**，并验证角色更新/成员移除的 auth cache 失效；
- `MembersService` 已完成 Prisma 8 全量迁移：成员分页/选项、User + UserRole 原子创建、角色替换、改密、状态切换、直属关系清理、13 类业务引用删除保护及 SysUserView/Notification 清理均使用 contract ORM；真 PostgreSQL gate **1/1 PASS**，覆盖关系装配、业务引用保护和无引用删除；
- `LarkSsoService` 已完成 Prisma 8 全量迁移：Tenant/EnterpriseIntegration discovery、ExternalUserMapping/ExternalIdentity 绑定管理、ExternalOAuthState 生命周期、User/UserExtension profile 更新均使用 contract ORM；OAuth state 单次消费使用 `updateAndCount`，Timestamp 显式 Temporal 转换，mapping→user relation 改为显式装配。原 QR/Web/Mobile OAuth 行为专项 **1/1 PASS**，新增真 PostgreSQL gate **1/1 PASS**；
- `DingTalkSsoService` 已完成 Prisma 8 全量迁移：Tenant/EnterpriseIntegration discovery、ExternalUserMapping/ExternalIdentity、ExternalOAuthState、User/UserExtension 均切 contract ORM；QR/工作台 OAuth state 单次消费使用 `updateAndCount`，profile/avatar 与身份时间统一 Temporal。原 OAuth 行为专项 **1/1 PASS**，新增真 PostgreSQL gate **1/1 PASS**；
- `WeComSsoService` 已完成 Prisma 8 全量迁移：Tenant/EnterpriseIntegration discovery、ExternalUserMapping/ExternalIdentity、ExternalOAuthState、User/UserExtension 均切 contract ORM；QR/工作台 OAuth、工作台入口回跳校验、state 单次消费与 profile/avatar 更新保持原语义。原企微 OAuth 行为专项 **1/1 PASS**，新增真 PostgreSQL gate **1/1 PASS**；
- `EnterpriseIntegrationsService` 已完成 Prisma 8 全量迁移：WeCom/DingTalk/Lark 三 Provider 配置 CRUD、凭据版本、连接测试、同步开关、默认角色校验、active platform 切换和运行上下文均使用 contract ORM；原三 Provider 配置专项 **11/11 PASS**，新增真 PostgreSQL gate **1/1 PASS**；
- `OrganizationSyncService` 已完成 Prisma 8 全量迁移：gate、preview、Batch/Item 分页、冲突 resolve、默认角色/绑定校验和计数更新均使用 contract ORM；RC10 暂无 JSONB path contains 表达式，因此 `sourceData.name` 关键词仅在最小范围使用参数化 raw lane，并继续保持 DB 侧 `externalId/conflictMessage/sourceData.name` 不区分大小写筛选、排序和分页。原组织同步专项 **9/9 PASS**，新增真 PostgreSQL gate **1/1 PASS**；
- RC10 mutation 语义已由 runtime 本体复核：`updateAll/deleteAll` 返回同时支持 Thenable 与 AsyncIterable 的结果；只需要精确行数时优先使用 `updateAndCount/deleteAndCount`；
- `ApprovalFlowConfigService` 已完全切到 Prisma 8：Flow / Version / Node / Approver / Condition / Link relation include 改为显式装配；流程编号 counter 使用 transaction 内 `nextValue` CAS 保持并发原子递增，`enabled` 排序仅使用最小参数化 raw ID lane；真 PostgreSQL gate **1/1 PASS**，覆盖 `CTR-APV-00001 -> CTR-APV-00002`、version 1 -> 2、启停、软删除与节点图装配；
- `BusinessTitleService` 已完全切到 Prisma 8：CRUD、审批状态、必填配置、发票引用保护与高级筛选全部使用 contract ORM；AND 使用 typed expression 链，OR 保持数据库筛选后合并命中 ID 再执行最终数据库分页；真 PostgreSQL gate **1/1 PASS**，覆盖 keyword、AND/OR、`in/notIn/isEmpty/notContains`、CUSTOM/THIRD_PARTY 状态、配置切换、引用删除保护及 Prisma 7 cross-runtime readback；
- `ResourcePoolsService` facade、`CluePoolRepository`、`CustomerPoolRepository` 与 `PoolRecycleService` 已整体切到 Prisma 8：scope token、角色/部门祖先解析、owned count、ownerHistory、advisory-lock 与 protected-write transaction ownership 均在同一 Prisma 8 runtime；Pool repository unit **2/2 PASS**，资源池真 PostgreSQL gate **1/1 PASS**；
- `ApprovalsService` 已完成剩余 Prisma 7 client 读路径清退：module gate、待办/已办/抄送/我发起分页、instance detail/timeline、审批人解析、重复审批人策略、加签链、round、附件校验及 Flow → Version → Node/Approver/Condition/Link 均改为 Prisma 8 显式装配；高风险 approve/reject/sign/advance/cancel/return-back/revoke 真 PostgreSQL 专项 **6/6 PASS**，新增 read-path 真 PostgreSQL gate **1/1 PASS**；production 文件内 `this.prisma` / `PrismaService` 均为 0；
- `CustomFormsService` 已完成 Prisma 8 全量迁移：CustomForm/Admin/Role 配置域、SysModuleForm/Field/Blob 显式 callback transaction、访问控制与用户/部门解析，以及 CustomFormData + normal/blob Field + Attachment claim 数据事务均脱离 Prisma 7；relation include 改为当前页主表 + Field/Blob 批量装配，批改/批删使用 `updateAndCount/deleteAndCount`；raw data-source/filter gate 与新增完整 CRUD 真 PostgreSQL gate 合计 **2/2 PASS**，production 文件内 `this.prisma` / `PrismaService` 均为 0；
- P3.7 尾段完成 Products/ProductPrice、Quotes、ContractInvoice、Contracts、ContractPayment Plan/Record、Contacts、FollowUps、Orders、Leads、Opportunities、Customers 全量 production 迁移，并进一步清除 common/Home/Pool/OrganizationSync/FollowUp/Approvals 中仅剩的 generated Prisma 7 类型依赖；Customers/Orders/Leads/Opportunities 最新真 PostgreSQL gate 各 **1/1 PASS**；
- 最终审批 + FollowUp 高风险真 PostgreSQL 组合复验 **16/16 PASS**。完整 `test:rules` 同一文件集合因 Workbench pnpm cache 创建目录 EPERM，改用直接 Node `--test` 分四组执行，合计 **346 tests / 272 pass / 0 fail / 74 skip**；74 个 skip 均为直接 Rules 进程未注入 `DATABASE_URL` 的真库测试，关键迁移真库 gate 已单独执行；API TypeScript **7.0.2** `tsc --noEmit` PASS；
- P3.7 `COMPLETE`：production generated Prisma 7 import/runtime type/provider 扫描归零。Migration ownership 仍按计划由 Prisma 7 持有并进入 P4 handoff；CLI/scripts/adapter/config/generated artifacts 删除与 `prisma8` → canonical `prisma` 目录收口属于 P5。

## 9. P4 Migration ownership handoff

- 正式 Prisma 8 contract 已完成 live-schema handoff 校正：9 个现有 PostgreSQL unique index 使用 `@@index(..., unique: true)` 保留 index 形态，9 个 production 未使用的 one-to-one mirror relation 字段从 contract 省略；正式 `contract emit` PASS，开发主库与隔离验证库 `db verify --schema-only` 均 **0 issues**；
- 正式 storage contract hash 为 `651134f9ccfda014c4a27d235488e56b4640ad20fbf307fe0acaa0b8e39566de`，execution hash 为 `ee1184fbeb592072aa009813e818cb3444ede51deecdee3e8a696e7ac2e43e19`，profile hash 为 `3916f444a8a17ad749191acf9e08dad97d1a327b88c2f1d45d12f240296aa8b2`；
- 正式 Prisma 8 migration graph 收口为单一根 migration `20260918T0338_baseline`，migration hash `8664ea14548a7cf8419205988976d641f350b773488a2072c1f8f32e9d0312dd`，从 `@empty` 到最终 storage hash，共 **672 operations**；`migration check` PASS，`db` ref 指向最终 hash；
- baseline 对 Prisma 7 最终 schema 做对象级离线审计：**32 enums / 144 tables / 147 foreign keys** 全量一致；9 个 unique 对象仅由 Prisma7 `CREATE UNIQUE INDEX` 映射为 Prisma8 unique-index contract；六个 SQL-body 原生索引均存在于正式 migration；
- P4.1 隔离库 `db015b_validation_0910` handoff PASS：schema-only verify 先证明真实 schema 与最终 contract 一致，随后 `db sign` 将旧 marker 前移至最终 hash，`migration ref set db 20260918T0338_baseline` PASS，完整 `db verify` PASS，`migration status` 为 **Up to date**；
- P4.2 additive rehearsal PASS：临时 contract 仅给 `users` 增加 nullable `p4_rehearsal_note`，plan 精确生成 **1 个 additive operation**（`ALTER TABLE users ADD COLUMN ... text`）；隔离库 `db migrate --advance-ref db`、完整 verify/status 均 PASS，迁移后 legacy Prisma 7 Client 仍正常读取 5 users / 3-row sample。演练字段和临时 graph 未进入正式 contract/migrations；
- P4.3 开发主库正式 handoff PASS：handoff 前 Prisma7 `migrate status` 仍为 **3 migrations / schema up to date**；正式 Prisma8 `db sign`、`db` ref、完整 `db verify`、`migration status` 全部 PASS，marker/current/target 均为最终 storage hash；
- P4.4 Migration image / CI / release-init 已切 Prisma 8 migration workflow：API/root db scripts 改用 `contract emit / migration plan / db migrate / migration status / db verify / migration check`；Migration image builder 改为 `prisma contract emit` 并携带 `migrations/`、`prisma.config.ts`、Prisma8 contract/runtime；release smoke 改为 fresh DB 后执行 `db verify + migration status`；GitHub Release verify job 在 migration check 前执行 contract emit。正式 release 脚本扫描 `legacy Prisma 7 CLI migrate / legacy Prisma 7 CLI db push` 为 **0**，shell syntax PASS；
- P4.5 `docs/prisma-migration-policy.md` 已改为 Prisma8 contract/graph 唯一 ownership，并明确冻结 `legacy Prisma 7 CLI migrate dev/deploy/resolve` 与 `legacy Prisma 7 CLI db push`。Prisma7 generate/studio/client/adapter 暂留到 P5 删除，不再拥有 schema/migration 权限；
- P4 收口后 API TypeScript **7.0.2** `tsc --noEmit` PASS，正式 `contract emit` PASS，`migration check` PASS。Workbench 当前对宿主 Docker config/daemon 的访问仍不稳定，真实 Docker release smoke 不在 P4.4 伪装为 PASS，保留到 P5.5 最终 gate。

P4 `COMPLETE`。下一执行指针：P5.1 删除 Prisma 7 CLI/Client/adapter/config/generated artifacts，并将 `prisma/contract.prisma` / `src/prisma` 收口为 canonical `prisma/contract.prisma` / `src/prisma`。

## 10. P5 最终收口

- P5.1/P5.2：legacy Prisma Client / PostgreSQL adapter / `PrismaService` / module / generated client / legacy schema/config/migrations 已删除；canonical contract 为 `apps/api/prisma/contract.prisma`，generated contract 为 `apps/api/src/prisma/generated/`。仓库对 legacy CLI 执行标识、legacy Client/adapter package 名、旧 generated 路径、过渡 contract/runtime 目录和旧 contract 路径执行精确扫描，结果均为 **0 FILES / 0 REFS**；
- P5.3：独立 fresh PostgreSQL 从空库执行正式 `20260918T0338_baseline`（**672 operations**）→ bootstrap Seed → `db verify` → `migration status` 全绿；验证 demo tenant/admin、3 roles、4 departments、2 plans 后删除临时数据库；
- P5.4：完整 API Rules 按同一 131 文件集合拆 4 组真实数据库执行，分别 **66/66、97/97、96/96、87/87 PASS**，合计 **346/346 PASS，0 fail，0 skip**；root typecheck **exit 0**，lint **exit 0 / 0 errors / 121 warnings**，production build **exit 0**；
- P5.5：仓库原始 `docker/release-smoke.sh` **exit 0**。API/Migration/Web image 构建、fresh PostgreSQL migration/bootstrap、`db verify`、migration status、worker/API/Web runtime、管理员登录、Redis cache、重复初始化密码保护、PC/Mobile SPA fallback 与 `/api` proxy 全部 PASS；
- P5.6：Workbench Host Browser 恢复后完成真实回归：admin 登录、Dashboard、商机列表 + 高级筛选、客户 48 条列表 + 详情 Drawer/Customer 360、线索列表 + 关键词搜索；API 运行日志未发现 `ERROR`、runtime exception、HTTP 500、Unhandled 或 Prisma runtime error；
- P5.7：architecture / project progress / alignment log / docs index 已同步最终事实，`git diff --check` PASS，P5 临时 helper 与 release-smoke Docker 容器/网络均已清理。

`PRISMA8-001` 最终状态：**VERIFIED**。当前执行指针：无。

