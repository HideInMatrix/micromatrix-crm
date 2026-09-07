# W3.4-D Docker 发布链路任务

- [x] D1 固化 Docker 发布需求与设计
  - 前后端独立镜像、Prisma migration、Nginx runtime proxy、GHCR 与 tag 触发边界已确定。

- [x] D2 实现 API/Web multi-stage Dockerfile
  - API：Node 24 + pnpm 11.25.0 + OpenSSL，production deploy，非 root 运行，uploads volume 与 healthcheck。
  - Web：Vite builder + Nginx Alpine，SPA fallback、SSE-safe `/api` proxy 与 healthcheck。

- [x] D3 实现 release compose
  - PostgreSQL → migrate → API → Web 健康依赖链。
  - 增加 `docker/.env.release.example`，不提交真实生产密钥。

- [x] D4 实现 GitHub tag release workflow
  - `v*.*.*` tag push 触发。
  - SemVer 校验、shared → API/Web 依赖有序 typecheck/lint、真实 Docker Smoke 门禁。
  - GitHub Actions 当前使用 `actions/checkout@v7`；verify 工具链由 `pnpm/setup@v2.1.0` 统一准备 pnpm 11.25.0 + Node 24 + pnpm store cache，不再依赖 `actions/setup-node` / `pnpm/action-setup` 双 setup。
  - API/Web 独立构建并发布 GHCR `linux/amd64` + `linux/arm64` 镜像。

- [x] D5 增加 Docker release Smoke
  - `pnpm smoke:docker-release` 从源码构建两个镜像。
  - 临时 PostgreSQL 从零成功应用 34 个 migration。
  - API runtime health、Nginx health、SPA `/login` fallback、`/api/health` proxy 均已实测通过。

- [x] D6 最终质量检查
  - Docker Compose config、pnpm lockfile、typecheck、lint、格式与 diff 检查通过。
  - 删除本地 `packages/shared/dist` 后重新执行 clean-runner typecheck，确认不依赖开发机残留构建产物。
  - W3.4-D 完成后执行指针恢复到 W3.4.2 task 3.1。

- [x] D7 GitHub Actions 多架构构建性能加固（2026-09-01）
  - Web builder 固定 `BUILDPLATFORM`，Vite 静态产物只在原生 runner 构建一次；Web workspace install 收窄到 `@micromatrix/web...`，不再安装 API/Prisma。
  - API amd64/arm64 拆到 `ubuntu-latest` / `ubuntu-24.04-arm` 原生 Runner 并行构建，随后通过 `buildx imagetools create` 合并正式 multi-arch manifest，移除 API QEMU 构建路径。
  - API Dockerfile 只安装 API + shared；OpenSSL/CA 抽为共享 base；production deploy 从 `--legacy` 切到 dedicated-lockfile modern deploy，并复用 pnpm store。
  - amd64 与 arm64 API 镜像均已真实构建并验证 `dist/main.js`、Prisma CLI、无 `/app/.env`；ARM production deploy **369 reused / 0 downloaded**。
  - `pnpm smoke:docker-release` 在 62 migrations 基线上 PASS：Prisma migrate、API health、Nginx health、`/api` proxy 与 SPA fallback 全绿。

- [x] D8 API runtime 镜像瘦身与 migration 职责拆分（2026-09-02）
  - API runtime 从 Node 24 Debian slim 切换到 Node 24 Alpine，production deploy 增加 `--no-optional`，移除 Prisma CLI、Studio、TypeScript/PGlite 等非运行时依赖。
  - `prisma` 从 API package manifest 移出，仓库根保留开发构建 CLI；新增 `@micromatrix/migrate` 与 `docker/migrate.Dockerfile`，专门执行生产 migration。
  - release compose 改为 PostgreSQL → 独立 Migration 镜像 → API → Web；GitHub tag workflow 同时发布 `-api`、`-migrate`、`-web` 三个 multi-arch 镜像。
  - 本地 API 镜像实测由约 **988MB** 降至约 **517MB**；空 PostgreSQL 上独立 Migration 镜像成功应用 **68 migrations**，随后瘦身 API `/api/health` 返回 200。

- [x] D9 Redis cache runtime 纳入 release 验收（2026-09-03）
  - release Compose 增加密码认证 Redis、AOF volume 与 healthcheck，不发布宿主机端口；API 不把 Redis healthy 作为启动硬门槛，Migration 继续只依赖 PostgreSQL。
  - `pnpm smoke:docker-release` 增加真实 Redis 容器，登录后验证 AuthGuard cache key、通知 unread cache key，并在修改管理员密码后断言认证缓存被主动删除。
  - 当前源码三镜像重新实建，隔离 PostgreSQL **68/68 migrations**、Redis cache integration、重复初始化保护、API/Nginx health、`/api` proxy 与 SPA fallback 全部 PASS。
  - 另以相同 release API/Migration 镜像完成 Redis 缺席冷启动：不启动 Redis 时 API health、登录、AuthGuard protected endpoint 与通知未读接口仍全部 200，确认 cache runtime 不是业务单点。

- [x] D10 GitHub Docker Smoke 入口回归修复（2026-09-07）
  - 确认根 `.gitignore` 长期忽略 `/scripts/`，而 `f8c3bea` 清理本地脚本时删除了此前 tracked 的 `scripts/docker-release-smoke.sh`，`.github/workflows/release-docker.yml` 却仍引用旧路径，导致 tag workflow 在 GitHub Runner 报 `No such file or directory`。
  - 从删除前最后版本恢复完整 Docker release Smoke 到可跟踪的 `docker/release-smoke.sh`；不解除 `/scripts/` 忽略规则，避免本地 Browser/Service Smoke 被误提交。
  - GitHub `docker-smoke` job 直接执行 `bash docker/release-smoke.sh`，不依赖该 job 未安装的 pnpm；根 `package.json` 同时恢复 `pnpm smoke:docker-release` 作为本地统一入口。
  - `bash -n`、workflow/path、当前 API/Web/Migration Dockerfile 契约断言均 PASS。本地真实镜像构建已启动到 Docker BuildKit 解析 `docker/dockerfile:1.7`，但 Docker Hub 解析在项目构建前持续阻塞，人工终止；该外部拉取阻塞不作为项目 Smoke PASS 证据，下一次 tag Runner 继续执行完整 runtime 门禁。

- [x] D11 Migration Seed shared runtime 依赖修复（2026-09-07）
  - GitHub Docker Smoke 已成功构建并启动 Migration 镜像，但 `prisma migrate deploy` 后执行 `tsx prisma/seed.ts` 报 `Cannot find module '@micromatrix/shared'`；根因是 Seed 已运行时引用 `MESSAGE_TASK_DEFINITIONS`，而 `@micromatrix/migrate` production dependency 与镜像 deploy 均未包含 shared。
  - `packages/migrate` 正式声明 `@micromatrix/shared: workspace:*`；Migration Docker builder 增加 shared package/source、执行 `@micromatrix/shared build`，再通过 pnpm 11 injected workspace production deploy 输出完整 runtime 依赖。
  - 宿主机 production deploy 实查 `@micromatrix/shared` 可解析，`MESSAGE_TASK_DEFINITIONS=47`；Migration 镜像独立构建 PASS。
  - 隔离 PostgreSQL 下以新 Migration 镜像执行默认 `init`，baseline migration + bootstrap Seed 均 PASS，并实查 `message_task_settings=47`，证明 shared 常量已真实参与 Seed 执行。
