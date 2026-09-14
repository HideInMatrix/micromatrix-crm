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

1. `prisma7 generate` 仍生成原路径和同等 Client 类型。
2. `prisma7 migrate status` 能读取当前数据库。
3. `prisma7 migrate deploy` 在无 pending migration 时为 no-op。
4. Seed 仍使用 Prisma 7 Client 正常启动。
5. API typecheck / Rules / build 全绿。
6. Migration Docker image 仍使用 Prisma 7 初始化现有 schema。
7. Phase 1 不产生任何业务 schema diff。

## 4. Phase 2：Prisma 8 contract/runtime

- `contract infer` 可从 fresh DB 与当前开发 DB 生成 contract。
- 删除/忽略 `_prisma_migrations` ledger model。
- 模型、表、字段、schema mapping 与 live PostgreSQL 对齐。
- `contract emit` PASS，TypeScript 可 import emitted JSON/types。
- 双 runtime 一致性：Prisma 7 write → Prisma 8 read；Prisma 8 write → Prisma 7 read；两侧 rollback 都不可泄漏未提交数据。

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

## 6. Phase 4：Migration ownership handoff

先在隔离 PostgreSQL 演练：Prisma 7 migration + Seed 初始化 → Prisma 8 contract emit → baseline plan → `db sign` → `migration status` → `migration ref set db` → additive contract change → plan 只包含真实差异 → `db migrate --advance-ref db` → `db verify`。

隔离演练通过后才允许对开发主库执行 handoff。

## 7. Phase 5 最终 Gate

```text
Prisma 7 production imports   = 0
Prisma 7 runtime dependencies = 0
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

## 8. 不能作为“迁移完成”证据

- 只运行 `prisma --version`；
- 只完成 `contract emit`；
- 只改 package.json 版本；
- API 能启动但 Rules/事务测试未跑；
- fresh DB 能创建但现有库 handoff 未验证；
- 两代 Prisma 共存但没有明确 migration ownership。

