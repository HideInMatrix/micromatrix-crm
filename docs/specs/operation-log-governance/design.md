# LOG-001 操作日志与运行日志治理设计

## 1. 现状

当前生产流量由 `web` 容器中的 Nginx 反向代理到内部 `api:3000`。Nginx 已设置 `X-Real-IP $remote_addr` 与 `X-Forwarded-For $proxy_add_x_forwarded_for`，但 API bootstrap 没有配置 Express `trust proxy`，因此 `request.ip` / Nest `@Ip()` 默认读取到 Nginx 容器的 socket peer 地址，操作日志容易出现 `172.x` Docker bridge IP。

`OperationLog` 当前只有 `(tenantId, createdAt)` 与 `(tenantId, module)` 索引，没有过期清理任务。租户列表查询适合现有复合索引，但全局按时间淘汰缺少以 `createdAt` 为首列的索引。

项目已有 `DistributedCoordinatorService`：DAILY/MINUTE Scheduler 正常路径使用 Redis `claimOnce`，Redis unavailable 时回退 PostgreSQL `pg_try_advisory_xact_lock`。日志清理直接复用该基座。

## 2. 客户端 IP 链路

生产链路固定为：

```text
Browser / Client
      |
      v
web (Nginx :80)
  X-Real-IP = $remote_addr
  X-Forwarded-For = $proxy_add_x_forwarded_for
      |
      v
api (:3000, internal only)
  trust proxy hops = 1
      |
      +--> request.ip / @Ip()
```

API 新增 `TRUST_PROXY_HOPS`：

- 未配置或 `0`：Express `trust proxy=false`，用于宿主机本地开发与直接访问。
- 正整数 N：Express 只信任距离应用 N hop 内的代理地址。
- 生产 Compose 默认 `TRUST_PROXY_HOPS=1`。
- 非整数、负数或大于 10 的值直接抛出配置错误，避免意外信任全部转发头。

业务层不解析 forwarding header。这样即使客户端自行提交 `X-Forwarded-For: fake-ip`，单 Nginx 拓扑下 Express 仍选择 Nginx 追加的最右侧真实客户端地址，而不是更左侧的不可信值。

`normalizeClientIp()` 只做表示规范化：

```text
::ffff:192.168.1.10 -> 192.168.1.10
203.0.113.10        -> 203.0.113.10
2001:db8::10        -> 2001:db8::10
```

密码登录、企微登录与 OperationLog interceptor 全部使用该函数。

## 3. OperationLog 生命周期

配置：

| 环境变量                            | 默认值 | 语义                          |
| ----------------------------------- | -----: | ----------------------------- |
| `OPERATION_LOG_RETENTION_DAYS`      |    180 | 保留最近 N 天操作日志         |
| `OPERATION_LOG_CLEANUP_BATCH_SIZE`  |   1000 | 每批最多删除记录数            |
| `OPERATION_LOG_CLEANUP_MAX_BATCHES` |     20 | 每次 Scheduler 最多执行批次数 |

每天 Cron 进入 `scheduledCleanup()`，再调用：

```text
runScheduledOnce('operation-log-cleanup', 'DAILY')
    |
    v
cleanup(now)
    |
    +--> cutoff = now - retentionDays
    +--> findMany(createdAt < cutoff, orderBy createdAt/id, take batchSize, select id)
    +--> deleteMany(id in batch)
    +--> 重复，直到本批不足 batchSize 或达到 maxBatches
```

先选 ID 再删除的原因是 Prisma `deleteMany` 没有通用 `LIMIT` 语义。直接按 `createdAt` 无界删除会在历史积压时形成大事务；每批 ID 上限使锁时间、WAL 和 vacuum 压力可控。

数据库 migration 只增加 `operation_logs(createdAt)` 独立索引。既有 `(tenantId, createdAt)` 保留，继续服务租户日志列表；独立时间索引服务跨租户 retention 扫描。

## 4. Scheduler 与故障语义

- Cron 每天低峰触发；真正“同一天仅一次”由现有 UTC DAILY slot 保证。
- Redis 正常：首个实例 claim 成功后执行，其余实例跳过。
- Redis unavailable：沿用 `DistributedCoordinatorService` PostgreSQL advisory transaction fallback。
- 清理失败只记录错误，不中断 API。由于 DAILY claim 已消费，本日不做高频自动重试，下一日继续处理。
- 清理 core 保持可直接调用，方便测试与人工维护。

## 5. Docker 日志轮转

根 Compose 为长期服务设置统一 logging anchor：

```yaml
x-default-logging: &default-logging
  driver: json-file
  options:
    max-size: ${DOCKER_LOG_MAX_SIZE:-20m}
    max-file: ${DOCKER_LOG_MAX_FILE:-5}
```

`postgres`、`redis`、`api`、`worker`、`web` 引用该策略；`migrate` 是一次性 job，不强制引用。默认单容器最多保留约 5 个 20 MiB 日志文件，不能把 `20m × 5` 解释为整个项目的硬 100 MiB 总上限。

## 6. 验证

1. IP/config 单测：0/1/非法 hop、IPv4、mapped IPv4、原生 IPv6。
2. cleanup 单测：cutoff、批次循环、最大批次、协调 job/slot。
3. Prisma generate / migration 静态检查。
4. `docker compose config --quiet` 并检查展开的 `logging`、`TRUST_PROXY_HOPS`。
5. `pnpm lint`、`pnpm typecheck`、相关 Rules、`git diff --check`。
