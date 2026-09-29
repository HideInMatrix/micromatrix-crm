# Infrastructure Runtime 需求

## 1. 定位

Infrastructure Runtime 统一描述 Redis、缓存、实时事件、分布式协调和 BullMQ 异步任务。PostgreSQL 始终是业务真相源；Redis 只承载可丢弃派生缓存、实时信号、协调租约和队列 delivery metadata。

## 2. Redis 基座

- API 业务代码只通过统一 RedisService/平台服务访问 Redis，不自行创建客户端。
- 支持 URL 或 host/port/password/db 配置，所有 key 使用项目统一前缀。
- Redis 未配置、连接失败或缓存内容损坏时，普通 CRM 读取必须 fail-open 回 PostgreSQL。
- Redis 不保存密码、JWT、API Secret、企业 Secret 或 OAuth state 原文。
- 应用退出时正常释放连接；错误日志必须节流，避免 Redis 故障产生日志风暴。

## 3. Auth / Notification Cache

- AuthContext 是短 TTL 派生缓存，必须保存 authVersion；权限、角色、状态、改密等安全敏感写入主动失效。
- Notification 未读数和列表按 tenant+user+参数缓存；写入/已读变更通过用户版本号失效，不扫描 keyspace。
- 缓存写失败不得回滚已经成功的数据库事务。

## 4. 租户读模型缓存

当前可缓存：

- ModuleConfig / TopNavigation。
- MessageSettings / channel gate。
- Enterprise UI branding。
- ModuleForm/Field metadata（事务外）。
- Department tree / ACTIVE member options。
- Home Lead/Customer analytics。

低频配置和目录使用 namespace version 主动失效；首页统计使用短 TTL 自然收敛。缓存 key 必须包含 tenant 和所有影响 DataScope/结果的上下文摘要。

## 5. Pub/Sub + SSE

- Notification 先落 PostgreSQL，再通过 Redis Pub/Sub 广播实时信号。
- SSE 只负责通知在线客户端刷新，不承担 durable message storage。
- Redis/PubSub 中断时通知数据仍在 PostgreSQL；客户端下一次主动读取必须恢复正确状态。
- 多实例只广播轻量事件，不把完整业务数据复制进 Redis channel。

## 6. Distributed Coordination

`DistributedCoordinatorService` 提供：

- `runExclusive`：用于组织同步等长任务；Redis lease 正常时执行 token-safe acquire/renew/release。
- `runScheduledOnce`：用于 Cron 时间槽 claim；Redis unavailable 时回退 PostgreSQL advisory transaction lock。

当前协调的 Cron 包括：`pool-recycle`、`operation-log-cleanup`、`lead-sla-reminder`、`follow-plan-reminder`、`announcement-publish`、`resource-field-attachment-cleanup`、`message-delivery`。

Redis 协调层只能减少重复进入；业务自身 CAS、唯一约束、状态字段和 transaction 仍必须保留。

## 7. BullMQ Export

- 异步导出 Queue job 只携带 `{ taskId }`。
- ExportTask 的 module、payload、status、attempts、startedAt、file metadata 等持久化在 PostgreSQL。
- API enqueue 失败必须 fail-closed 并撤销新建 PENDING task，不返回伪成功。
- worker 使用同一 API 镜像的 `dist/worker.js`，不启动 HTTP/Cron，并与 API 共享 uploads volume。
- worker 每次执行重新加载当前用户/角色和资源权限，不信任提交时缓存权限快照。
- 当前导出 module key 只允许 `customer / customer_pool / contact / lead / lead_pool / customFormData`。
- transient error 有限重试；确定性 4xx/权限/数据错误直接 FAILED。
- worker 重启后依据 PostgreSQL PENDING task 恢复缺失 job。

## 8. Cancel / Recovery

- 取消任务先把 DB PENDING 改为 CANCELED，再 best-effort 移除 waiting/delayed job。
- active job 不强杀；processor 在生成前后和 SUCCESS CAS 前检查 DB 状态。
- 若任务已取消，刚生成文件必须删除，不能覆盖回 SUCCESS。
- 24h 到期和文件清理以 PostgreSQL task 为准，不依赖 BullMQ job metadata。

## 9. 观测与部署

- `/health` 只暴露 Redis enabled/ready、缓存命中/回退计数和 async job 指标，不暴露连接 Secret 或业务数据。
- 生产 Redis 不发布宿主端口；Migration 不依赖 Redis。
- API 不把 Redis healthy 作为核心启动门槛；worker 因队列语义可以依赖 Redis healthy。
- release smoke 必须真实验证 API、Redis、worker、异步任务和 `dist/worker.js` 入口。

## 10. 验收

- 真实 Redis/PostgreSQL 测试覆盖 fail-open、版本失效、Pub/Sub、lease、slot claim、PG fallback、enqueue/retry/cancel/recovery。
- 多实例协调测试必须证明同一 slot/job 不重复执行。
- 基础设施改动必须通过 Rules、API/worker build、Compose config 和 `git diff --check`。
