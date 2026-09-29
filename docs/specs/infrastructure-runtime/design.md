# Infrastructure Runtime 设计

## 1. 总体原则

```text
PostgreSQL = durable truth
Redis Cache = disposable derived state
Redis Pub/Sub = ephemeral realtime signal
Redis Lease = coordination optimization
BullMQ = durable delivery transport backed by Redis
```

业务状态的最终收敛点始终在 PostgreSQL。

## 2. Cache-aside

普通读取路径：cache hit 直接返回；miss/unavailable 读取 PostgreSQL，再 best-effort 写缓存。配置类写入 commit 后 bump namespace version；写缓存/失效失败不改变数据库提交结果。

Auth 缓存额外通过 authVersion 防止旧 JWT 与旧权限上下文组合；Notification 缓存通过 per-user version 避免 `KEYS/SCAN`。

## 3. TenantDerivedCache

统一 key 形状：

`derived:<namespace>:<tenantId>:v<version>:<fingerprint>`。

复杂请求参数、角色和 DataScope 先规范化排序再做稳定摘要。事务内 Metadata 读取绕过 Redis。

## 4. Realtime

Notification/Announcement 等 durable 数据先写数据库；commit 后发布 `STATE_CHANGED` 等轻量事件。各 API 实例把 Pub/Sub 信号转换为本机 SSE 推送。

客户端收到实时事件后重新读取 API，不依赖事件本身携带完整业务快照。

## 5. Redis coordination primitives

`acquireLease` 使用随机 token + `SET NX PX`；renew/release 通过 Lua 校验 token，避免旧 owner 删除新 lease。

`claimOnce` 用于时间槽 marker：

- DAILY slot：UTC date，TTL 约 36h。
- MINUTE slot：UTC minute，TTL 约 10min。

`runScheduledOnce` Redis unavailable 时进入 PostgreSQL `pg_try_advisory_xact_lock` fallback；长事务只发生在 outage 路径。

## 6. Organization Sync runtime status

组织同步 lease 与 status 分开：status key 绑定 lease token。读取时先取当前 lease token，再读取对应 status，旧运行态即使尚未 TTL 过期也不会被误认为仍在执行。

Redis status 只优化 gate/展示，Batch 历史与最终状态始终来自 PostgreSQL。

## 7. BullMQ 分层

```text
API request
  -> ExportTask(PENDING + payload)
  -> Queue add({taskId})

Worker
  -> load ExportTask
  -> load fresh AuthUser
  -> module handler build xlsx
  -> shared uploads
  -> CAS PENDING -> SUCCESS/FAILED
```

`AsyncJobsService` 负责 Queue/Worker 生命周期；`ExportTasksService` 负责 DB task 和文件生命周期；业务 module 只提供 `buildQueuedExport()`，不 import BullMQ。

## 8. Export concurrency

同一用户创建任务时使用 PostgreSQL advisory transaction 串行：最多 10 个 PENDING，同一 user+module 同时最多 1 个 PENDING。DB commit 后才 enqueue；enqueue 失败删除新 task。

worker 默认 attempts=3 + exponential backoff。Business/permission errors 直接 final failed；未知/transient error 由 BullMQ 重试。

## 9. Recovery

worker bootstrap 扫描未过期 PENDING task：

- queue job missing → add；
- waiting/delayed/active → keep；
- completed/failed 但 DB 仍 PENDING → remove stale job 后 re-add。

DB task 与 jobId 共同提供重启恢复，不依赖进程内状态。

## 10. Compose

`redis` 使用 AOF + requirepass + internal network。API 启动只硬依赖 migration；worker 依赖 migration + Redis。API/worker 复用镜像和 `/app/uploads` volume。

## 11. 维护规则

- 不因为已有 Redis 就把任意业务状态迁入 Redis。
- 不用 Pub/Sub 替代 Notification/Inbox/ExportTask 等 durable 表。
- 不用分布式锁替代数据库唯一约束和 CAS。
- 新异步任务如需 BullMQ，必须先定义 DB 真相源、失败语义、幂等、恢复和取消行为。
