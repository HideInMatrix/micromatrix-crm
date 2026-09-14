# PRISMA8-001 执行任务

状态：`IN_PROGRESS`

## P0 文档与基线

- [x] P0.1 建立 requirements / design / testing / tasks 文档。
- [ ] P0.2 记录当前 Node/Prisma/package/Docker/Migration image 基线。
- [ ] P0.3 扫描 Prisma 8 不兼容调用：atomic increment、raw SQL、错误码、nested writes、transaction options。
- [ ] P0.4 跑迁移前 root typecheck/lint/build、API Rules、Prisma generate/status。
- [ ] P0.5 把 Node 24 基线提升到 24.11+ 并验证本地/CI/Docker 一致。

## P1 Prisma 7 side-by-side 隔离

- [ ] P1.1 将 Prisma 7 CLI 切换为 `@prisma/prisma7`。
- [ ] P1.2 `prisma.config.ts` 重命名为 `prisma7.config.ts`，更新 import。
- [ ] P1.3 所有 Prisma 7 scripts/CI/Docker 命令显式使用 `prisma7`。
- [ ] P1.4 更新独立 Migration package/image，保持 Prisma 7 migration ownership。
- [ ] P1.5 执行 Phase 1 全回归，确认数据库零变化。

## P2 Prisma 8 并行底座

- [ ] P2.1 安装 Prisma 8 CLI 与 `@prisma/orm-postgres`。
- [ ] P2.2 新建 Prisma 8 `prisma.config.ts`。
- [ ] P2.3 从 live PostgreSQL infer `prisma8/contract.prisma` 并完成 mapping 审计。
- [ ] P2.4 `contract emit`，接入 TypeScript 编译。
- [ ] P2.5 新增 Prisma 8 runtime lifecycle 封装。
- [ ] P2.6 新增 Prisma 7↔8 双 runtime 一致性测试。

## P3 Runtime 分批迁移

- [ ] P3.1 建立实际 Prisma delegate/import 清单并按风险分组。
- [ ] P3.2 第一批：低风险只读/简单 CRUD。
- [ ] P3.3 第二批：普通写事务与批量操作。
- [ ] P3.4 第三批：raw SQL / 动态字段 / DataScope。
- [ ] P3.5 第四批：审批 / 组织同步 / 消息 outbox / 并发协调。
- [ ] P3.6 Seed / Worker / Cron / 公共基础设施迁移。
- [ ] P3.7 production Prisma 7 import 扫描归零。

## P4 Migration ownership handoff

- [ ] P4.1 隔离数据库演练 Prisma 8 baseline/sign/status/ref。
- [ ] P4.2 additive migration 演练并 `db verify`。
- [ ] P4.3 开发主库完成正式 handoff。
- [ ] P4.4 Migration image / CI / release-init 切换到 Prisma 8 migration workflow。
- [ ] P4.5 更新 `prisma-migration-policy.md`，冻结 Prisma 7 migration workflow。

## P5 删除 Prisma 7 与最终验收

- [ ] P5.1 删除 Prisma 7 CLI/Client/adapter/config/generated artifacts。
- [ ] P5.2 删除所有 legacy Prisma 7 scripts。
- [ ] P5.3 fresh PostgreSQL + Seed + `db verify`。
- [ ] P5.4 API Rules、typecheck、lint、production build 全绿。
- [ ] P5.5 Docker release smoke 全绿。
- [ ] P5.6 代表性 Browser 回归全绿。
- [ ] P5.7 更新 architecture / project progress / alignment log / docs index，状态切为 `VERIFIED`。

## 当前执行指针

`P0.2 → P0.5`：先完成基线审计和 Node 24.11+ 前置条件，再进入 P1 Prisma 7 隔离。

