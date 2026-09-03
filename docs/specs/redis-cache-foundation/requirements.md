# CACHE-001 Redis 平台缓存第一批需求

## 1. 目标

在不改变 PostgreSQL 业务真相源、不引入 Redis 强依赖的前提下，把项目长期处于“已在技术栈中声明但未真正进入运行时”的 Redis 收口为可复用平台能力，并优先覆盖当前最明确的两个高频读取热点：认证上下文与站内通知。

本执行单元是 W3.7 完成后的独立工程化单元，编号固定为 `CACHE-001`，不预设 W3.8 或后续业务 Wave 编号。后续验证码、组织同步状态、流水号、BullMQ 等能力是否接入 Redis，必须另行立项，不能在本批顺带扩张。

## 2. 范围

### R1 Redis 公共运行基座

- API 必须通过统一 `RedisService` 访问 Redis，业务 Service 不直接创建独立客户端。
- 支持 `REDIS_URL`，同时保留 `REDIS_HOST/REDIS_PORT/REDIS_PASSWORD/REDIS_DB` 组合配置。
- 所有项目 key 使用统一前缀，避免同一 Redis 实例中与其它应用冲突。
- Redis 未配置、连接失败、命令失败或缓存内容损坏时，读取必须自动回退 PostgreSQL；Redis 不能成为登录、权限校验、通知读取的业务单点。
- 客户端需要有限连接/命令超时和错误日志节流，应用退出时正常释放连接。

### R2 部署与安全边界

- 开发与 release Compose 均提供 `redis:7-alpine` 服务，并启用密码认证、持久化 volume 与 healthcheck。
- Redis 默认只存在于 Compose 内部网络，不发布宿主机端口。
- API 通过内部 service name 连接 Redis；生产密码来自环境变量，不写入镜像和仓库真实配置。
- Redis healthcheck 用于运维可观测与容器状态判断，但不得成为 API 冷启动的硬依赖；Redis 未就绪时 API 必须仍可启动并直接走 PostgreSQL，待 Redis 恢复后客户端自动重新连接。
- `migrate` 不依赖 Redis；数据库 migration 仍只依赖 PostgreSQL。

### R3 AuthGuard 认证上下文缓存

- JWT/API Key 凭证本身的密码学验证、过期判断和 API Key 查询逻辑保持原语义；本批只缓存凭证确定用户后的“活动用户 + 角色 + 权限 + 数据范围”上下文。
- 缓存按用户 ID 隔离，必须同时保存 `authVersion`，JWT 请求命中缓存后仍需校验 token `authVersion`。
- TTL 必须短，第一批固定 60 秒，降低漏失效时的风险窗口。
- 用户状态、角色关系、角色权限/数据范围、个人资料中影响请求上下文的字段、企微资料回写和组织同步发生变化时必须主动失效相关用户缓存。
- 禁用用户、角色权限撤销等安全敏感变更不能仅依赖 TTL 等待自然过期。

### R4 通知读取缓存

- `/notifications/unread-count` 缓存未读数量。
- `/notifications` 按 `tenantId + userId + page + pageSize + unreadOnly` 参数缓存分页结果，不把不同租户或用户混入同一 key。
- 第一批 TTL 固定 30 秒，只优化高频短时重复读取，不把通知列表变成长期缓存。
- 新通知、单条已读、全部已读必须主动使该用户旧通知缓存失效。
- 失效采用“用户通知版本号 + 参数化 key”，禁止为失效执行 Redis `KEYS/SCAN` 全局扫描。
- Redis 不可用时继续直接查询 Prisma，SSE 推送与通知落库语义不得改变。

### R5 一致性与安全约束

- PostgreSQL 始终是认证资料、角色权限和通知记录的唯一业务真相源；Redis 只保存可丢弃派生缓存。
- 缓存 key 必须显式包含用户边界；通知 key 额外包含租户边界。
- 缓存写入失败不能回滚已经成功的数据库事务。
- 不在 Redis 中保存密码、JWT、API Secret、企业集成 Secret、OAuth state 原文等敏感凭证。
- 不在本批引入分布式锁、Session、验证码、流水号、队列或跨实例 SSE Pub/Sub。

### R6 验收

- API typecheck、相关单元测试、全量 Rules 与 `git diff --check` 必须通过。
- 单测必须证明认证上下文缓存可精确失效，以及通知第二次读取不会重复访问 Prisma、写操作后会重新访问数据库并回填缓存。
- 使用真实 Redis 容器验证密码认证、healthcheck、TTL、`INCR` 及 API 客户端读写。
- `docker compose config` 必须证明 Redis 未发布宿主端口、API 不以 Redis healthy 作为启动硬门槛，Migration 不依赖 Redis。
- 最终更新架构、项目进度、部署文档和本任务清单后才能关闭 `CACHE-001`。

## 3. 本批明确不做

- BullMQ / 异步导出中心。
- 验证码、登录失败锁定、Session、refresh token 黑名单。
- 业务流水号/分布式 ID。
- 组织同步进度缓存或分布式锁。
- Redis Cluster/Sentinel、云厂商专属配置。
- SSE 跨 API 实例 Pub/Sub；多副本实时推送需在后续独立设计。
