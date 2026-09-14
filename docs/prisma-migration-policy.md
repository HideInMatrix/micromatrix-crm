# Prisma Migration 管理规范

## 1. 当前阶段

项目当前已经存在被 CI/发布链登记为 **published immutable** 的 Prisma migration，因此 migration 历史已经进入 **forward-only** 模式。无论业务是否仍处于内部阶段，只要 migration 被 `docker/verify-prisma-migrations.mjs` 登记为 immutable，就禁止再修改、删除、改名或重新 squash。

- `apps/api/prisma/schema.prisma` 仍是当前 Prisma 7 数据模型真相源。
- 已发布 migration 的 SQL 与 SHA-256 必须永久保持一致。
- 后续数据库结构变化只能新增新的时间戳 migration。
- 生产/CI 继续使用独立 Migration image 执行 `prisma migrate deploy`，不得以 `db push` 替代正式 migration。
- `db push` 仅允许用于明确的本地临时实验；一旦对应结构进入仓库，必须用 forward migration 记录并使本地 `_prisma_migrations` 与真实结构一致。

当前 migration 历史：

```text
apps/api/prisma/migrations/
├── 20260905084900_baseline/
│   └── migration.sql
├── 20260911153000_lark_provider_schema/
│   └── migration.sql
├── 20260914152000_enterprise_platform_state/
│   └── migration.sql
└── migration_lock.toml
```

其中 `20260905084900_baseline` 与 `20260911153000_lark_provider_schema` 已进入 immutable 校验；`20260914152000_enterprise_platform_state` 是后续新增的 forward migration。

## 2. 每次数据库结构变更的合并流程

修改 `schema.prisma` 并完成业务实现后，在提交前按以下顺序处理：

1. 执行 Prisma format / validate / generate，确认 Schema 本身有效。
2. 新增一个新的时间戳 migration；禁止修改任何已经进入 immutable 列表的 migration。
3. 审计本次结构变化和 PostgreSQL 原生结构。Prisma Schema 无法表达的 partial index、函数、触发器、View、Extension 等必须显式写入新的 forward migration。
4. 执行仓库 migration 不可变校验：

   ```bash
   pnpm db:verify-migrations
   ```

5. 新建一个**全新空 PostgreSQL**，按仓库中全部 migration 顺序执行：

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

### 2.1 本地开发库已经提前拥有新结构时的处理

开发阶段可能出现先通过 `db push` 或临时 SQL 得到目标结构、随后才补正式 forward migration 的情况。此时**不要再次执行同一 ALTER**，也不要回头修改已发布 migration。

先执行结构 drift 检查：

```bash
cd apps/api
pnpm exec prisma migrate diff \
  --from-config-datasource \
  --to-schema=prisma/schema.prisma \
  --script
```

- 如果 diff 不是空的，按正常 forward migration 执行 `prisma migrate deploy`，不得用 `resolve` 掩盖未实际执行的结构变化。
- 如果 diff 明确为空，说明数据库已经拥有该 migration 的完整效果；此时才允许对**当前本地开发库**使用：

  ```bash
  pnpm exec prisma migrate resolve --applied <migration_name>
  ```

  `migrate resolve` 只修正 migration ledger，不执行 SQL，因此必须以前述空 diff 为前置证据。

完成后必须再次执行：

```bash
pnpm exec prisma migrate diff \
  --from-config-datasource \
  --to-schema=prisma/schema.prisma
```

预期结果必须为 `No difference detected.`，随后 `prisma migrate status` 必须返回 `Database schema is up to date!`。

## 3. 当前必须保留的 PostgreSQL 原生结构

当前 Schema 外还存在六条业务约束所需的 partial unique index，新 baseline 每次重建时都必须保留：

```sql
CREATE UNIQUE INDEX "approval_flows_active_form_type_key"
ON "approval_flows"("tenantId", "formType")
WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "organization_sync_batches_active_key"
ON "organization_sync_batches"("tenantId", "provider")
WHERE "status" IN ('FETCHING', 'APPLYING');

CREATE UNIQUE INDEX "custom_form_data_field_top_level_key"
ON "custom_form_data_field"("resource_id", "field_id")
WHERE "ref_sub_id" IS NULL;

CREATE UNIQUE INDEX "custom_form_data_field_sub_cell_key"
ON "custom_form_data_field"("resource_id", "ref_sub_id", "row_id", "field_id")
WHERE "ref_sub_id" IS NOT NULL;

CREATE UNIQUE INDEX "custom_form_data_field_blob_top_level_key"
ON "custom_form_data_field_blob"("resource_id", "field_id")
WHERE "ref_sub_id" IS NULL;

CREATE UNIQUE INDEX "custom_form_data_field_blob_sub_cell_key"
ON "custom_form_data_field_blob"("resource_id", "ref_sub_id", "row_id", "field_id")
WHERE "ref_sub_id" IS NOT NULL;
```

这份列表不是永久封闭清单。以后增加任何 Prisma 无法表达的 PostgreSQL 原生结构时，必须同步登记到本节，并纳入 fresh DB 全 migration 验证。

## 4. 不可变规则

- `docker/verify-prisma-migrations.mjs` 中登记的 migration 视为 published immutable；SHA-256 变化必须直接导致 CI 失败。
- 发现旧 migration 缺字段时新增 forward migration，禁止修改旧 SQL 来“补齐”。
- 涉及旧数据转换时，数据迁移 SQL 与结构迁移一起进入对应 forward migration，并按真实升级路径验证。
- 不得因为 migration 目录增多而重新合并、改写已经发布的历史。
