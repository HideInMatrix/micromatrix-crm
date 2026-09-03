# COORD-001 Redis 组织同步与 Cron 分布式协调需求

## 1. 背景与目标

CACHE-001/CACHE-002 已将 Redis 用于派生缓存，EVENT-001 已将 Redis 用于非持久实时事件总线。当前剩余一个明显的多实例缺口：组织同步虽然有数据库唯一约束和 PostgreSQL advisory lock 兜底，但并发请求仍可能先进入数据库或企业微信 API；6 个 `@Cron` 在 API 扩为多实例后也会由每个实例同时触发。

CordysCRM 的 `ThirdDepartmentService` 使用 Redisson `RLock` 避免同组织并发同步，并使用 `org_sync_status:*` Redis TTL 状态标记同步中。本单元迁移这一协调语义，同时补齐 NestJS Scheduler 的多实例执行协调。

## 2. 功能需求

### R1 Redis coordination 原语

- Redis 访问继续统一收口在平台层，业务模块不得自行创建 Redis client。
- 提供带随机 ownership token 的 lease：`SET NX PX` 获取、compare-and-PEXPIRE 续租、compare-and-DEL 安全释放。
- lease 必须支持自动续租，避免长任务超过初始 TTL 后另一实例误获得同一锁。
- 提供“时间槽 claim”：同一个 job + slot 只允许一个实例 claim 成功，claim 在任务完成后不主动删除，避免第二实例因稍晚进入而重复执行。
- 所有 coordination key 使用 MicroMatrix 专属 Redis key prefix；不得使用 `KEYS/SCAN`。

### R2 组织同步协调

- 企业微信 `createPreview` 与 `apply` 使用同一租户/provider lease key，确保同租户同一时刻只进入一个同步执行路径。
- Redis lease 必须在访问企业微信组织 API、创建/应用同步批次之前获取；busy 时快速返回 `409 当前正在执行组织同步任务`。
- Redis unavailable 时组织同步不能整体不可用：继续进入现有 PostgreSQL 路径，由 `organization_sync_batches_active_key` partial unique、状态机和 apply 内 PostgreSQL advisory lock 负责最终一致性。
- apply 内现有 `pg_advisory_xact_lock` 不删除、不替换。
- Redis 维护 1 小时 TTL 的运行态摘要（phase、operatorId、batchId、startedAt），状态与 lease token 绑定；lease 不存在时不把残留状态判为“正在同步”。
- `GET /organization-sync/wecom/status` 优先读取 Redis 运行态；有 batchId 时只读取对应 active batch 并复用为 latest，减少常见同步中状态的重复 active/latest 扫描；Redis 状态缺失或异常时回退现有 PostgreSQL 查询。

### R3 Cron 多实例时间槽

当前 6 个 Scheduler 全部纳入协调：

1. `pool-recycle`：每天 02:30。
2. `opportunity-auto-close`：每天 03:00。
3. `bidding-fetch`：每天 08:00。
4. `message-expiry`：每天 08:00。
5. `follow-plan-reminder`：每天 09:00。
6. `message-delivery`：每分钟。

- 每日任务按当前触发时刻的 UTC date 形成 slot；分钟任务按 UTC minute 形成 slot。
- Redis claim 成功的实例执行真实任务，其他实例立即 skip。
- 每日 slot TTL 至少覆盖下一次日调度，分钟 slot TTL 至少覆盖明显的 scheduler jitter/retry 窗口。
- 只包装 `@Cron` 入口；现有手工执行、测试调用和 service 内部方法不被 Redis claim 阻断。

### R4 Redis 故障时 Cron fallback

- Redis coordination unavailable 时不得让所有 API 实例无条件同时执行 Cron。
- 仅在 Redis unavailable 时使用 PostgreSQL `pg_try_advisory_xact_lock(hashtextextended(slotKey, 0))` 作为 fallback；拿不到锁的实例立即 skip。
- fallback advisory lock 覆盖实际 job callback 生命周期；正常 Redis 路径不产生这笔数据库协调事务。
- 业务层原有幂等/CAS/唯一约束必须继续保留：FollowUpPlan `dueNotifiedAt` claim、MessageDelivery `SENDING` claim、公海 repository 事务保护、Bidding unique key 等不能因协调层存在而删除。
- PostgreSQL fallback 是 Redis outage 下的降级协调，不改变 PostgreSQL 作为最终业务真相源的定位。

### R5 可观测与失败语义

- `/health` 增加 coordination 指标：lease acquire/busy/unavailable/renewFailure、slot claim/busy、postgresFallback/acquired/skipped。
- 日志只记录 coordination key 的逻辑任务名/租户，不输出 Redis URL/password/token。
- lease 续租失败时记录 warning；已经开始的业务任务不做不安全的强制中断，最终一致性继续依赖数据库状态机/约束。
- Redis 锁本身不被视为最终业务锁，不允许删除现有数据库唯一约束、条件更新或 PostgreSQL advisory lock。

## 3. 验收要求

- 单元测试：两个 coordinator 实例并发争抢同 lease，只有一个进入；释放时错误 token 不能删除他人 lease。
- 单元测试：lease 自动续租后长任务期间第二实例仍然 busy。
- 单元测试：同 Cron slot 两实例只有一个执行；不同 minute/day slot 可再次执行。
- 单元测试：Redis unavailable 时 PostgreSQL advisory fallback 同时调用只有一个执行。
- 组织同步测试：Redis busy 在访问企业微信/DB apply 前返回冲突；Redis unavailable 仍进入现有数据库兜底路径。
- 真实 Redis Smoke：SET NX lease、续租、安全释放、slot claim 全部通过。
- API typecheck、完整 Rules、`git diff --check` 必须通过。
- 文档与项目指针同步后才能标记 `COORD-001 VERIFIED`。

## 4. 非本批范围

- 不引入 Redlock 多 Redis quorum；当前 release 架构仍为单 Redis primary。
- 不引入 BullMQ/异步任务中心。
- 不重构各 Cron 业务算法或其数据库幂等语义。
- 不把客户池/线索池资源领取的 PostgreSQL advisory lock 改成 Redis lock。
- 不处理业务流水号、验证码、Session。
