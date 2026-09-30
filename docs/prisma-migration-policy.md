# Prisma ORM 8 Migration 管理规范

## 1. 当前事实源

数据库结构与 migration ownership 只属于 Prisma ORM 8。

- Contract：`apps/api/src/prisma/contract.prisma`
- Emit 产物：`apps/api/src/prisma/contract.json`、`contract.d.ts`
- Prisma 配置：`apps/api/prisma.config.ts`
- 运行时 client：`apps/api/src/prisma/db.ts`
- Seed：`apps/api/src/prisma/seed.ts`
- Migration graph：`apps/api/migrations/`
- 正式 ref：`apps/api/migrations/app/refs/db.json`

当前 storage contract hash：`84a7bfdd8e9ff7e81dee91f5826ae2a9f529450a47db982ccfc5db4cba2b322b`。

当前 graph 共 9 条 migration / 2278 operations：

1. `20260918T0338_baseline`
2. `20260918T0826_timestamp_absolute_instants`
3. `20260918T0923_varchar_text_length_constraints`
4. `20260920T0347_canonical_check_constraint_names`
5. `20260928T0247_add_lead_stage_event`
6. `20260928T0309_add_external_event_inbox`
7. `20260928T0441_remove_bidding`
8. `20260928T0849_remove_legacy_sales_chain`
9. `20260930T0211_cleanup_legacy_approval_types`

Prisma 7 `schema.prisma`、generated Client class、`prisma/migrations` 和 `db push` 不再是本项目数据库工作流的一部分。

## 2. Contract 变更

结构变更从 `src/prisma/contract.prisma` 开始。修改后先生成运行时 contract：

```bash
pnpm prisma:emit
```

`contract emit` 必须把产物直接写到 `apps/api/src/prisma/`。不要重新创建 `src/prisma/generated/` 或独立 generated client 目录。

需要从真实数据库重新建立 contract 时使用：

```bash
pnpm prisma:infer
```

`contract infer` 只用于明确的 introspection / adoption 场景，不能用来覆盖尚未审计的本地结构修改。

## 3. 生成 forward migration

```bash
pnpm db:migrate:dev -- --name <change_name>
```

要求：

- 新 migration 必须从当前 `db` ref 指向的 contract 开始。
- 已进入共享分支或发布链的 migration package 不得原地修改。
- 结构变化使用新的 forward migration；不要通过手工改 snapshot、marker 或 ref 掩盖 drift。
- destructive / ambiguous 变更必须先做只读数据 precheck，再在隔离数据库演练。
- migration plan 必须审计 from/to contract、operation 数量以及实际 DDL 语义。

## 4. 应用与验证

开发、测试和生产都使用 Prisma 8 graph：

```bash
pnpm db:deploy
pnpm db:verify-migrations
pnpm db:status
pnpm db:verify
```

验收含义：

- `db:verify-migrations`：验证 migration package、snapshot 与 graph 完整性。
- `db:status`：当前数据库 marker 必须能解析到 graph，current/target contract 一致。
- `db:verify`：真实 PostgreSQL schema 必须满足 emitted contract。

三项没有全部通过时，不得把结构变更视为完成。

## 5. Fresh PostgreSQL

新数据库必须从正式 graph 初始化：

```bash
pnpm db:deploy
pnpm --filter @micromatrix/api run db:seed
pnpm db:verify
pnpm db:status
```

禁止使用 Prisma 7 `migrate deploy`、`migrate reset` 或 `db push` 作为当前正式初始化方案。

## 6. 已有数据库 adoption

只有数据库真实 schema 已经满足目标 contract、但 Prisma 8 marker/ref 尚未建立时，才允许使用 `db sign` / ref adoption。

在任何 sign/ref 操作前必须先完成 schema-only verify；如果真实结构仍有 drift，应通过正式 migration 修复，而不是用 marker 操作掩盖差异。

## 7. 原生 PostgreSQL 对象

当前 contract 中仍有 SQL body / PostgreSQL 原生对象。修改 expression/partial index、函数、触发器、View、Extension 或其它 native object 时必须同时满足：

- 检查 `contract emit` warning。
- 审计 migration preview。
- 在真实 PostgreSQL 执行 `db verify`。
- 对 authored SQL 与 PostgreSQL reprint 可能存在文本差异的对象，优先用真实数据库 infer 结果确认表达式。

## 8. Prisma ORM 8 Runtime 约束

`postgres<Contract>(...)` 返回 plain object。应用运行时只允许 `src/prisma/db.ts` 创建一个进程级 client；NestJS `PrismaService` 只是 DI / lifecycle wrapper。

Seed 使用同一个 `db`。只有需要独立连接、多连接互斥或测试隔离的测试代码，才允许在 `src/testing/prisma-test-db.ts` 创建额外 test client。

禁止重新引入：

- `extends PrismaClient`
- 生产 `prisma-client.ts` factory
- `src/prisma/generated/`
- Prisma 7 adapter / generated Client

## 9. Release 规则

Migration 镜像是生产数据库结构变更入口。Release 至少执行：

1. `prisma contract emit`
2. `prisma migration check`
3. `prisma db migrate`
4. bootstrap Seed（仅空安装补基础数据）
5. `prisma db verify`
6. `prisma migration status`

正式环境 destructive migration 仍必须针对目标数据库单独做只读 precheck，不能用开发库数据结论代替。

## 10. 审计原则

- migration from/to contract hash、migration hash、operation list 和 precheck 结果都属于发布审计证据。
- 不允许手工修改数据库 marker/ref 来绕过 schema drift。
- 高风险 DDL 先在隔离数据库演练，再进入开发主库和生产发布链。
- 文档里的 migration 数量/hash 发生变化时同步更新本文件和当前主线任务文档。
