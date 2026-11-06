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

当前 contract、migration 数量、hash 和 migration 清单均由仓库文件及 Prisma 工具实时确定，不在本文维护易过期的快照。

Prisma 7 `schema.prisma`、generated Client class、`prisma/migrations` 和 `db push` 不属于当前数据库工作流。

## 2. Contract 变更

结构变更从 `src/prisma/contract.prisma` 开始。修改后生成运行时 contract：

```bash
pnpm prisma:emit
```

`contract emit` 必须把产物写到 `apps/api/src/prisma/`。不要重新创建 `src/prisma/generated/` 或独立 generated client 目录。

需要从真实数据库重新建立 contract 时使用：

```bash
pnpm prisma:infer
```

`contract infer` 只用于明确的 introspection / adoption 场景，不能覆盖尚未审计的本地结构修改。

## 3. 生成 forward migration

结构变化必须从当前正式 ref 对应的 contract 出发，使用项目 Prisma ORM 8 migration plan 工作流生成新的 forward migration：

```bash
pnpm db:migrate:dev
```

按 Prisma CLI 的计划结果检查变更，再确认并保存 migration package。

要求：

- 新 migration 必须基于当前 `db` ref，不得跳过中间 contract。
- 已进入共享分支或发布链的 migration package 不得原地修改。
- 结构变化使用新的 forward migration；不要通过手工改 snapshot、marker 或 ref 掩盖 drift。
- destructive / ambiguous 变更必须先做只读数据 precheck，再在隔离数据库演练。
- migration plan 必须审计 from/to contract、operation 数量以及实际 DDL 语义。

## 4. 应用与验证

开发、测试和生产都使用 Prisma ORM 8 graph：

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

只有数据库真实 schema 已经满足目标 contract、但 Prisma ORM 8 marker/ref 尚未建立时，才允许使用 `db sign` / ref adoption。

在任何 sign/ref 操作前必须先完成 schema-only verify；如果真实结构仍有 drift，应通过正式 migration 修复，而不是用 marker 操作掩盖差异。

## 7. 原生 PostgreSQL 对象

Contract 中存在 SQL body / PostgreSQL 原生对象。修改 expression/partial index、函数、触发器、View、Extension 或其它 native object 时必须同时满足：

- 检查 `contract emit` warning。
- 审计 migration preview。
- 在真实 PostgreSQL 执行 `db verify`。
- 对 authored SQL 与 PostgreSQL reprint 可能存在文本差异的对象，优先用真实数据库 infer 结果确认表达式。

## 8. Prisma ORM 8 Runtime 约束

`postgres<Contract>(...)` 返回 plain object。应用运行时只允许 `src/prisma/db.ts` 创建一个进程级 client；NestJS `PrismaService` 只是 DI / lifecycle wrapper。

Seed 使用同一个 `db`；项目不保留测试专用数据库 client。

禁止重新引入：

- `extends PrismaClient`
- 生产 `prisma-client.ts` factory
- `src/prisma/generated/`
- Prisma 7 adapter / generated Client

## 9. Release 流程与校验边界

GitHub Tag workflow `.github/workflows/release-docker.yml` 负责构建并推送 API、Migration、Web 三类镜像；它本身不执行生产数据库迁移，也不直接部署生产 Compose。

- Migration 镜像构建阶段执行 `prisma contract emit`。
- 生产 Compose 启动时，Migration 一次性容器执行 Prisma ORM 8 migration，并随后运行 bootstrap Seed。
- API / Worker / Web 按 Compose 依赖等待 Migration 成功后启动。
- Tag 构建成功不等于数据库迁移验证或生产部署成功。

推送发布 Tag 前，应在开发/预发布环境完成：

1. `pnpm prisma:emit`
2. `pnpm db:verify-migrations`
3. `pnpm db:status`
4. `pnpm db:verify`

正式环境 destructive migration 仍必须针对目标数据库单独做只读 precheck。部署完成后，应连接目标数据库再次执行 `pnpm db:status` 与 `pnpm db:verify`，确认 marker、migration graph 和真实 schema 一致。

## 10. 审计原则

- migration from/to contract、migration hash、operation list 和 precheck 结果属于发布审计证据。
- 不允许手工修改数据库 marker/ref 来绕过 schema drift。
- 高风险 DDL 先在隔离数据库演练，再进入开发主库和生产发布链。
