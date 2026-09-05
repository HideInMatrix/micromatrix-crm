# Prisma Migration 管理规范

## 1. 当前阶段

MicroMatrix CRM 当前尚未正式发布，没有需要跨版本保留的生产旧数据。因此数据库结构采用 **pre-release single baseline** 策略：

- `apps/api/prisma/schema.prisma` 是当前数据模型唯一真相源。
- `apps/api/prisma/migrations/` 在 Git 中始终只保留 **1 个 baseline migration + `migration_lock.toml`**。
- 开发过程中可以临时生成 migration 用于本地验证，但准备提交数据库结构变更前必须重新 squash 回单一 baseline。
- 不把旧开发数据库的数据搬迁、旧字段回填、兼容读写或双写逻辑带入 baseline；需要的开发数据由 `seed.ts` 从目标结构初始化。

当前 baseline：

```text
apps/api/prisma/migrations/
├── 20260905084900_baseline/
│   └── migration.sql
└── migration_lock.toml
```

## 2. 每次数据库结构变更的合并流程

修改 `schema.prisma` 并完成业务实现后，在提交前按以下顺序处理：

1. 执行 Prisma format / validate / generate，确认 Schema 本身有效。
2. 从空数据库模型生成完整目标 SQL，而不是在已有 baseline 后继续堆叠提交用 migration：

   ```bash
   cd apps/api
   pnpm exec prisma migrate diff \
     --from-empty \
     --to-schema=prisma/schema.prisma \
     --script \
     --output=/tmp/micromatrix-baseline.sql
   ```

3. 审计上一版 baseline 和本次业务变更中的 PostgreSQL 原生结构。凡 Prisma Schema 无法表达的约束、partial index、函数、触发器、View、Extension 等，都必须显式追加到新 baseline，禁止因 squash 静默丢失。
4. 用新生成 SQL 替换旧 baseline migration；`migrations/` 最终仍只能存在一个 baseline 目录。
5. 新建一个**全新空 PostgreSQL**，只使用仓库中的 baseline 执行：

   ```bash
   pnpm exec prisma migrate deploy
   pnpm run db:seed
   ```

6. 对新库执行结构一致性检查：

   ```bash
   pnpm exec prisma migrate diff \
     --from-config-datasource \
     --to-schema=prisma/schema.prisma \
     --exit-code
   ```

   预期结果必须为 `No difference detected.`。

7. 对 Prisma 无法表达的原生结构执行数据库级查询确认，不能只依赖第 6 步，因为 Prisma diff 不会把所有原生结构纳入比较。

## 3. 当前必须保留的 PostgreSQL 原生结构

当前 Schema 外还存在两条业务约束所需的 partial unique index，新 baseline 每次重建时都必须保留：

```sql
CREATE UNIQUE INDEX "approval_flows_active_form_type_key"
ON "approval_flows"("tenantId", "formType")
WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "organization_sync_batches_active_key"
ON "organization_sync_batches"("tenantId", "provider")
WHERE "status" IN ('FETCHING', 'APPLYING');
```

这份列表不是永久封闭清单。以后增加任何 Prisma 无法表达的 PostgreSQL 原生结构时，必须同步登记到本节，并纳入 baseline 空库验证。

## 4. 正式发布后的切换规则

一旦存在首个正式生产发布并需要保留生产数据，立即终止 single-baseline 策略：

- 已发布 baseline 成为不可修改历史。
- 每一次数据库变化都新增独立 forward-only migration。
- 已经执行到生产的 migration 不得重写、删除、改名或重新 squash。
- 涉及旧数据转换时，数据迁移 SQL 与结构迁移一起进入对应 forward migration，并按真实升级路径验证。
- 生产部署继续由现有独立 Migration 镜像执行 `prisma migrate deploy`，不改为 `db push`。

正式发布是迁移策略的单向切换点；切换后不得再因为“目录太多”重新合并生产 migration 历史。
