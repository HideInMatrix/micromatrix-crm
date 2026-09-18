# PRISMA8-001 技术设计

## 1. 总体策略

采用 Prisma 官方 PostgreSQL side-by-side 方案。迁移期间存在两套明确隔离的 ORM 工具链，但只连接同一个数据库：

```text
PostgreSQL
   ├── Prisma 7: legacy Prisma 7 config / prisma/schema.prisma / legacy generated client directory
   └── Prisma 8: prisma.config.ts / prisma/contract.prisma / src/prisma/generated
```

Phase 1～3 中只有 Prisma 7 可以改变数据库结构；Prisma 8 只读取同一个数据库并逐模块承接 runtime 查询。

## 2. 阶段设计

### Phase 0：基线冻结与前置条件

- 固化项目 Node 25 主线：`.nvmrc=25.7.0`、根 engines `>=25 <26`，CI/Docker 使用 Node 25。
- 记录当前 Prisma 7 版本、Migration image、release-init、schema、adapter、raw SQL 和 error-code 调用点。
- 跑当前 root typecheck/build/lint、API Rules、Prisma validate/generate/status。
- 不修改业务 ORM 调用。

### Phase 1：Prisma 7 side-by-side 隔离

- Prisma 7 CLI 从 `prisma` 切到官方 `legacy Prisma 7 CLI package`。
- `apps/api/prisma.config.ts` → `apps/api/legacy Prisma 7 config`。
- Prisma 7 scripts 改为 `legacy Prisma 7 CLI generate / migrate / db push / studio`。
- 根 `db:*` 脚本在 Phase 1～3 继续指向 Prisma 7。
- `@micromatrix/migrate` 和 Docker Migration image 明确携带 Prisma 7 CLI。
- `legacy Prisma Client package` / `legacy PostgreSQL adapter package` 继续作为 legacy runtime，生成现有 `legacy generated client directory`。

此阶段要求零业务行为变化。

### Phase 2：接入 Prisma 8 contract/runtime

- 安装 Prisma 8 CLI 和 `@prisma/orm-postgres`。
- 新建 Prisma 8 `prisma.config.ts`。
- 从 live PostgreSQL `contract infer`，删除 Prisma 7 ledger 对应模型并审计所有 mapping。
- `contract emit` 生成 JSON/type artifacts。
- 增加 Prisma 8 runtime lifecycle 封装，不暴露 Prisma 7 兼容 facade。
- 增加双 runtime 健康测试，证明两代 runtime 对同一数据库互操作。

Phase 2 的 production packaging 约束为：emitted contract 固定放在 `apps/api/src/prisma/generated`，确保 TypeScript build 和 pnpm production deploy 都能携带 `contract.json`。现有 Nest API 继续保持 CommonJS 模块系统；Prisma 8 runtime 作为 ESM-only 包通过原生动态 `import()` 加载，不为 ORM 迁移扩大成全项目 ESM 改造。

### Phase 3：按风险分层迁移 runtime

顺序：只读配置/目录 → 简单 CRUD → 普通事务/批量 → raw SQL/动态字段/DataScope → 审批/组织同步/outbox/并发协调 → Seed/Worker/Cron。

每批必须降低 Prisma 7 production import 数量，并通过同批专项测试和全量 Rules。

## 3. Prisma 7 → 8 API 差异处理

### 3.1 Atomic increment/decrement

Prisma 8 RC 当前不支持 `{ increment: n }`。强原子计数使用参数化 raw SQL arithmetic；已在事务/锁内的路径可以 read-modify-write，但必须保持原并发语义。

### 3.2 Raw SQL

`Prisma.sql/raw/join/empty` 迁移到 `db.raw.sql` 与 `db.runtime().query/execute`。返回行必须声明类型，继续保持参数化，禁止字符串拼 SQL。

### 3.3 Error code

旧 `P2002/P2025` 改用 Prisma 8 Runtime/SQLSTATE。PostgreSQL unique violation 使用 `23505`；no-row 使用 runtime code 或显式 null check，HTTP 业务语义保持不变。

### 3.4 Nested writes

Prisma 8 暂无直接对应 API 的 nested update/updateMany/upsert/delete/deleteMany/set 必须展开为目标 model 显式写入，并在需要时保持在同一 `db.transaction(...)`。

### 3.5 Client-side defaults 与时间类型

`contract infer` 以 live PostgreSQL 为事实源，不能恢复 Prisma 7 schema 中仅存在于 Client 层的 `@default(cuid())`、`@updatedAt` 等行为。Phase 3 写路径迁移必须逐模型明确 ID 生成、更新时间写入与其它 client-side default，禁止依赖 infer contract 猜测这些语义。

Prisma 8 PostgreSQL timestamp codec 当前使用 Temporal。Node 25 实测仍未提供全局 `Temporal`，因此 Prisma 8 runtime 创建前统一注册 `@js-temporal/polyfill`；业务迁移时需要显式处理 Prisma 7 `Date` 与 Prisma 8 `Temporal.PlainDateTime` 的边界，而不是隐式字符串化。

P3 实测后进一步收口为以下规则：

- Prisma 7 的 135 个 `@default(cuid())` 中，live PostgreSQL 实际分为 53 个 `text` ID 与 82 个 `varchar(32)` ID。Prisma 8 RC 的 `@default(cuid(2))` 只能挂到 `pg/text@1`，因此仅 53 个 `text` ID 在 contract 中恢复 client-side default；82 个 `varchar(32)` ID 在对应写路径迁移时必须走统一应用层 ID helper。
- 53 个 `text` CUID2 default 重新 emit 后，`storageHash` 仍为 `e3c4dbe588466be2d37e4f47e3f4e0d4a36f6d89a2f11c1abfc6af86435f8612`，且 emitted `storage` 与 client-default 变更前对象 deep-equal，证明没有改变 PostgreSQL storage contract。
- Prisma 7 的 40 个 `@updatedAt` 全部对应 PostgreSQL `timestamp(3) without time zone`。虽然 `temporal.timestamp(3, onCreate: now, onUpdate: now)` 可以 emit 且保持 storage hash，但 `@prisma/orm-postgres@8.0.0-rc.10` 内部将该 preset 的 `now` 绑定到 `INSTANT_NOW_GENERATOR_ID`，运行时实际产生 `Temporal.Instant`，与 `pg/timestamp-temporal@1` 所需 `Temporal.PlainDateTime` 不兼容并触发 `RUNTIME.ENCODE_FAILED`。因此正式 contract 不保留这 40 个 preset，迁移后的写路径统一使用 `prisma8Now()` 显式写 `updatedAt`。
- `createdAt @default(now())` 属于 PostgreSQL storage default，可继续由数据库生成；它与上述 client-side `updatedAt` 行为分开处理。

### 3.6 普通 transaction / batch 迁移约束

P3.3 的 `EnterpriseAiModelsService` 作为 transaction / batch canary 后，普通写路径统一采用以下约束：

- 需要多表原子性的业务改为 `prisma8.client.transaction(async (tx) => ...)`，事务内只使用 `tx.orm`，不在 callback 内回落到全局 client；
- Prisma 7 的 `deleteMany/createMany` 语义按 Prisma 8 Collection API 映射为 `deleteAll/createAll`，批量替换必须保持原有 tenant 过滤、顺序和唯一约束；
- Prisma 7 `mode: 'insensitive'` 的字符串搜索显式改为 Prisma 8 expression `ilike`，多字段 OR 使用 `or(...)`；集合过滤使用 field expression `in(...)`，避免保留 Prisma 7 filter object 形态；
- 所有命中原 Prisma 7 `@updatedAt` 的 create/update/batch write 都显式传入 `prisma8Now()`；批量写同一逻辑批次可复用同一个 PlainDateTime 值；
- 业务返回 VO 只在 Prisma 8 Temporal 边界转换为 ISO 字符串，不把 Temporal 对象泄漏到 controller/shared contract；
- transaction / batch 迁移必须有真实 PostgreSQL cross-runtime gate：Prisma 8 写入后由 Prisma 7 读取并验证业务语义，同时覆盖 transaction rollback 或原子删除/替换路径。

### 3.7 Raw lane / 动态 SQL 迁移约束

P3.4 真实 runtime canary 已确认 `@prisma/orm-postgres@8.0.0-rc.10` 的 raw statement 正式执行链为 `client.raw.sql\`...\`.returnsRow(...)` → `client.runtime().query(plan.build())`；写语句则使用对应 plan 的 `execute` / affected-count 语义。迁移 raw SQL 时统一采用以下规则：

- 业务值必须继续通过 raw template interpolation 作为绑定参数进入 plan，禁止把 tenantId、ID、名称、筛选值等拼入 SQL 字符串；真实 PostgreSQL canary 已用包含单引号的名称验证参数绑定；
- 行查询必须使用 `.returnsRow(...)` 声明返回 codec。能映射到 contract storage column 时优先使用 `client.sql.<namespace>.<table>.columns.<column>`，避免手写 codec 与真实列类型漂移；
- 动态 ID 集合不能通过字符串 join 生成 `IN (...)`。首个 canary 使用绑定的 JSON 数组配合 `jsonb_array_elements_text(...)` 展开，后续可按具体列 codec 选择等价的 typed array/JSON 参数方案；
- 动态 table / column identifier **不能**作为普通 interpolation 传入 raw tag，因为普通 interpolation 代表 value parameter 而不是 SQL identifier。P3.4 最终采用“封闭业务枚举 → 静态 SQL 分支”，不再保留通用 identifier helper：Custom Forms 13 类内置数据源和 Metadata 14 类 ResourceFieldType 均已按该策略通过真实 PostgreSQL gate，production `Prisma.raw` / `Prisma.join` 已归零；
- 动态字段 predicate 使用 `.returns('pg/bool@1')` 形成可嵌套 raw expression，再由最终 `.returnsRow(...)` statement 执行；集合值通过绑定 JSON + `jsonb_array_elements_text(...)` / `jsonb_exists_any(...)` 展开，禁止字符串 join；
- Metadata 的 date/datetime 值按既有序列化契约保存 ISO 字符串，范围筛选必须以 `::timestamptz` 比较，不能转 `Number(...)` 后走 numeric cast；
- P3.4 不把 advisory lock / 分布式协调等高风险 raw SQL 混入普通动态查询迁移；这些调用继续留在 P3.5 的并发协调专项。

### 3.8 Advisory lock / outbox 并发迁移约束

- `pg_advisory_xact_lock` / `pg_try_advisory_xact_lock` 的有效范围是**当前数据库 transaction connection**。锁保护的读、校验、写必须和 lock query 处于同一 transaction；禁止 Prisma 8 单独持锁、Prisma 7 在另一连接执行被保护业务写；
- 只有当整个锁 transaction 能完整切到 Prisma 8 时才迁 xact lock。`DistributedCoordinator` fallback 与 `ExportTasks.enqueue` 满足该条件；Pool、Metadata unique field 和 organization-sync apply 目前不满足，必须等待父 transaction 一起迁；
- outbox 条件认领必须使用单 SQL CAS（条件 UPDATE / RETURNING），不能拆成“先读状态、再 update”两个竞争窗口；真实双 client gate 必须证明同一记录只有一个 worker 可以认领；
- Prisma model 未 `@map` 的 camelCase 字段在 PostgreSQL physical schema 中仍需 quoted camelCase identifier。raw SQL 必须以 contract/storage 审计结果为准，禁止按命名习惯猜 snake_case；
- MessageDelivery 等原 Prisma 7 `@updatedAt` 模型的 Prisma 8 写路径继续显式写 `updatedAt: prisma8Now()`；DateTime retry/sentAt 边界统一通过 Temporal helper 转换。

## 4. Phase 4：Migration ownership handoff

只有 contract/runtime/回归/发布链准备完成后才允许切换：

1. `prisma migration plan --name baseline`；
2. `prisma db sign` 采用现有数据库，不重放 baseline；
3. `prisma migration status` 确认 current/target 一致；
4. `prisma migration ref set db <baseline>`；
5. 删除 Prisma 7 migrate/db push 正式入口；
6. 用 additive contract change 验证 Prisma 8 plan/migrate/verify；
7. 更新 migration policy 和 Migration image。

## 5. Phase 5：移除 Prisma 7

当 production code 不再 import `legacy generated client directory` 后，删除 `legacy Prisma 7 CLI package`、`legacy Prisma Client package`、`legacy PostgreSQL adapter package`、`legacy Prisma 7 config`、legacy generated client 和脚本。`_prisma_migrations` 可作为 inert 历史表保留。

side-by-side 命名只服务迁移窗口，Phase 5 必须同时完成 canonicalization：

- `apps/api/prisma/contract.prisma` → `apps/api/prisma/contract.prisma`；Prisma 8 仍使用 `contract.prisma`，不回退成 Prisma 7 的 `schema.prisma` 命名；
- `apps/api/src/prisma/*` → `apps/api/src/prisma/*`，在删除旧 `PrismaService` / legacy generated client 后复用正式 Prisma runtime namespace；
- `prisma.config.ts` 的 contract/output 路径改为 canonical 路径；所有 `prisma8:*` 过渡脚本改成正式 `prisma:*` / build 前置命令；
- `dev/build/typecheck/test` 不再执行 `legacy Prisma 7 CLI generate`，而是执行 Prisma 8 `contract emit`（或等价的已验证 build 前置）；Migration image、release-init、release-smoke、GitHub Actions 统一切到 Phase 4 已验证的 Prisma 8 migration/status/verify 流程；
- 最终仓库执行 `legacy Prisma 7 CLI`、`legacy Prisma Client package`、`legacy PostgreSQL adapter package`、`legacy generated client directory`、`src/prisma`、`prisma/contract.prisma` 全局零残留扫描。

## 6. Node 与容器基线

项目已决定使用 Node 25.x，本迁移分支固定 `.nvmrc=25.7.0`、根 engines `>=25 <26`，GitHub Release workflow 使用 `node@25`，API/Migration/Web Docker builder/runtime 使用 `node:25-*`。

Node 25 官方镜像不再自带 Corepack，因此 Docker 中 pnpm 固定通过 `npm install --global pnpm@11.25.0` 安装。Phase 1 实测 `node:25-alpine` 当前为 `v25.9.0`，Migration image 可成功执行 `legacy Prisma 7 CLI generate` 与 `legacy Prisma 7 CLI --version`。

需要显式记录一个过渡风险：`legacy Prisma 7 CLI package@7.10.0-dev.58` 内部 Prisma 7 preinstall 在 Node 25 会打印其官方支持线警告，但当前真实 Node 25 image build、Client generate 和 CLI 启动均已通过。该状态只允许存在于 side-by-side 迁移窗口，不作为长期运行目标；Phase 5 删除 Prisma 7 后必须归零。

## 6.1 Phase 0 特殊 API 审计结果

截至 Phase 1 收口，生产代码已确认以下 Prisma 8 高风险迁移面：

- `Prisma.sql`：62 处；
- atomic `{ increment: ... }`：10 处；
- 实际 `P2002` runtime 分支：5 处（另有 1 处说明性注释）；
- `P2025` production 判断：0 处；
- nested `upsert`：5 处；
- interactive transaction `maxWait/timeout`：2 处；
- Prisma JSON path filter：至少 1 处。

这些调用均留在 Phase 3 按模块迁移，不在 Phase 1/2 改写业务语义。

## 7. 回滚边界

- Phase 1/2：Git revert 即可，数据库无变化。
- Phase 3：按模块回退，数据库仍由 Prisma 7 管理。
- Phase 4 后 migration ownership 为单向切换，不再用 Prisma 7 产生新 migration；runtime 可暂时并存到 Phase 5。

