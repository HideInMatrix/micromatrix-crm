# COORD-001 Redis 组织同步与 Cron 分布式协调设计

## 1. 架构原则

Redis 在本单元承担“低成本前置协调”，数据库继续承担“最终一致性”。

```text
Organization sync request
  -> Redis lease (fast reject duplicate)
  -> existing DB active-batch unique / status machine
  -> existing PostgreSQL advisory lock during apply
  -> commit

Cron trigger on API-A/B/C
  -> Redis slot claim
     -> only one executes
  -> Redis unavailable only
     -> PostgreSQL pg_try_advisory_xact_lock fallback
```

## 2. RedisService coordination 原语

新增：

```ts
type RedisAcquireResult =
  | { status: 'ACQUIRED'; token: string }
  | { status: 'BUSY' }
  | { status: 'UNAVAILABLE' }

acquireLease(key, ttlMs)
renewLease(key, token, ttlMs)
releaseLease(key, token)
claimOnce(key, ttlMs)
coordinationSnapshot()
```

`acquireLease` 使用随机 UUID value：

```text
SET <key> <token> PX <ttlMs> NX
```

续租 Lua：

```text
if GET key == token then PEXPIRE key ttl end
```

释放 Lua：

```text
if GET key == token then DEL key end
```

这样旧 owner 即使超时后恢复，也不能删除新 owner 的 lease。

## 3. DistributedCoordinatorService

CommonModule 导出 `DistributedCoordinatorService`，负责两类上层语义。

### 3.1 `runExclusive`

用于组织同步：

- acquire Redis lease。
- ACQUIRED：启动 renew timer，执行 callback，finally 安全释放。
- BUSY：返回 skipped/busy，由组织同步映射为 ConflictException。
- UNAVAILABLE：按调用方声明 `fallback: RUN_UNCOORDINATED` 继续执行，依赖已有数据库最终保护。

续租周期默认 TTL / 3，timer 使用 `unref()`，shutdown/任务结束时清理。

### 3.2 `runScheduledOnce`

用于 `@Cron`：

- key = `coord:cron:<job>:<slot>`。
- Redis `claimOnce` ACQUIRED：执行 callback，marker 不删除。
- BUSY：skip。
- UNAVAILABLE：进入 PostgreSQL advisory fallback。

PostgreSQL fallback 使用独立 interactive transaction 持有：

```sql
SELECT pg_try_advisory_xact_lock(hashtextextended(<slotKey>, 0)) AS locked
```

拿到锁后才调用 callback，callback 完成后 transaction 结束释放锁。该长事务只在 Redis outage 时存在，正常运行不消耗 PostgreSQL 锁协调成本。

## 4. Cron slot 与 TTL

- DAILY：`YYYY-MM-DD`（UTC），TTL 36h。
- MINUTE：`YYYY-MM-DDTHH:mm`（UTC），TTL 10min。

任务映射：

| job | slot |
| --- | --- |
| pool-recycle | DAILY |
| opportunity-auto-close | DAILY |
| bidding-fetch | DAILY |
| message-expiry | DAILY |
| follow-plan-reminder | DAILY |
| message-delivery | MINUTE |

`@Cron` 方法只改为：

```ts
await coordinator.runScheduledOnce('pool-recycle', 'DAILY', () => this.recycleAllCore())
```

或者保持公共业务方法原样，只让 scheduled wrapper 调用 coordinator 后执行原方法，避免手工/测试入口被 claim。

## 5. 组织同步 runtime status

Redis lease key：

```text
coord:lease:organization-sync:WECOM:<tenantId>
```

status 不使用固定 key 覆盖，而按 lease token 分片：

```text
coord:organization-sync:status:<tenantId>:<token>
```

内容：

```json
{
  "phase": "FETCHING | APPLYING",
  "operatorId": "...",
  "batchId": "... | null",
  "startedAt": "ISO8601"
}
```

TTL 1h。读取时先读取 lease token，再读取对应 status；lease 已释放时旧 status 自动失去可达性，即使 TTL 尚未过期也不会误报运行中。

`createPreview`：

1. 基础配置/目标部门校验。
2. acquire shared sync lease。
3. status=FETCHING, batchId=null。
4. 创建 FETCHING batch 后更新 status.batchId。
5. 获取企微 snapshot / 生成 preview。
6. finally release。

`apply`：

1. 读取并校验 batch。
2. acquire 同一 shared sync lease。
3. status=APPLYING, batchId。
4. 进入原有 transaction + PostgreSQL advisory lock。
5. finally release。

Redis unavailable 时跳过上述 runtime status，但数据库批次状态仍完整保留。

## 6. `gate()` 优化

- Redis lease + status 可用且有 batchId：按 id 读取 batch 一次，并把它同时作为 `activeBatch/latestBatch`；避免原有 active/latest 两次查询。
- Redis status 可用但 batchId 尚未写入：只用 phase 生成 disabledReason，latest 仍从 DB 查询。
- Redis 不可用、lease/status 缺失或状态不合法：完整回退现有 PostgreSQL active/latest 查询。

Redis runtime status 只优化运行态查询，不替代数据库历史批次。

## 7. 测试

- Fake Redis 原语：token-safe release/renew、busy/unavailable。
- Coordinator：exclusive renew、slot claim、PG fallback。
- OrganizationSync：busy short-circuit、unavailable DB fallback、status gate。
- 6 个 Cron scheduled wrapper：相同 slot 第二实例 skip；业务 core 方法仍可直接调用。
- Real Redis Smoke：两个 `RedisService` 同 key 竞争、续租、安全释放、slot claim。
- Full Rules + API typecheck + diff check。
