# PRISMA8-001 需求说明

## 1. 目标

将 MicroMatrix CRM 的 PostgreSQL ORM 从 Prisma 7 逐步迁移到 Prisma 8，并在迁移期间保持业务可运行、数据库数据不丢失、发布链可回滚。

本执行单元编号固定为 `PRISMA8-001`。

## 2. 外部版本事实

截至 2026-09-16，Prisma 8 为 Release Candidate。项目采用官方 PostgreSQL 7→8 side-by-side 迁移路径，不执行“一次性替换全部 Prisma 7 代码”。当前官方迁移指南目标版本为 `prisma@8.0.0-rc.14`、`@prisma/orm-postgres@8.0.0-rc.10`、`legacy Prisma 7 CLI package@7.10.0-dev.58`。

迁移前置条件：

- 项目运行时基线已经切到 Node 25.x；本迁移分支固定 `.nvmrc=25.7.0`、`engines.node=>=25 <26`，CI/Docker 同步使用 Node 25。
- TypeScript 主线固定为 `typescript@7.0.2`，root/API/Web/Mobile/shared/frontend-shared 统一使用 7.x；不得为了 Prisma 或静态分析工具兼容性把应用 compiler 回退到 6.x。
- TypeScript 7 当前不提供旧 JavaScript compiler API 的完全兼容面；`vue-tsc` 与 `typescript-eslint` 因此仅在各自工具进程内使用隔离的 `@typescript/old@npm:typescript@6.0.3` compatibility backend。该 TS6 包不得用于 API/shared 主编译、production build 或业务代码类型检查。
- PostgreSQL 继续使用现有数据库与连接串，不迁移数据库产品。

参考：

- <https://www.prisma.io/docs/prisma-orm/release-status>
- <https://docs.prisma.io/docs/guides/upgrade-prisma-orm/postgresql>
- <https://www.prisma.io/docs/orm/coming-from-prisma-orm-7>

## 3. 必须满足的需求

### R1 迁移期间业务连续性

- Phase 1～3 期间现有 Prisma 7 查询必须继续工作。
- Prisma 7 与 Prisma 8 必须连接同一个 PostgreSQL 数据库，不建立双库或数据复制层。
- 每个阶段结束时必须可独立构建、测试和运行。

### R2 Prisma 7 独立命名

- Prisma 7 CLI 必须迁移到 `legacy Prisma 7 CLI package` / `legacy Prisma 7 CLI` 命令。
- Prisma 7 配置文件必须迁移为 `legacy Prisma 7 config`。
- Prisma 7 Client 与 adapter 在 Prisma 8 runtime 完全接管前继续保留。
- Phase 1～3 的 schema/migration 所有权仍属于 Prisma 7。

### R3 Prisma 8 并行接入

- Prisma 8 CLI 使用 `prisma` 命令。
- PostgreSQL runtime 使用 `@prisma/orm-postgres`。
- Prisma 8 使用独立 `prisma.config.ts`、contract 和 emitted artifacts，禁止覆盖 Prisma 7 `schema.prisma` 或 generated client。
- Prisma 8 contract 必须从真实数据库推导并审计，不能凭手工复制 schema 假定等价。

### R4 Migration ownership 单向切换

- Phase 1～3 禁止使用 Prisma 8 修改数据库结构。
- 只有 Prisma 8 contract、runtime、回归测试和发布链准备完成后，才允许进入 Phase 4。
- Phase 4 必须完成 baseline migration、`db sign`、`migration status` 和 `db` ref 后，才能停止 Prisma 7 migration workflow。
- ownership 一旦切到 Prisma 8，禁止再使用 Prisma 7 `migrate dev/deploy/db push` 修改正式 schema。

### R5 查询 API 迁移必须按模块分批

- 不做全仓机械替换。
- 每批只迁移有清晰业务边界的 Service/Repository，并保留同批专项测试。
- 优先迁移低风险、只读或简单 CRUD 模块，再迁移事务、raw SQL、动态字段、审批和组织同步等高风险模块。

### R6 Prisma 8 RC 缺失能力必须显式处理

当前代码中以下 Prisma 7 能力不得直接照搬：

- atomic `increment/decrement`；
- `Prisma.sql/raw/join/empty`；
- `P2002/P2025` 错误码判断；
- `connectOrCreate` 以及多数 nested update/updateMany/upsert/delete/deleteMany/set；
- transaction isolation/maxWait/timeout 等旧选项；
- 其它 Prisma 8 当前未提供的一对一 API。

每类差异必须在迁移前扫描调用点，并在 `design.md` 中定义替代方案。

### R7 Docker / CI / Migration 镜像不得提前失效

- API runtime、独立 Migration image、GitHub Actions、本地脚本必须明确调用 Prisma 7 还是 Prisma 8。
- Phase 1～3 的生产 migration image 继续由 Prisma 7 执行现有 migration。
- Prisma 8 ownership handoff 之前禁止把 release-init 切到 Prisma 8 migration 命令。
- Node Docker base 必须使用项目 Node 25 主线。Prisma 7 side-by-side CLI 在 Node 25 上会输出上游支持线警告，因此 Phase 1 必须用真实 Node 25 镜像验证 generate/image；该警告随 Prisma 7 移除而消失，不能通过回退整个项目 Node 版本规避。

### R8 数据库事实一致性

- 迁移前后不得静默丢失 Prisma Schema 无法表达的 PostgreSQL 原生结构。
- 当前项目 pre-release migration 策略在 Phase 4 前继续有效；ownership 切换时单独更新 `docs/prisma-migration-policy.md`。
- fresh PostgreSQL、Seed、schema/contract verify 都必须进入测试门禁。

### R9 文档与状态必须同步

- 需求、设计、任务、测试计划必须先于破坏性迁移实现落地。
- `project-progress.md`、`alignment-log.md`、架构和 migration policy 必须随着阶段切换更新。
- 不得把“已安装 Prisma 8”表述成“项目已完成 Prisma 8 迁移”。

## 4. 非目标

- 不因为 Prisma 8 迁移顺带重构业务规则。
- 不更换 PostgreSQL、NestJS、Redis 或前端框架。
- 不在同一阶段清理与 Prisma 8 无关的历史技术债。
- 不在 Phase 4 前删除 Prisma 7 generated client 或 `_prisma_migrations`。

## 5. 完成定义

只有以下条件全部满足，`PRISMA8-001` 才能标记 `VERIFIED`：

1. 生产运行时代码不再 import Prisma 7 generated client。
2. Prisma 8 contract 为唯一活动数据模型来源。
3. Prisma 8 runtime 覆盖全部 API/worker/seed 所需数据库操作。
4. Prisma 8 拥有 migration workflow，数据库 `db verify` PASS。
5. Prisma 7 CLI、Client、adapter、config 和旧脚本从运行依赖中删除。
6. fresh PostgreSQL、现有开发库升级路径、API Rules、typecheck、lint、build、Docker release smoke 全绿。
7. side-by-side 目录命名必须收口：过渡期的 `apps/api/prisma/contract.prisma`、`apps/api/src/prisma/*` 不作为长期结构保留；最终 Prisma 8 contract 使用 canonical `apps/api/prisma/contract.prisma`，运行时封装/生成 artifact 收口到 `apps/api/src/prisma/*`，旧 Prisma 7 `schema.prisma` / generated client / `legacy Prisma 7 config` 删除。
8. package scripts、Migration image、Docker release、GitHub Actions 与本地数据库命令不得再出现正式 `legacy Prisma 7 CLI` 调用；`build/typecheck/test` 的数据模型前置步骤统一使用 Prisma 8 `contract emit`，migration/release 链统一使用 Phase 4 验证后的 Prisma 8 workflow。

