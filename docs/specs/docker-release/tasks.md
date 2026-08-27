# W3.4-D Docker 发布链路任务

- [x] D1 固化 Docker 发布需求与设计
  - 前后端独立镜像、Prisma migration、Nginx runtime proxy、GHCR 与 tag 触发边界已确定。

- [x] D2 实现 API/Web multi-stage Dockerfile
  - API：Node 24 + pnpm 10.30.3 + OpenSSL，production deploy，非 root 运行，uploads volume 与 healthcheck。
  - Web：Vite builder + Nginx Alpine，SPA fallback、SSE-safe `/api` proxy 与 healthcheck。

- [x] D3 实现 release compose
  - PostgreSQL → migrate → API → Web 健康依赖链。
  - 增加 `docker/.env.release.example`，不提交真实生产密钥。

- [x] D4 实现 GitHub tag release workflow
  - `v*.*.*` tag push 触发。
  - SemVer 校验、typecheck/lint、真实 Docker Smoke 门禁。
  - API/Web 独立构建并发布 GHCR `linux/amd64` + `linux/arm64` 镜像。

- [x] D5 增加 Docker release Smoke
  - `pnpm smoke:docker-release` 从源码构建两个镜像。
  - 临时 PostgreSQL 从零成功应用 34 个 migration。
  - API runtime health、Nginx health、SPA `/login` fallback、`/api/health` proxy 均已实测通过。

- [x] D6 最终质量检查
  - Docker Compose config、pnpm lockfile、typecheck、lint、格式与 diff 检查通过。
  - W3.4-D 完成后执行指针恢复到 W3.4.2 task 3.1。
