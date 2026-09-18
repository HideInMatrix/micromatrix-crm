# PRISMA8-001 测试与验收计划

## 1. 原则

测试目标不是“CLI 能运行”，而是证明数据库结构、事务语义、业务接口和发布镜像在每个中间阶段都正确。任何阶段失败时，禁止继续推进下一阶段来掩盖问题。

## 2. Phase 0 基线

依赖变更前执行并记录：

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm --filter @micromatrix/api test:rules
pnpm --filter @micromatrix/api prisma:generate
pnpm --filter @micromatrix/api prisma:status
```

同时记录 Node、Prisma CLI/Client/adapter 版本、migration 目录、Git 状态、Prisma 7 import 与特殊 API 扫描数量。

## 3. Phase 1：Prisma 7 隔离回归

必须验证：

1. `legacy Prisma 7 CLI generate` 仍生成原路径和同等 Client 类型。
2. `legacy Prisma 7 CLI migrate status` 能读取当前数据库。
3. `legacy Prisma 7 CLI migrate deploy` 在无 pending migration 时为 no-op。
4. Seed 仍使用 Prisma 7 Client 正常启动。
5. API typecheck / Rules / build 全绿。
6. Migration Docker image 仍使用 Prisma 7 初始化现有 schema。
7. Phase 1 不产生任何业务 schema diff。

### Phase 1 实测结果（2026-09-15）

- `legacy Prisma 7 CLI generate`：PASS，Prisma 7 CLI `7.10.0-dev.58`，legacy Client `7.9.1`；
- `pnpm db:verify-migrations`：PASS，3 migrations / 2 published immutable；
- `legacy Prisma 7 CLI migrate status`：PASS，Database schema is up to date；
- root `typecheck`：PASS；
- API Rules：270/270 PASS；
- root `lint`：0 errors / 8 existing warnings；
- root production `build`：PASS；
- Node 25 Migration Docker image：PASS，成品镜像 Node `v25.9.0`，`legacy Prisma 7 CLI --version` 可执行；
- Phase 1 未新增 migration、未执行 schema write，migration ownership 仍为 Prisma 7。

## 4. Phase 2：Prisma 8 contract/runtime

- `contract infer` 可从 fresh DB 与当前开发 DB 生成 contract。
- 删除/忽略 `_prisma_migrations` ledger model。
- 模型、表、字段、schema mapping 与 live PostgreSQL 对齐。
- `contract emit` PASS，TypeScript 可 import emitted JSON/types。
- 双 runtime 一致性：Prisma 7 write → Prisma 8 read；Prisma 8 write → Prisma 7 read；两侧 rollback 都不可泄漏未提交数据。

### Phase 2 实测结果（2026-09-15）

- Prisma 8 CLI：`8.0.0-rc.14`；PostgreSQL runtime：`@prisma/orm-postgres@8.0.0-rc.10`；
- Node 25 下 `prisma contract infer`：PASS；live DB 共识别 145 个 model，移除 `_prisma_migrations` ledger 后业务 model 为 144 个，与 Prisma 7 schema 对齐；
- `contract emit`：PASS，storage hash `e3c4dbe588466be2d37e4f47e3f4e0d4a36f6d89a2f11c1abfc6af86435f8612`；
- emitted artifacts 固定到 `apps/api/src/prisma/generated`，production `tsc` 已验证 `dist/prisma8/generated/contract.json` 存在；
- Nest API 保持 CommonJS，Prisma 8 ESM-only runtime 通过原生动态 `import()` 加载；编译产物未产生 `require('@prisma/orm-postgres/runtime')`；
- Node 25 当前没有全局 `Temporal`，已通过 `@js-temporal/polyfill@0.5.1` 注册；真实查询验证 timestamp 输出为 `Temporal.PlainDateTime`；
- Prisma 7 → Prisma 8 双 runtime compatibility：1/1 PASS，覆盖 Prisma 7 write → Prisma 8 read、Prisma 8 write → Prisma 7 read、Prisma 8 transaction rollback；
- API typecheck：PASS；API Rules：271/271 PASS；
- `db:verify-migrations`：PASS，3 migrations / 2 published immutable；
- 正式 `docker/api.Dockerfile` Node 25 production image build：PASS，镜像 `micromatrix-crm-api:prisma8-p2` 成功生成；
- Phase 2 未新增/修改 migration，migration ownership 仍为 Prisma 7。

Phase 2 同时确认两个不能在 Phase 3 忽略的行为差异：

1. live PostgreSQL infer 无法恢复 Prisma 7 client-side `@default(cuid())` / `@updatedAt` 语义；当前 Prisma 7 schema 分别约有 135 / 40 处，写路径迁移时必须显式保持这些行为；
2. Prisma 8 RC 的 ORM projection 使用 `select('id', 'name', ...)` 等新 Collection API，不能机械翻译 Prisma 7 的对象式 `select/include`。

## 5. Phase 3：模块迁移矩阵

每批同时要求 Service/Repository 测试、真实 PostgreSQL integration、API smoke、全量 API Rules、root typecheck/lint/build；返回契约或行为可能变化时增加 Browser 回归。

| 类别 | 必测内容 |
| --- | --- |
| atomic increment | 并发请求下计数不丢失 |
| raw SQL | 参数化、返回类型、动态筛选、租户边界 |
| unique violation | SQLSTATE 23505 映射到原业务错误 |
| no row | 原 404/409 等 HTTP 语义不变 |
| nested writes | transaction 原子性、FK/cascade、rollback |
| batch/updateMany | 条件范围不扩大，租户隔离不回退 |
| transaction | 跨 Service 同事务写入仍一致 |

### P3.2 第一批实测结果（2026-09-15）

- 首个 production Prisma 8 consumer：`EnterpriseAiRuntimeService`；仅迁移 `EnterpriseAiModels` 单模型只读查询，写配置仍保持 Prisma 7；
- `EnterpriseSettingsModule` 显式 import `Prisma8Module`，Prisma 8 runtime 未提升为全局依赖；
- 新查询严格使用 `tenantId + modelId`，并只 select provider 调用所需字段；
- 专项规则覆盖 Prisma 8 where/select 与 OpenAI-compatible provider 请求契约；
- API typecheck：PASS；
- API Rules：272/272 PASS；
- 正式 Node 25 API image build：PASS，镜像 `micromatrix-crm-api:prisma8-p3-batch1`；
- migration history / ownership 未改变。

### P3.3 普通写路径阶段结果（2026-09-15，功能覆盖完成，production image gate 阻塞）

- 对 Prisma 7 client-side default 做了全量 mapping 审计：135 个 `cuid()` 与 40 个 `@updatedAt` 均能按 table/column 映射到 Prisma 8 live-inferred contract，0 unresolved；
- 135 个 CUID 字段按真实 storage codec 分为 53 个 `text` 与 82 个 `varchar(32)`。仅 53 个 `text` 字段保留 `@default(cuid(2))`；`varchar(32)` 在 Prisma 8 RC 上会因 `PSL_INVALID_DEFAULT_APPLICABILITY` 拒绝 emit，因此不写入 contract；
- 曾隔离验证 `temporal.timestamp(3, onCreate: now, onUpdate: now)` 可保持 storage hash，但真实 PostgreSQL write gate 暴露 `Temporal.Instant` → `Temporal.PlainDateTime` codec mismatch。正式方案已撤回全部 40 个 updatedAt preset，统一由 `prisma8Now()` 写入；
- 最终 contract：53 个 CUID2 defaults、0 个 updatedAt execution preset。`contract emit` PASS，storage hash 仍为 `e3c4dbe588466be2d37e4f47e3f4e0d4a36f6d89a2f11c1abfc6af86435f8612`，并与 client-default 变更前整个 emitted `storage` deep-equal；
- 第二批写 canary：`EnterpriseMailSettingsService` 已切到 Prisma 8 `where / upsert / update`，ID 使用 contract CUID2，`updatedAt` 使用 `prisma8Now()`，`lastTestedAt` 明确做 Date → Temporal 转换；密码密文保留、SMTP 测试结果及 VO 契约保持不变；
- 第二条 transaction / batch canary：`EnterpriseAiModelsService` 已切到 Prisma 8 Collection API，覆盖 `create/update/delete`、`ilike/or`、`in`、callback transaction、`deleteAll/createAll` 和路由顺序保持。模型与路由 `updatedAt` 均显式使用 `prisma8Now()`，text ID 继续由 contract CUID2 生成；
- 真实 PostgreSQL AI 模型 integration 已覆盖 Prisma 8 create/update → Prisma 7 read、`or + ilike` 关键词查询、API Key 留空保留旧密文、`updatedAt` 单调推进、路由 `deleteAll/createAll` 批量替换、transaction 删除模型与关联路由；PASS；
- Prisma 8 compatibility：1/1 PASS，覆盖 Prisma 7 write → Prisma 8 read、Prisma 8 write → Prisma 7 read、transaction rollback，并验证 Prisma 8 text CUID2 自动 ID；
- Enterprise Settings 专项在加载本地数据库环境后为 9/9 PASS、0 skip，其中 SMTP 与 AI 模型两条均为真实 PostgreSQL 跨 runtime integration；
- API typecheck：PASS；API build (`tsc -p tsconfig.build.json`)：PASS；
- 完整 API Rules 在本地 PostgreSQL 环境下直接执行为 **274/274 PASS、0 FAIL、0 SKIP**，不再依赖“标准环境 skip + 单独补跑”的组合证据；其中同时包含 SMTP Prisma 8 write、AI 模型 transaction/createAll 与 Prisma 7↔8 rollback 三条数据库 integration；
- `verify-prisma-migrations.mjs`：PASS，3 migrations / 2 published immutable；
- `git diff --check`：PASS；
- production Docker gate 尚未通过：Docker Desktop 4.52.0 / Engine 29.0.1 与 `buildx v0.29.1-desktop.1` 均可通过 Host identity 正常发现，但 `desktop-linux` builder 在写 `~/.docker/buildx/activity` 时被 Workbench Host 隔离拒绝；切到 `default` builder 又因 `/var/run/docker.sock` 被隔离拒绝。失败发生在正式 Dockerfile build 之前，不属于项目代码构建错误；镜像 `micromatrix-crm-api:prisma8-p3-batch2` 不宣称 PASS；
- 复验正式 `docker build -f docker/api.Dockerfile -t micromatrix-crm-api:prisma8-p3-batch2 .` 仍稳定失败于 `failed to update builder last activity time ... operation not permitted`；尝试仅通过 `BUILDX_CONFIG` 将 Buildx 状态目录重定向到 workspace 时，Host identity 执行模型又明确禁止调用方 env override，因此该 gate 继续归类为 Workbench Host 外部环境阻塞；
- P3.3 的普通 transaction / batch 代码与真实 PostgreSQL 验证已完成，但按 production image gate 保持未封板。Docker Host 隔离 gate 解除后先补正式 image build，再切入 P3.4。

### P3.4 Raw SQL / 动态字段阶段结果（2026-09-15，完成）

- 先以本地安装的 `@prisma/orm-postgres@8.0.0-rc.10` 类型与 runtime 实现确认 raw lane 契约，再增加真实 PostgreSQL canary；未直接在动态字段生产逻辑中猜测 RC API；
- Prisma 8 compatibility 新增 raw lane gate：`client.raw.sql\`...\`.returnsRow(...)` + `client.runtime().query(plan.build())`，以 Prisma 7 创建的 tenant 为数据源，验证绑定参数与声明 row codec 的真实解码；当前 compatibility 为 **2/2 PASS、0 skip**；
- `CustomFormsService` 的自定义表单数据源读取、13 类内置数据源、系统字段/动态字段高级筛选均已切到 Prisma 8 raw lane；内置数据源原 `Prisma.raw(dynamicTable)` 改为封闭 `BuiltinDataSourceType` 对应的静态 SQL 分支，13 类 by-id/by-name 共 26 条分支已在真实 PostgreSQL 执行；
- `CustomFormsModule` 显式 opt-in `Prisma8Module`，不提升 Prisma 8 为全局依赖；raw 查询继续强制 `organization_id + custom_form_id` 双边界；
- ID 集合使用绑定 JSON 参数 + `jsonb_array_elements_text(...)` 展开，不把 ID 数组拼成 SQL；返回 `id/name` codec 直接引用 `client.sql.public.custom_form_data.columns`；
- Custom Forms 真实 PostgreSQL integration 覆盖 organization/customFormId 隔离、ID 集合、跨边界数据、带单引号名称、系统字段、普通动态字段、Blob 多选、日期、空值以及 AND/OR，PASS；
- `ResourceFieldValueService` 的动态筛选 builder 已切到 Prisma 8 raw expression；14 个 `ResourceFieldType` 的主表与各自 Field/Blob 表均通过静态 switch 绑定，不再动态拼 identifier。真实 PostgreSQL integration 已让 14 类主表查询全部实际执行，并在 customer 上覆盖普通 Field、Blob 多选、ISO datetime 范围与跨租户隔离；
- Metadata datetime 真实存储为 ISO 字符串；迁移后范围比较显式使用 `::timestamptz`。这同时修复了旧 Prisma 7 builder 将 ISO 字符串 `Number(...)` 后再做 `::numeric` 比较导致日期范围筛选不可执行的问题；
- production `Prisma.raw = 0`、`Prisma.join = 0`；production `Prisma.sql` 从 P3.1 基线 **62 → 5**。剩余 5 处全部为 advisory lock：DistributedCoordinator、Pool transaction lock、ExportTasks、ResourceFieldValue 两处；另有 organization-sync 的 tagged `$queryRaw` advisory lock。上述并发/协调 SQL 全部留给 P3.5；PrismaService 启动 `SELECT 1` 留给 P3.6；
- API typecheck：PASS；API build (`tsc -p tsconfig.build.json`)：PASS；完整 API Rules 在真实 PostgreSQL 环境下为 **277/277 PASS、0 FAIL、0 SKIP**；
- `verify-prisma-migrations.mjs`：PASS，3 migrations / 2 published immutable；`git diff --check`：PASS；
- P3.4 正式完成。下一步进入 P3.5，优先迁 advisory lock / DistributedCoordinator / organization-sync 等高风险并发路径；migration ownership 仍由 Prisma 7 持有。

### P3.5 并发协调 / Message Outbox 阶段结果（2026-09-16，进行中）

- `DistributedCoordinatorService` 的 Redis unavailable PostgreSQL fallback 已从 Prisma 7 `$transaction + $queryRaw` 切到 Prisma 8 transaction + raw query；真实 PostgreSQL 使用两个独立 Prisma 8 client 竞争同一个 `pg_try_advisory_xact_lock`，首个事务持锁期间第二个稳定返回 BUSY，释放后同 key 可再次获取；
- `ExportTasksService.enqueue` 已切到 Prisma 8 callback transaction。`pg_advisory_xact_lock`、同用户最多 10 个 PENDING、同 module 去重与任务 create 保持同一数据库事务；Prisma 8 创建后 Prisma 7 可正确读回 payload/status/过期时间，queue add 失败后的 PENDING 清理语义保持不变；
- `MessageDeliveryService.enqueueChannel` 的 outbox 批量创建已从 Prisma 7 多 create `$transaction` 切到 Prisma 8 `createAll`；缺成员映射仍生成 DEAD 审计，正常映射生成 PENDING，收件人去重及 title/content/link 截断保持不变；
- MessageDelivery worker 的条件认领已切到 Prisma 8 参数化 `UPDATE ... RETURNING id` CAS。真实数据库以两个独立 client 同时竞争同一 PENDING，严格只有一个 claim 成功；FAILED 到期后可再次 claim 并增加 attempts，未来 `nextAttemptAt` 不可提前认领；
- MessageDelivery 的 SUCCEEDED / FAILED / DEAD 结果回写已切到 Prisma 8 Collection update，并显式写 `updatedAt`、`sentAt` / `nextAttemptAt` Temporal。真实 PostgreSQL 由 Prisma 7 读回验证成功、退避和重试耗尽语义；
- `MessageDeliveryService.retry` 的 FAILED/DEAD → PENDING 手工重试重置已切到 Prisma 8 Collection update，真实 PostgreSQL 验证 attempts、nextAttemptAt、error/provider/sent 状态全部清空且 Prisma 7 可读回；Cron 的 stale `SENDING` 恢复与 due ID 扫描也已切到 Prisma 8，专项测试验证恢复仅命中支持渠道 + `updatedAt < staleBefore`，due scan 仅处理 PENDING/FAILED、`nextAttemptAt IS NULL OR <= now`，并保持 createdAt 升序与 50 条批次上限；
- CAS real-db gate 发现 `message_deliveries` 的未 `@map` 字段物理列名仍为 camelCase；raw SQL 已改用 quoted `"nextAttemptAt" / "errorCode" / "errorMessage" / "updatedAt"`，禁止根据 Prisma field 名自行猜 snake_case；
- 审批 production canary 选择 `ApprovalsService.cancel`：PENDING task `updateAll(SKIPPED)` 与 ApprovalInstance `CANCELED + finishedAt` 在同一个 Prisma 8 callback transaction 中执行，两个模型原 Prisma 7 `@updatedAt` 均显式写 `prisma8Now()`；真实 PostgreSQL 验证两个 PENDING task 同时跳过、历史 APPROVED task/action/handledAt 保留、instance 完成时间可由 Prisma 7 正确读回，事务外 `setBizStatus(REVOKED)` 与 snapshot restore 调用顺序保持不变；
- 审批第二条 production canary `ApprovalsService.revokeTask` 已整体迁到 Prisma 8 callback transaction：撤回资格、flow `allowWithdraw`、同实例 task 快照、下游当前轮 PENDING task `SKIPPED`、源 APPROVED task 原子恢复为 PENDING，以及 instance `currentNodeIndex` 回退全部在同一 Prisma 8 transaction 中；真实 PostgreSQL 验证源 task 的 `action/handledAt` 清空、下游 task 失效、instance 节点回退和二次撤回 fail-closed；
- 审批后续写事务已继续整体迁移：`approveTask/rejectTask` 的 task 状态、ApprovalRecord 去重/重建、附件关系与 reject instance 收口均由 Prisma 8 transaction 持有；`signTask` BEFORE/AFTER 加签链、`returnBackTask` 节点退回、`advance()` 自动通过/人工节点任务创建也已切到 Prisma 8 transaction，并分别通过真实 PostgreSQL cross-runtime gate；
- Prisma 8 RC10 对 Prisma 7 `createMany({ skipDuplicates: true })` 没有同形参数，ApprovalInstanceAttachment 采用逐条 Prisma 8 `create()` 并仅吞 PostgreSQL SQLSTATE `23505` 保持 skip-duplicate 语义；RC10 `varchar(N)` 为 compile-time branded string，JSON 输入先经过 JSON serialize/parse 归一化，nullable enum `not` 使用官方 `neq + isNull + or` 组合；
- `ApprovalsService` 内部 ApprovalInstance / ApprovalTask / ApprovalRecord / AddSign / ReturnBack / AttachmentRelation **生产写调用已不再使用 Prisma 7 client**；剩余 Prisma 7 主要为读取、规则判断与列表关系装配；
- organization-sync apply 已整体迁到 Prisma 8 callback transaction：advisory xact lock、batch/integration/role/conflict gate、Department/User/UserRole、两类 mapping、item result、leader、batch/integration/tenant 收口保持同一连接与同一 transaction；成功真实 PostgreSQL gate 验证 Prisma 7 可跨 runtime 读回完整结果；
- organization-sync 失败路径另有真实 PostgreSQL gate：USER 引用不存在的部门时，Prisma 8 主 transaction 在 APPLYING 后抛错，所有业务写 rollback、item 保持 PENDING；事务外 Prisma 8 failure audit 将 batch/integration 标记 FAILED 并写 OperationLog + Blob。两条 organization-sync integration **2/2 PASS**；
- xact advisory lock 迁移规则已确认：锁和其保护的业务写必须位于同一数据库连接、同一 transaction。organization-sync 已满足并完成迁移；Pool 事务锁与 Metadata 唯一字段锁仍与 Prisma 7 父事务强绑定，因此当前不得仅替换 lock query；
- production legacy `Prisma.sql` 在 P3.4→P3.5 中期曾从 **5 → 3**（Pool 1 + Metadata 2）；后续 Pool/Metadata 父 transaction 已整体迁移，最终 production legacy Prisma runtime/raw inventory 为 **0**；
- TypeScript toolchain 已统一升级到 `typescript@7.0.2`。`pnpm typecheck`、`pnpm build` 均 PASS；由于 Vue Language Tools / typescript-eslint 尚依赖 TS6 JavaScript API，`vue-tsc` 3.3.11 与 ESLint 仅通过 `@typescript/old@6.0.3` compatibility backend 运行，应用 compiler 仍为 TS7。`pnpm lint` PASS（仅保留既有 `no-explicit-any` warnings）；
- API typecheck：PASS；API build：PASS；通知专项 14/14 PASS；审批专项 **16/16 PASS**（含真实 PostgreSQL approve/reject/sign/advance/cancel/returnBack/revoke）；organization-sync success/rollback **2/2 PASS**；完整 API Rules **289/289 PASS、0 FAIL、0 SKIP**；
- P3.5 已完成：Pool/Metadata advisory lock 与受保护写保持同 connection + 同 transaction 后整体切入 Prisma 8。最终 P5 gate 为 API Rules **346/346 PASS、0 fail、0 skip**，root typecheck/lint/build exit 0，fresh PostgreSQL baseline/bootstrap/verify/status 全绿，原始 Docker release smoke exit 0，代表性 Browser 回归全绿；PRISMA8-001 已封板为 `VERIFIED`。

### P3.6 Seed / Worker / Cron / 公共基础设施阶段结果（2026-09-16，完成）

- `ExportWorkerService` 的导出执行用户上下文恢复已从 Prisma 7 nested include 改为 Prisma 8 `Users / UserRoles / Roles` 显式查询，Worker 不再依赖 Prisma 7 完成导出用户权限上下文恢复；
- `ResourceFieldAttachmentCleanupService` Cron 的 orphan / 临时附件候选扫描已切到 Prisma 8 参数化 raw SQL；动态值继续全部绑定，表名/列名静态，现有 attachment lifecycle 专项 PASS；
- `MessageExpiryService` 三条到期扫描已切到 Prisma 8 静态 join raw SQL，真实 PostgreSQL 验证报价、合同、回款计划均能读取，`END` 合同由 SQL `NOT EXISTS` 正确排除；
- `OperationLogCleanupService + OperationLogSettingsService` 已整体切 Prisma 8：设置更新使用 `INSERT ... ON CONFLICT ... RETURNING`，cleanup batch 使用单条 `DELETE ... RETURNING`，避免旧 `findMany -> deleteMany` 竞争窗口。真实 PostgreSQL gate 验证 retention 状态、Temporal 时间列、批删和人工 clear；
- Prisma 8 RC10 raw enum 返回列存在 codec 参数缺失：`OperationLogCleanupSource` 在 raw `RETURNING` 中显式 `::text`，并以 nullable `pg/text@1` 解码；正常 ORM Collection enum 读取仍保持 contract enum；
- `Announcement` 每 5 分钟发布 Cron 的 due scan 与 `notice=false -> true` CAS 回写已切 Prisma 8；真实 PostgreSQL gate 验证当前生效公告被发布、未来公告不被误扫；公告后台 CRUD 暂留 production import sweep；
- `OpportunityRuleService.executeAutoClose` 的 03:00 Cron 已切 Prisma 8：rule / END fail stage / opportunity 扫描、Users/UserRoles/Departments/Roles scope 展开和商机失败阶段回写均由 Prisma 8 执行。真实 PostgreSQL gate 验证 `scope=["*"]`、stage 条件、`lastStage` 与 `failureReason=system`；
- 新增 `prisma8Varchar/prisma8Varchars` migration boundary：先验证真实字符长度，再提升为 Prisma 8 `Varchar<N>` branded input；禁止在业务路径散落 `as never` 来绕过 contract 长度约束；
- `MessageDelivery` Cron 已将最后一处 delivery scalar read 切到 Prisma 8；stale recovery -> due scan -> CAS claim -> delivery read -> provider dispatch -> SUCCEEDED/FAILED/DEAD write 现全部属于 Prisma 8 数据路径，通知专项仍为 **14/14 PASS**；
- `BiddingService` 08:00 Cron 已将 source/keyword 扫描、抓取去重入库和 `lastFetchAt` 回写切到 Prisma 8；真实 PostgreSQL gate 首次插入 2 条、第二次插入 0 条，并由 Prisma 7 cross-runtime 读回 Numeric/Temporal 值；
- `FollowUpPlansService` 09:00 reminder 已将 due scan、CAS claim、目标名称读取和通知失败 release 切到 Prisma 8；真实 PostgreSQL gate 验证同日只通知一次，且通知异常后 `dueNotifiedAt` 恢复 NULL；
- 公共启动数据库 fail-fast 已从 Prisma 7 `PrismaService.$queryRaw\`SELECT 1\`` 移到 `Prisma8Service.onModuleInit()` 的 contract raw/runtime probe；API / Worker 根模块显式加载 `Prisma8Module`。Prisma 8 compatibility 新增 startup lifecycle 真库 gate；compat 当前 **3/3 PASS**；
- Seed 已整体切 Prisma 8：正式 `prisma/seed.ts` 的 bootstrap 和默认 demo 均调用 Prisma 8 seed，`seed-demo-legacy.ts` 已删除。bootstrap 保留套餐/租户/47 条消息任务配置/4 部门/3 角色/管理员/UserRole；demo 保留成员、9 forms、stages、pool/capacity、views、dashboard、approval flow、bidding 与 CRM 样例数据；
- fresh PostgreSQL 最终 demo gate 已真实执行 `3 migrations -> 默认 prisma/seed.ts -> 第二次默认 prisma/seed.ts`，结果稳定为 4 users / 3 roles / 4 UserRoles / 47 message settings / 9 forms / 7 contract stages / 7 order stages / 2 clue pools / 2 customer pools / 5 views / 1 approval flow / 6 customers / 3 clues / 1 contact 等，二次执行无重复增长；
- `packages/migrate` 已增加 `@prisma/orm-postgres@8.0.0-rc.10` 与 `@js-temporal/polyfill` production 依赖；`docker/migrate.Dockerfile` 已将 Prisma 8 runtime/contract JSON 拷入 migration image。以 `pnpm --prod deploy` 构造的本地 migrate-image 等价 runtime 再次执行同一 fresh-DB bootstrap gate并 PASS，证明不是仅源码目录可运行；migration deploy/status ownership 此阶段仍由 Prisma 7 持有，等待 P4 handoff；
- 当前完整 API Rules 已提升为 **295/295 PASS、0 FAIL、0 SKIP**；root TS7 typecheck PASS；root build PASS；root lint PASS（0 error）；migration immutable checksum PASS；`git diff --check` PASS；
- P3.6 已完成。`PoolRecycleService` Cron 是唯一留存的 Prisma 7 Cron 数据路径，但它和 Pool advisory lock / Metadata 父 transaction 是同一强事务迁移簇，因此转入 P3.7 production import sweep 整体处理，不允许拆成 Prisma 8 扫描 + Prisma 7 受保护写的跨连接假事务。

### P3.7 production import sweep 增量 Gate

- production `PrismaService` 文件精确去重扫描当前为 **25**；扫描口径为 `apps/api/src/**/*.ts`，排除 test/spec 与 `src/prisma/**`、`src/prisma/**`；
- `dashboard-access.prisma8.test.ts` 真 PostgreSQL **1/1 PASS**：覆盖部门祖先路径、scope 去重/租户隔离、成员装配、父部门可见性与 DashboardModule 显式装配；
- `dashboard-module.prisma8.test.ts` 真 PostgreSQL **1/1 PASS**：覆盖 legacy varchar32 ID、目录新增/重命名/重复名、树/收藏统计、跨目录移动与 callback transaction reindex、删除保护；
- `dashboard-resource.prisma8.test.ts` 真 PostgreSQL **1/1 PASS**：覆盖资源 CRUD、分页/详情、收藏唯一性、收藏分页、跨目录移动/reindex，并由 Prisma 7 cross-runtime 读回校验；
- `home-department-scope.prisma8.test.ts` 真 PostgreSQL **1/1 PASS**，原首页 scope 单测 **4/4 PASS**；覆盖部门树排序、ALL 范围与 ACTIVE 成员部门过滤；
- `scope-resolver.prisma8.test.ts` 真 PostgreSQL **1/1 PASS**：覆盖 `user:/dept:` token、后代部门、裸部门与跨租户用户排除；
- `data-scope.prisma8.test.ts` 真 PostgreSQL **1/1 PASS**，原 multi-role 单测 **4/4 PASS**：覆盖 CUSTOM 后代展开、ACTIVE owner/creator 过滤及停用成员排除；
- `logs.prisma8.test.ts` 真 PostgreSQL **1/1 PASS**：覆盖 OperationLog 模块筛选、`userName/targetName` OR `ilike`、数据库分页、Blob detail 与 LoginLog email `ilike`；
- `home-statistics.prisma8.test.ts` 真 PostgreSQL **1/1 PASS**：覆盖 Clue transition/shared-pool 排除与 Opportunity AFOOT / END+100 count + Numeric amount sum；
- `auth.guard.prisma8.test.ts` 真 PostgreSQL **1/1 PASS**：覆盖 UserKey API Key、Temporal expiry、User/UserRole/Role 显式装配和权限缓存；
- `message-delivery.prisma8.test.ts` 真 PostgreSQL **1/1 PASS**，原 MessageDelivery 专项 **13/13 PASS**：覆盖 Prisma 8 integration/mapping enqueue、cross-runtime 状态机、user-name list 搜索与 retry；
- `customer-access.prisma8.test.ts`、`customer-pool-config.prisma8.test.ts`、`clue-pool-config.prisma8.test.ts` 真 PostgreSQL 均 **1/1 PASS**，Pool Repository transaction ownership 未拆分；
- `notifications.prisma8.test.ts` 真 PostgreSQL **1/1 PASS**，原 Notifications 专项 **7/7 PASS**：覆盖来源幂等、分页、未读 aggregate、单条/全部已读 CAS、`deleteAndCount` 精确删除及跨 runtime 读回；
- `contract-stage.prisma8.test.ts` / `order-stage.prisma8.test.ts` 真 PostgreSQL **2/2 PASS**：覆盖默认阶段、stage groupBy 计数、删除保护、transaction 排序、回滚开关和 ADVANCED 流转；两目录已正式纳入 `.tmp/run-rules.mjs`；
- `user-views.prisma8.test.ts` 真 PostgreSQL **1/1 PASS**，原 UserViews 专项 **7/7 PASS**：覆盖 ownership、条件替换、4096 排序、启停、拖拽、级联删除与同名唯一约束；
- `announcements.crud.prisma8.test.ts` + `announcements.publish.prisma8.test.ts` 真 PostgreSQL **2/2 PASS**：覆盖 JSONB 接收快照、Temporal、部门递归、ACTIVE 用户范围、关键词分页/名称装配和 Cron notice 回写；
- `approval-webhook.prisma8.test.ts` 真 PostgreSQL **1/1 PASS**：覆盖 TEST delivery 的 PENDING → SENT/FAILED、Temporal started/finished/updatedAt、错误码/错误消息以及审计 URL 路径脱敏，并由 Prisma 7 cross-runtime 读回；
- `product-subtable-read.prisma8.test.ts` 真 PostgreSQL **1/1 PASS**：组合覆盖 Contract/ProductPrice/Order/Quotation 四个 batch reader 的 organization scope、normal/blob 合并、Product/ProductPrice 名称装配；对应父级 legacy transaction 写链保持原 ownership；
- `follow-comments.prisma8.test.ts` 真 PostgreSQL **1/1 PASS**，原 FollowRecord/FollowPlan 评论专项 **10/10 PASS**：覆盖 Comment/Mention/commentCount 同一 Prisma 8 callback transaction 的 add/update/remove、mention 替换及 Prisma 7 cross-runtime 读回；
- `auth.prisma8.test.ts` 真 PostgreSQL **1/1 PASS**：覆盖注册 Tenant/Department/Role/User/UserRole、大小写不敏感密码登录、成功/失败 LoginLog、me/refresh、changePassword authVersion 失效旧 refresh token 及新密码重新登录；`src/auth/*.test.ts` 已正式加入 Rules；
- `home-overview.prisma8.test.ts` 真 PostgreSQL **1/1 PASS**：覆盖 owner scope、summary/funnel/ranking/trend/conversion、赢单/输单 StageConfig 显式解析与跨 scope 排除；
- `attachments.prisma8.test.ts` 真 PostgreSQL + LocalDiskStorage **1/1 PASS**：覆盖 upload/list/listByTargets/listByIdsFromTarget、temporary/remove/removeAll、resourceField domain guard 与 Prisma 7 cross-runtime 读回；
- `export-tasks.service.test.ts` **5/5 PASS**，`export-tasks.prisma8.test.ts` 真 PostgreSQL **1/1 PASS**：除 advisory enqueue/配额/去重外，已扩展覆盖 beginAttempt attempts/startedAt、fail、complete `updateAndCount` CAS、文件落盘和 cancel 清理；
- `organization-sync-apply.prisma8.test.ts` 真 PostgreSQL **2/2 PASS**：在原完整 advisory transaction 与失败回滚 gate 基础上，事务外 initial/disabled/subordinate/affected user 读取也已切 Prisma 8；
- `approval-resource-capture.prisma8.test.ts` 真 PostgreSQL **1/1 PASS**：覆盖 Contract 主资源租户隔离、normal/blob/snapshot 读取及 Numeric/BigInt JSON 字符串化；Quote/Invoice/SalesOrder 分支同样使用 Prisma 8 contract ORM；
- `approval-resource-restore.prisma8.test.ts` 真 PostgreSQL **1/1 PASS**：覆盖 Contract 主表/normal/blob/snapshot 原子恢复、varchar 边界失败整笔 rollback，以及恢复后继续保留当前 approvalStatus/approved；
- `opportunity-rule.autoclose.prisma8.test.ts` + `opportunity-rule.crud.prisma8.test.ts` 真 PostgreSQL **2/2 PASS**：覆盖 auto-close scope/stage 回写、规则 CRUD、关键词分页、scope 名称装配和无效 stage 拒绝；`opportunities/*.test.ts` 已正式加入 Rules；
- `roles.prisma8.test.ts` 真 PostgreSQL **1/1 PASS**：覆盖 Role CRUD、UserRole 去重分配、成员分页的角色/部门/直属上级装配、唯一角色保护、CUSTOM 部门校验与 auth cache invalidation；`roles/*.test.ts` 已正式加入 Rules；
- `members.prisma8.test.ts` 真 PostgreSQL **1/1 PASS**：覆盖 User/UserRole 原子创建、关键词分页与角色/部门/直属上级装配、角色替换、改密、禁用时清理部门/成员 leader、业务引用删除保护及 SysUserView/Notification 清理；`members/*.test.ts` 已正式加入 Rules；
- `lark-sso.service.test.ts` Prisma 8 harness **1/1 PASS**：覆盖 QR/Web/Mobile OAuth、browser nonce、state 单次消费/replay fail-closed、open_id 映射、profile/avatar 更新和 identity 创建/复用；`lark-sso.prisma8.test.ts` 真 PostgreSQL **1/1 PASS**，覆盖 discovery、bind/unbind/rebind 及 OAuth state hash 持久化；
- `dingtalk-sso.service.test.ts` Prisma 8 harness **1/1 PASS**：覆盖 QR/工作台 OAuth、browser nonce、state 单次消费/replay fail-closed、userid 映射、profile/avatar 更新和 identity 创建/复用；`dingtalk-sso.prisma8.test.ts` 真 PostgreSQL **1/1 PASS**，覆盖 discovery、bind/unbind/rebind 及 OAuth state hash 持久化；
- `wecom-sso.service.test.ts` Prisma 8 harness **1/1 PASS**：覆盖 QR/工作台 OAuth、browser nonce、state 单次消费/replay fail-closed、工作台同域回跳、profile/avatar 更新和 identity 创建/复用；`wecom-sso.prisma8.test.ts` 真 PostgreSQL **1/1 PASS**，覆盖 discovery、bind/unbind/rebind 及 OAuth state hash 持久化；
- `enterprise-integrations.service.test.ts` + DingTalk/Lark 配置专项 **11/11 PASS**；`enterprise-integrations.prisma8.test.ts` 真 PostgreSQL **1/1 PASS**，覆盖三 Provider 配置、credentialVersion 失效、同步切换和 active platform；
- `organization-sync.service.test.ts` + planner/coordinator/apply 专项 **9/9 PASS**；`organization-sync.prisma8.test.ts` 真 PostgreSQL **1/1 PASS**，覆盖 PREVIEW_READY 生成、JSON `sourceData.name` 参数化 raw 关键词分页/count、冲突部门 SKIP 级联和 Batch counts 回写；
- `approval-flow-config.prisma8.test.ts` 真 PostgreSQL **1/1 PASS**，覆盖连续审批流编号、counter CAS、Flow/Version/Node/Approver/Link 装配、enabled 排序、版本升级、启停与软删除；
- `business-title.prisma8.test.ts` 真 PostgreSQL **1/1 PASS**，覆盖高级筛选、审批状态、配置必填、发票引用删除保护和 cross-runtime readback；
- `resource-pools.prisma8.test.ts` 真 PostgreSQL **1/1 PASS**，覆盖部门祖先 scope、role token、Clue/Customer 库容 count 与 ownerHistory 用户/部门装配；
- `approvals.actions/advance/cancel/return-back/revoke.prisma8.test.ts` 真 PostgreSQL 合计 **6/6 PASS**，继续覆盖审批高风险 callback transaction；新增 `approvals.reads.prisma8.test.ts` **1/1 PASS**，覆盖待办/已办/抄送/我发起分页、timeline/附件/加签/退回装配、Temporal→ISO，以及 Flow → Version → Condition/Approver/Link 显式 Prisma 8 装配；
- `custom-forms.service.test.ts` 真 PostgreSQL **2/2 PASS**：原 raw lane 继续覆盖自定义/内置数据源和高级筛选；新增完整 CRUD gate 覆盖 CustomForm/SysModuleForm/Role/Admin 配置事务、访问授权、CustomFormData + normal/blob Field 原子写、分页装配、批改/批删及 Prisma 7 cross-runtime readback；
- 当前完整 API Rules **345/345 PASS、0 FAIL、0 SKIP**；API TS7 `tsc --noEmit` PASS。

## 6. Phase 4：Migration ownership handoff

先在隔离 PostgreSQL 演练：Prisma 7 migration + Seed 初始化 → Prisma 8 contract emit → baseline plan → `db sign` → `migration status` → `migration ref set db` → additive contract change → plan 只包含真实差异 → `db migrate --advance-ref db` → `db verify`。

隔离演练通过后才允许对开发主库执行 handoff。

## 7. Phase 5 最终 Gate

```text
Prisma 7 production imports   = 0
Prisma 7 runtime dependencies = 0
Prisma 7 scripts/CI/Docker    = 0
transitional prisma8 paths    = 0
canonical contract path       = apps/api/prisma/contract.prisma
Prisma 8 db verify            = PASS
Fresh PostgreSQL init         = PASS
Seed                          = PASS
API Rules                     = PASS
Root typecheck                = PASS
Root lint                     = PASS
Root production build         = PASS
Docker release smoke          = PASS
git diff --check              = PASS
```

还要覆盖 API/worker 后台任务、代表性 Browser 链路、数据库原生 partial unique index/手写结构实查，以及独立 Migration image 从空 PostgreSQL 初始化。

### Phase 5 最终结果（2026-09-18）

- legacy production/runtime/scripts/path scan：**0 FILES / 0 REFS**；
- 正式 storage contract hash：`651134f9ccfda014c4a27d235488e56b4640ad20fbf307fe0acaa0b8e39566de`；baseline `20260918T0338_baseline`，**672 operations**；
- fresh PostgreSQL baseline + bootstrap Seed + full `db verify` + `migration status`：PASS；
- API Rules：**346/346 PASS，0 FAIL，0 SKIP**；
- root typecheck：**exit 0**；
- root lint：**exit 0 / 0 errors / 121 warnings**；
- root production build：**exit 0**；
- Docker release smoke：仓库原始 `docker/release-smoke.sh` **exit 0**，Migration image 从空 PostgreSQL 初始化、Seed、verify/status、API/worker/Web runtime 与 PC/Mobile proxy/fallback 全部 PASS；
- Browser：登录、Dashboard、商机高级筛选、客户列表/详情、线索关键词搜索全部 PASS；API 日志无 5xx/runtime exception；
- `git diff --check`：PASS。

上述结果 supersede 本文件前面各阶段的中间计数和 `IN_PROGRESS` 执行指针；保留它们仅用于迁移审计历史。最终状态：**VERIFIED**。

## 8. 不能作为“迁移完成”证据

- 只运行 `prisma --version`；
- 只完成 `contract emit`；
- 只改 package.json 版本；
- API 能启动但 Rules/事务测试未跑；
- fresh DB 能创建但现有库 handoff 未验证；
- 两代 Prisma 共存但没有明确 migration ownership。

