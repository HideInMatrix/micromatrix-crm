# CACHE-001 Redis 平台缓存第一批任务

- [x] C1 固化需求、设计、范围与失败语义
  - 建立 `requirements.md / design.md / tasks.md`。
  - 确认 PostgreSQL 为唯一业务真相源，Redis 只做可丢弃派生缓存。
  - 明确第一批只覆盖 Redis 公共基座、认证上下文、通知读取；不顺带实施验证码、序列号、BullMQ、分布式锁或 SSE Pub/Sub。
  - _Requirements: R1-R6_

- [x] C2 建立 Redis 公共模块与部署契约
  - 引入 `ioredis`，建立全局 `RedisModule/RedisService` 和统一 key prefix。
  - 支持 URL/host 两类配置、有限超时、故障降级、错误日志节流和 shutdown。
  - 开发/release Compose 增加 Redis 密码、volume、healthcheck；API 使用内部 service name 连接但不以 Redis healthy 作为冷启动硬门槛，Redis 不发布宿主端口。
  - 同步 `.env.example` 与 `docker/.env.release.example`。
  - _Requirements: R1, R2, R5_

- [x] C3 接入 AuthGuard 认证上下文缓存
  - `AuthContextCacheService` 保存 `authVersion + AuthUser`，TTL 60 秒。
  - Guard cache hit 继续校验 JWT authVersion；API Key 凭证本身不缓存。
  - 缓存 miss 保留原 Prisma active user + roles 读取及权限校验路径。
  - _Requirements: R3, R5_

- [x] C4 补齐认证上下文主动失效矩阵
  - 成员编辑/状态/密码/删除、角色配置/成员关系、个人资料、企微资料回写、组织同步应用后精确失效。
  - 重新扫描 production `User/UserRole/Role` 写入口，确认不存在遗漏的权限上下文变更路径。
  - _Requirements: R3, R5_

- [x] C5 接入通知未读数与分页缓存
  - unread count 与参数化 list 使用 30 秒 cache-aside。
  - 新通知、单条已读、全部已读使用用户通知 version `INCR` 失效，禁止 keyspace scan。
  - 保持通知数据库落库、SSE 和业务消息设置行为不变。
  - _Requirements: R4, R5_

- [x] C6 完成单元、真实 Redis 与 Compose 验收
  - Auth cache 与 Notifications cache 单测通过。
  - API typecheck、Rules、`git diff --check` 通过。
  - 真实 Redis 验证密码 healthcheck、TTL、INCR、API ioredis JSON 读写与 Redis 故障回退。
  - Compose config 验证 Redis 无 published port、API 只硬依赖 PostgreSQL migration 完成而不硬依赖 Redis health、migrate 不依赖 Redis。
  - _Requirements: R6_

- [x] C7 文档封板
  - 更新 `architecture.md`、`project-progress.md`、`alignment-log.md`、部署说明与任务状态。
  - 记录首批实际收益与仍未进入本批的 Redis 候选能力。
  - 只有 C2～C6 全绿后才能把 `CACHE-001` 标记为 `VERIFIED`。
  - _Requirements: R1-R6_

## 最终验收证据（2026-09-03）

- API typecheck PASS；缓存专项 **3/3**；全量 Rules **143/143**；`git diff --check` PASS。
- production 写入口重新扫描 `User/UserRole/Role` 后补齐一个关联失效边界：禁用/删除直属上级以及组织同步 DISABLE 成员时，其下属 `leaderId` 会被清空，因此下属认证上下文也必须同步失效。
- 真实 `redis:7-alpine` + 密码认证验证 `PING / SET / TTL / INCR / GET` 全部通过，Compose Redis health=`healthy`；Redis 没有宿主机 published port。
- 项目实际 `RedisService` 连接真实 Redis 完成 JSON round-trip、`INCR 1→2`、批量删除；未配置 Redis与不可连接 Redis 两种路径均立即返回 cache miss/no-op，其中不可连接读取实测 `elapsedMs=0`，业务可继续回退数据库。
- release Compose 静态验证：API 只等待 `migrate: service_completed_successfully`，不以 Redis health 作为启动硬门槛；Migration 只等待 PostgreSQL，不依赖 Redis。
- release 镜像冷启动 fail-open 实测：完全不启动 Redis、仅配置一个不存在的 `REDIS_HOST` 时，API 仍正常启动，`/api/health`、`/api/auth/login`、`/api/auth/me`、`/api/notifications/unread-count` 均返回 **200**，日志明确记录“Redis 暂不可用，当前请求已降级使用数据库”。
- `pnpm smoke:docker-release` PASS：API/Migration/Web 从当前源码重新构建，隔离 PostgreSQL 成功应用 **68/68 migrations**；API 实际生成 auth context 与 notification unread Redis key，修改管理员密码后 auth cache key 被删除；API health、重复初始化保护、Nginx health、`/api` proxy 与 SPA fallback 全绿。
- `CACHE-001` 状态：**VERIFIED**。验证码、流水号、BullMQ、分布式锁、组织同步进度缓存、Redis Cluster/Sentinel、跨实例 SSE Pub/Sub 继续不在本批范围。
