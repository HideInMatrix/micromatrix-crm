# PRISMA8-001 技术设计

## 1. 总体策略

采用 Prisma 官方 PostgreSQL side-by-side 方案。迁移期间存在两套明确隔离的 ORM 工具链，但只连接同一个数据库：

```text
PostgreSQL
   ├── Prisma 7: prisma7.config.ts / prisma/schema.prisma / src/generated/prisma
   └── Prisma 8: prisma.config.ts / prisma8/contract.prisma / generated/prisma8
```

Phase 1～3 中只有 Prisma 7 可以改变数据库结构；Prisma 8 只读取同一个数据库并逐模块承接 runtime 查询。

## 2. 阶段设计

### Phase 0：基线冻结与前置条件

- 固化 Node 24 主线最低版本 `24.11.0`。
- 记录当前 Prisma 7 版本、Migration image、release-init、schema、adapter、raw SQL 和 error-code 调用点。
- 跑当前 root typecheck/build/lint、API Rules、Prisma validate/generate/status。
- 不修改业务 ORM 调用。

### Phase 1：Prisma 7 side-by-side 隔离

- Prisma 7 CLI 从 `prisma` 切到官方 `@prisma/prisma7`。
- `apps/api/prisma.config.ts` → `apps/api/prisma7.config.ts`。
- Prisma 7 scripts 改为 `prisma7 generate / migrate / db push / studio`。
- 根 `db:*` 脚本在 Phase 1～3 继续指向 Prisma 7。
- `@micromatrix/migrate` 和 Docker Migration image 明确携带 Prisma 7 CLI。
- `@prisma/client` / `@prisma/adapter-pg` 继续作为 legacy runtime，生成现有 `src/generated/prisma`。

此阶段要求零业务行为变化。

### Phase 2：接入 Prisma 8 contract/runtime

- 安装 Prisma 8 CLI 和 `@prisma/orm-postgres`。
- 新建 Prisma 8 `prisma.config.ts`。
- 从 live PostgreSQL `contract infer`，删除 Prisma 7 ledger 对应模型并审计所有 mapping。
- `contract emit` 生成 JSON/type artifacts。
- 增加 Prisma 8 runtime lifecycle 封装，不暴露 Prisma 7 兼容 facade。
- 增加双 runtime 健康测试，证明两代 runtime 对同一数据库互操作。

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

当 production code 不再 import `src/generated/prisma` 后，删除 `@prisma/prisma7`、`@prisma/client`、`@prisma/adapter-pg`、`prisma7.config.ts`、legacy generated client 和脚本。`_prisma_migrations` 可作为 inert 历史表保留。

## 6. Node 与容器基线

当前开发机 Node `24.5.0` 不满足 Prisma 8 对 Node 24 线的要求，因此先把项目 Node 24 基线提升到 `>=24.11.0`，覆盖根 engines、本地版本声明、Docker builder/runtime、CI 和 release smoke；不顺带切 Node 25/26 主线。

## 7. 回滚边界

- Phase 1/2：Git revert 即可，数据库无变化。
- Phase 3：按模块回退，数据库仍由 Prisma 7 管理。
- Phase 4 后 migration ownership 为单向切换，不再用 Prisma 7 产生新 migration；runtime 可暂时并存到 Phase 5。

