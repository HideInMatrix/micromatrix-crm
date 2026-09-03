# CACHE-001 Redis 平台缓存第一批技术设计

## 1. 设计原则

本批采用 **cache-aside + 主动失效 + Redis 故障降级**。数据库读取路径始终存在，Redis 只减少热点重复查询，不承担业务事实。

```text
request
  -> cache hit --------------------> return
  -> cache miss / Redis unavailable
       -> PostgreSQL/Prisma
       -> best-effort cache write
       -> return
```

Redis 写失败不改变业务返回；数据库写成功后执行 best-effort 失效。安全敏感缓存同时使用短 TTL 和显式失效，形成双保险。

## 2. RedisModule / RedisService

新增全局 `RedisModule`，对业务层只导出 `RedisService`。首批只暴露当前确实需要的最小命令面：

- `get` / `getJson`
- `setJson(key, value, ttlSeconds)`
- `increment(key, ttlSeconds)`
- `delete(...keys)`

统一 key prefix：

```text
micromatrix-crm:<logical-key>
```

连接策略：

- 未配置 Redis：客户端不创建，所有缓存调用返回 miss/no-op。
- 已配置但暂时不可用：关闭 offline queue，单请求最多有限重试，连接超时 1.5s；错误日志 30s 节流。
- 应用关闭：优先 `QUIT`，异常时断开连接。

这样可避免 Redis 故障把 API 请求无限挂起，也不会出现业务模块各自维护连接池。

## 3. 认证上下文缓存

### 3.1 缓存对象

```ts
interface CachedAuthContext {
  authVersion: number
  user: AuthUser
}
```

key：

```text
auth:context:<userId>
```

TTL：60 秒。

### 3.2 Guard 顺序

JWT：

1. 验证签名和 exp。
2. 从 payload 取得 `sub/authVersion`。
3. 读取用户认证上下文缓存。
4. 命中时仍比较 JWT `authVersion` 与缓存 `authVersion`。
5. miss 时由 Prisma 读取活动用户及全部角色，执行原有状态/authVersion 校验，再缓存 `toAuthUser()` 结果。
6. 继续执行 `@RequirePermissions` / `@RequireAnyPermissions`。

API Key：API Key 本身继续每请求查询数据库并执行 enabled/expire/constant-time secret 校验；只有确定 `userId` 后的角色上下文允许命中缓存。因此本批不会缓存 API Secret 或放宽 API Key 吊销实时性。

### 3.3 主动失效矩阵

| 写路径 | 失效对象 |
| --- | --- |
| `AuthService.changePassword` | 当前用户 |
| 成员 update/toggleStatus/resetPassword/remove | 目标用户 |
| 角色 update/remove | 当前关联该角色的全部用户 |
| 角色 addMembers/removeMember | 被变更成员 |
| 个人中心资料 update | 当前用户 |
| 企微工作台资料回写 | 当前用户 |
| 企微组织同步 apply | 本批实际应用的成员 |

若后续出现新的 `User/UserRole/Role` 权限相关写入口，必须同步进入该矩阵；不能把 60 秒 TTL 当作安全敏感变更的唯一失效机制。

## 4. 通知缓存

### 4.1 版本化 key

版本 key：

```text
notifications:version:<tenantId>:<userId>
```

分页 key：

```text
notifications:list:<tenantId>:<userId>:v<version>:<page>:<pageSize>:<unreadOnly>
```

未读数 key：

```text
notifications:unread:<tenantId>:<userId>:v<version>
```

分页和未读缓存 TTL 30 秒；版本 key TTL 5 分钟。版本 TTL 明显长于数据缓存 TTL，所以版本自然过期回到 `v0` 时，旧版本数据 key 已经先自然过期，不会重新命中过时内容。

### 4.2 失效方式

通知创建、`markRead`、`markAllRead` 后只执行一次版本 `INCR + EXPIRE`。不删除旧分页 key，也不扫描 keyspace；旧 key 最多在 30 秒后自然回收，但由于版本已改变，不再被请求读取。

该设计可覆盖顶部通知铃铛、首页近期通知和通知中心不同分页参数，而不需要预先枚举前端固定 pageSize。

## 5. Compose 设计

开发与 release Compose 均增加：

```text
redis:7-alpine
  requirepass ${REDIS_PASSWORD}
  appendonly yes
  internal compose network only
  healthcheck: authenticated PING
```

API 注入：

```text
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=<env>
REDIS_DB=0
```

启动依赖：

```text
postgres healthy -> migrate -> api -> web
redis -----------------------> api cache（可晚于 API 就绪）
```

Migration 与 Redis 没有依赖关系，API 也不把 Redis health 作为启动门槛。Redis service 仍保留 healthcheck 供 Compose/运维观测；API 在 Redis 未就绪时先按 cache miss 直接访问 PostgreSQL，`ioredis` 后台恢复连接后自动重新启用缓存。因此 Redis 冷启动/运行时故障均不会阻断数据库 schema 部署或核心 API。

## 6. 测试策略

1. `AuthContextCacheService` 单测：JSON round-trip、精确删除、批量去重失效。
2. `NotificationsService` 单测：第二次 list/unread 命中缓存；markRead 后版本变化并重新查询 Prisma。
3. API typecheck / Rules：覆盖 Nest 注入和现有业务回归。
4. 真实 Redis Compose：认证 health、SET/TTL/INCR/GET，并从 API `ioredis` 客户端执行真实读写。
5. Compose config 静态检查：无 Redis published port，API 只硬依赖 migration 完成、不硬依赖 Redis health，migrate 仅依赖 PostgreSQL。

## 7. 后续扩展边界

`RedisService` 只是一层平台基础设施，不意味着后续所有状态都应放 Redis。验证码、锁、序列号、BullMQ、跨实例 SSE 都有不同的一致性/原子性/恢复需求，必须分别给出需求和失败语义后再扩展命令面。
