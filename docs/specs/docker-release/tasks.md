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
