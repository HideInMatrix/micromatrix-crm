# PRISMA8-001 执行任务

状态：`VERIFIED`

## P0 文档与基线

- [x] P0.1 建立 requirements / design / testing / tasks 文档。
- [x] P0.2 记录当前 Node/Prisma/package/Docker/Migration image 基线。
- [x] P0.3 扫描 Prisma 8 不兼容调用：atomic increment、raw SQL、错误码、nested writes、transaction options。
- [x] P0.4 跑迁移前 root typecheck/lint/build、API Rules、Prisma generate/status。
- [x] P0.5 按项目决策将运行基线固定到 Node 25.x，并验证 CI/Docker 配置与真实 Node 25 Migration image。

## P1 Prisma 7 side-by-side 隔离

- [x] P1.1 将 Prisma 7 CLI 切换为 `legacy Prisma 7 CLI package`。
- [x] P1.2 `prisma.config.ts` 重命名为 `legacy Prisma 7 config`，更新 import。
- [x] P1.3 所有 Prisma 7 scripts/CI/Docker 命令显式使用 `legacy Prisma 7 CLI`。
- [x] P1.4 更新独立 Migration package/image，保持 Prisma 7 migration ownership。
- [x] P1.5 执行 Phase 1 全回归，确认数据库零变化。

## P2 Prisma 8 并行底座

- [x] P2.1 安装 Prisma 8 CLI 与 `@prisma/orm-postgres`。
- [x] P2.2 新建 Prisma 8 `prisma.config.ts`。
- [x] P2.3 从 live PostgreSQL infer `prisma/contract.prisma` 并完成 mapping 审计。
- [x] P2.4 `contract emit`，接入 TypeScript 编译。
- [x] P2.5 新增 Prisma 8 runtime lifecycle 封装。
- [x] P2.6 新增 Prisma 7↔8 双 runtime 一致性测试。

## P3 Runtime 分批迁移

- [x] P3.1 建立实际 Prisma delegate/import 清单并按风险分组。
- [x] P3.2 第一批：低风险只读/简单 CRUD。
- [x] P3.3 第二批：普通写事务与批量操作。
- [x] P3.4 第三批：raw SQL / 动态字段 / DataScope。
- [x] P3.5 第四批：审批 / 组织同步 / 消息 outbox / 并发协调。
- [x] P3.6 Seed / Worker / Cron / 公共基础设施迁移。
- [x] P3.7 production Prisma 7 import 扫描归零。

## P4 Migration ownership handoff

- [x] P4.1 隔离数据库演练 Prisma 8 baseline/sign/status/ref。
- [x] P4.2 additive migration 演练并 `db verify`。
- [x] P4.3 开发主库完成正式 handoff。
- [x] P4.4 Migration image / CI / release-init 切换到 Prisma 8 migration workflow。
- [x] P4.5 更新 `prisma-migration-policy.md`，冻结 Prisma 7 migration workflow。

## P5 删除 Prisma 7 与最终验收

- [x] P5.1 删除 Prisma 7 CLI/Client/adapter/config/generated artifacts，并将过渡目录收口为 canonical `prisma/contract.prisma` / `src/prisma`。
- [x] P5.2 删除所有 legacy Prisma 7 scripts；`dev/build/typecheck/test` 改用 Prisma 8 `contract emit` 前置，Migration image / Docker / release-init / release-smoke / GitHub Actions 仅保留 Prisma 8 workflow，并完成 legacy Prisma 7 执行标识仓库零残留扫描。
- [x] P5.3 fresh PostgreSQL + Seed + `db verify`。
- [x] P5.4 API Rules、typecheck、lint、production build 全绿。
- [x] P5.5 Docker release smoke 全绿。
- [x] P5.6 代表性 Browser 回归全绿。
- [x] P5.7 更新 architecture / project progress / alignment log / docs index，状态切为 `VERIFIED`。

## 当前执行指针

`PRISMA8-001` 已完成并封板为 `VERIFIED`。正式 Prisma 8 storage contract hash 为 `651134f9ccfda014c4a27d235488e56b4640ad20fbf307fe0acaa0b8e39566de`，canonical baseline 为 `20260918T0338_baseline`（**672 operations**，migration hash `8664ea14548a7cf8419205988976d641f350b773488a2072c1f8f32e9d0312dd`）。legacy Prisma Client/adapter/service/module/generated artifacts 与旧执行标识均已清理；fresh PostgreSQL baseline → bootstrap Seed → `db verify` → `migration status` 全绿；API Rules **346/346 PASS、0 fail、0 skip**，root typecheck/lint/build 均 exit 0。

最终 Docker release smoke 使用仓库原始 `docker/release-smoke.sh` **exit 0**：API/Migration/Web image、fresh PostgreSQL migration/bootstrap、`db verify`、migration status、worker/API/Web runtime、管理员登录、Redis cache、重复初始化密码保护、PC/Mobile SPA fallback 与 `/api` proxy 全部通过。代表性 Browser 回归覆盖登录、Dashboard、商机高级筛选、客户列表/详情 Drawer、线索关键词搜索，API 运行日志未发现 5xx/runtime exception。**当前执行指针：无；PRISMA8-001 已完成。**
