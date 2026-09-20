# Prisma Migration 管理规范

## 1. 当前 ownership

自 PRISMA8-001 Phase 4 handoff 起，数据库结构与 migration ownership 已正式切换到 **Prisma 8 contract + migration graph**。

唯一正式事实源：

- Contract：`apps/api/prisma/contract.prisma`
- Prisma 8 config：`apps/api/prisma.config.ts`
- Migration graph：`apps/api/migrations/`
- 当前 app baseline：`apps/api/migrations/app/20260918T0338_baseline`
- 当前 forward migrations：
  - `20260918T0826_timestamp_absolute_instants`（126 operations）
  - `20260918T0923_varchar_text_length_constraints`（952 operations）
- 当前 migration graph：**3 migrations / 1750 operations**
- 当前 storage contract hash：`0d036f3fcbf3d2169c7530c49e3d96ae1c1961b75c8d3bbfe89bddebb274e0fe`
- 当前 baseline migration hash：`8664ea14548a7cf8419205988976d641f350b773488a2072c1f8f32e9d0312dd`
- 正式 ref：`apps/api/migrations/app/refs/db.json`，必须指向当前正式 contract hash。

Prisma 7 legacy Client/schema/migration runtime 已完成清理；历史 `_prisma_migrations` 只属于 handoff 前事实，不再承担正式 migration ownership。**禁止再用 Prisma 7 生成、修改、部署、resolve 或 db push 任何正式数据库结构**。

## 2. Handoff 基线

Phase 4 已完成以下 handoff 证据：

- 隔离验证库 `db015b_validation_0910`：最终 contract `db sign` PASS，`db` ref 指向 baseline，完整 `db verify` PASS，`migration status` 为 `Up to date`。
- 隔离库 additive 演练：从正式 baseline 增加一个 nullable 测试列，只生成 **1 个 additive operation**；`db migrate --advance-ref db`、完整 `db verify`、`migration status` 全部 PASS，旧 Prisma 7 Client 仍可读取同库。
- 开发主库 `default`：Prisma 7 历史在 handoff 前确认 3 migrations / schema up-to-date；随后 Prisma 8 `db sign`、`db ref`、完整 `db verify`、`migration status` 全部 PASS。
- PRISMA8-001 handoff 当时的正式 graph 为单一根 baseline，`migration check` PASS；PRISMA8-002 后续严格通过新增 forward migration 完成 timestamp/varchar schema 治理，没有改写已冻结 baseline。

Handoff 之后 migration ownership 是单向切换：不得因为旧环境仍保留 Prisma 7 Client 就恢复 Prisma 7 migration workflow。

## 3. 日常结构变更流程

数据库结构变更从修改 `prisma/contract.prisma` 开始。

### 3.1 生成 migration

先 emit contract：

```bash
pnpm prisma:emit
```

然后生成新的 Prisma 8 migration：

```bash
pnpm db:migrate:dev -- --name <change_name>
```

要求：

1. 新 migration 必须从当前 `db` ref / 当前正式 contract hash 出发。
2. 正常功能迭代只能新增 forward migration，禁止改写已经进入共享分支或发布链的历史 migration。
3. migration plan 必须审计 operation class、SQL preview、from/to contract hash。
4. destructive / ambiguous operation 不得仅凭 CLI 提示直接确认，必须先完成真实数据影响分析与专项 gate。

### 3.2 应用 migration

开发/测试/发布环境统一使用 Prisma 8：

```bash
pnpm db:deploy
```

正式语义等价于：

```bash
prisma db migrate --advance-ref db
```

迁移成功后 `db` ref 必须随目标 contract 前移。

### 3.3 状态与一致性验证

每次数据库结构变更至少执行：

```bash
pnpm db:verify-migrations
pnpm db:status
pnpm db:verify
```

含义：

- `db:verify-migrations`：执行 Prisma 8 `migration check`，验证 migration package / snapshot / graph 完整性。
- `db:status`：验证数据库 marker 能在当前 graph 中解析，且 current/target contract 一致。
- `db:verify`：同时校验 marker 与真实 PostgreSQL schema 是否满足 emitted contract。

只有三项都通过，数据库结构变更才允许进入 release gate。

## 4. 新数据库 / 已有数据库

### 4.1 Fresh PostgreSQL

Fresh PostgreSQL 必须走正式 graph：

```bash
pnpm db:deploy
SEED_MODE=bootstrap pnpm --filter @micromatrix/api run db:seed
pnpm db:verify
pnpm db:status
```

禁止用 Prisma 7 `migrate deploy` 或 `db push` 初始化新库。

### 4.2 已有数据库首次采用 Prisma 8 graph

仅当真实 schema 已经与目标 contract 一致时，才允许执行 adoption：

```bash
prisma db verify --schema-only
prisma db sign
prisma migration ref set db <baseline>
prisma db verify
prisma migration status
```

`db sign` 只用于“数据库结构已经满足 contract，但 marker 尚未采用当前 Prisma 8 graph”的 handoff/adoption 场景。它不是跳过 migration 的通用手段。

如果 `db verify --schema-only` 仍有 drift，应先修 contract 或通过正式 forward migration 解决，不得用 `db sign` 掩盖 schema 差异。

## 5. PostgreSQL 原生结构

当前 contract 中有六个使用 SQL body 的业务索引，必须持续进入 migration graph：

- `approval_flows_active_form_type_key`
- `organization_sync_batches_active_key`
- `custom_form_data_field_top_level_key`
- `custom_form_data_field_sub_cell_key`
- `custom_form_data_field_blob_top_level_key`
- `custom_form_data_field_blob_sub_cell_key`

Prisma 8 对 SQL body 的 drift 比较可能采用 authored SQL 文本；修改这些对象时必须：

1. 核对 contract emit warning。
2. 审计 migration preview 中的实际 SQL。
3. 在真实 PostgreSQL 上执行完整 `db verify`。
4. 必要时优先从 `contract infer` 获取数据库真实表达，而不是凭手写 SQL 猜测 introspection 结果。

以后增加任何函数、触发器、View、Extension、partial/expression index 或其它原生 PostgreSQL 对象时，也必须同时进入 contract / migration graph 的可验证边界。

## 6. Release / CI 规则

正式 release workflow 只允许 Prisma 8 migration ownership：

1. `prisma contract emit`
2. `prisma migration check`
3. Migration image 执行 `prisma db migrate`
4. migration 后执行 `prisma db verify`
5. `prisma migration status` 必须为 up-to-date
6. bootstrap Seed 继续使用 Prisma 8 runtime

Migration image、`docker/release-init.sh`、`docker/release-smoke.sh` 与 GitHub Release workflow 不得再调用 `legacy Prisma 7 CLI migrate` 或 `legacy Prisma 7 CLI db push`。

Docker release 的最终 fresh-PostgreSQL runtime smoke 属于 P5 最终验收；宿主机 Docker/Buildx 不可用时，不得用静态 grep 冒充真实 image PASS。

## 7. Prisma 7 冻结规则

Phase 4 起立即生效：

- 禁止 `legacy Prisma 7 CLI migrate dev`
- 禁止 `legacy Prisma 7 CLI migrate deploy`
- 禁止 `legacy Prisma 7 CLI migrate resolve`
- 禁止 `legacy Prisma 7 CLI db push` 作为正式或本地结构同步入口
- 禁止新增/修改 `apps/api/prisma/migrations/`
- 禁止把 `apps/api/prisma/schema.prisma` 当作新的结构事实源

在 Phase 5 之前，`legacy Prisma 7 CLI generate` / legacy Client / adapter / studio 仅为尚未删除的兼容构建资产；它们不拥有 migration 权限。Phase 5 将删除这些资产并把 `prisma8` / `src/prisma` 收口到 canonical `prisma` / `src/prisma`。

## 8. 不可变与审计原则

- 已进入正式 graph 的 migration package 不得就地篡改；结构变化使用新 forward migration。
- migration 的 from/to contract hash、migration hash、operation list 都属于审计证据。
- 不允许通过手工改 marker/ref 掩盖真实 schema drift。
- `db sign`、`migration ref set` 仅用于有明确 schema verify 证据的 handoff/adoption。
- 所有高风险 DDL 必须在独立数据库先演练，再进入开发主库/发布链。
- 每次 release 前必须同时验证 graph integrity、database marker、schema contract，而不是只验证其中一项。
