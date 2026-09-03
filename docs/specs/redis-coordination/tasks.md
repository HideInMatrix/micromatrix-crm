# COORD-001 Redis 组织同步与 Cron 分布式协调任务

- [x] K1 现场审计与规格冻结
  - 审计 Cordys `ThirdDepartmentService` 的 Redisson lock / Redis sync status。
  - 审计 MicroMatrix OrganizationSync partial unique、apply PostgreSQL advisory lock 与状态机。
  - 枚举 6 个 `@Cron` 并确认现有业务幂等边界。
  - 冻结 Redis 前置协调 + PostgreSQL 最终兜底原则。

- [x] K2 Redis coordination 原语
  - token lease acquire / renew / safe release。
  - slot claimOnce。
  - coordination metrics。

- [x] K3 DistributedCoordinatorService
  - runExclusive + 自动续租。
  - runScheduledOnce + UTC daily/minute slot。
  - Redis unavailable PostgreSQL advisory fallback。

- [x] K4 OrganizationSync 协调
  - preview/apply 共用 tenant/provider lease。
  - Redis runtime status + gate 优先读取。
  - Redis busy fast conflict；unavailable 继续 DB fallback。
  - 保留 apply `pg_advisory_xact_lock` 与 active-batch partial unique。

- [x] K5 六个 Cron 多实例协调
  - pool-recycle。
  - opportunity-auto-close。
  - bidding-fetch。
  - message-expiry。
  - follow-plan-reminder。
  - message-delivery。

- [x] K6 验收
  - coordinator / organization sync / Cron 专项测试。
  - 真实 Redis lease/renew/release/slot smoke。
  - API typecheck、完整 Rules、`git diff --check`。

- [x] K7 文档封板
  - architecture / project-progress / specs index / alignment-log。
  - 记录 Redis outage fallback 与保留的 DB 最终保护。
  - K2～K6 全绿后标记 `COORD-001 VERIFIED`。

## 最终验收

- Redis 平台层已提供 token lease acquire / compare-and-PEXPIRE renew / compare-and-DEL safe release 与不可释放的时间槽 `claimOnce`；错误 token 无法删除现 owner 的 lease，所有 key 继续经过 MicroMatrix `keyPrefix`，没有引入 `KEYS/SCAN`。
- `DistributedCoordinatorService` 已统一两类语义：组织同步使用自动续租 `runExclusive`；Scheduler 使用 UTC DAILY/MINUTE `runScheduledOnce`。Redis unavailable 时只有 Scheduler 进入 PostgreSQL `pg_try_advisory_xact_lock` fallback，组织同步则继续原数据库状态机/唯一约束路径。
- 自动续租专项真实跨过 1 秒初始 TTL：长任务期间至少发生 2 次 renew，第二实例在 1200ms 后仍为 BUSY；同 minute slot 只执行一次，下一个 minute slot 可再次执行。
- OrganizationSync preview/apply 共用 `organization-sync:WECOM:<tenantId>` lease；Redis runtime status 与 lease token 绑定，lease 消失后残留 status 不再可见。busy 在企微/数据库核心路径前快速 409；Redis unavailable 仍进入原 createPreview core。`gate()` 在 runtime 带 active batchId 时只读取该批次一次并复用 latest。
- 现有数据库最终保护保持不变：`organization_sync_batches_active_key` partial unique 仍存在，apply transaction 中 PostgreSQL `pg_advisory_xact_lock` 仍存在；客户池/线索池资源锁也未迁移到 Redis。
- 6 个 `@Cron` 已全部只在 scheduled wrapper 接入时间槽协调：pool-recycle、opportunity-auto-close、bidding-fetch、message-expiry、follow-plan-reminder 使用 DAILY，message-delivery 使用 MINUTE；原 core 方法继续可供手工/测试直接调用，业务 CAS/unique/transaction 保护保留。
- 真实 `redis:7-alpine` Smoke PASS：双 `RedisService` mutual exclusion、wrong-token safe release、renew、correct release、reacquire、slot claim 全部通过；`renewFailures=0`，测试容器已清理。
- 最终验证：API typecheck PASS；完整 Rules **162/162 PASS**；`git diff --check` PASS。COORD-001 未修改数据库 migration 或 Compose 拓扑，因此不重复执行完整 Docker 三镜像 release Smoke。

当前状态：**VERIFIED**。
