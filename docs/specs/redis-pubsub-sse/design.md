# EVENT-001 Redis Pub/Sub 与多实例 SSE 技术设计

## 1. 总体链路

```text
Business service
  -> NotificationsService.notify()
  -> PostgreSQL INSERT notification
  -> bump notification cache version
  -> Redis PUBLISH notification-realtime
        -> API-A subscriber -> local SSE subjects of target user
        -> API-B subscriber -> local SSE subjects of target user
        -> API-C subscriber -> no local client, no-op
```

Redis Pub/Sub 只承载“实时发生了什么”。通知列表、未读数与已读状态继续由 PostgreSQL + CACHE-001 cache-aside 提供。

## 2. RedisService Pub/Sub 扩展

现有 `RedisService` 保留 command client。EVENT-001 增加内部专用 subscriber client，并暴露最小字符串协议：

- `publish(channel, payload): Promise<number | null>`
- `subscribe(channel, handler): Promise<unsubscribe>`
- `pubSubReady`
- Pub/Sub metrics snapshot

channel 统一通过平台前缀转换为：

```text
micromatrix-crm:event:<channel>
```

`keyPrefix` 只用于 Redis key，不依赖它隐式处理 Pub/Sub channel。

subscriber client 只在首次注册 handler 时创建。handler 先登记在内存；Redis 尚未 ready 时不发送 SUBSCRIBE，`ready` 后自动订阅全部登记 channel。ioredis reconnect 后再次执行幂等订阅，确保 Redis 晚启动/重启后恢复。

## 3. 通知事件协议

内部 payload：

```ts
type NotificationRealtimeEvent =
  | {
      version: 1
      eventId: string
      sourceInstanceId: string
      type: 'CREATED'
      tenantId: string
      userId: string
      occurredAt: string
      notification: NotificationVO
    }
  | {
      version: 1
      eventId: string
      sourceInstanceId: string
      type: 'STATE_CHANGED'
      tenantId: string
      userId: string
      occurredAt: string
    }
```

- `CREATED.eventId` 直接使用 notification id，天然稳定。
- `STATE_CHANGED.eventId` 使用随机 UUID，避免不同 read 操作被误合并。
- Redis payload 只包含前端本来就可读取的 `NotificationVO` 或用户通知刷新信号。

## 4. NotificationsService 生命周期

`NotificationsService` 实现 module init/destroy：

1. init 时向 `RedisService.subscribe()` 注册通知 channel handler。
2. handler 解析并校验事件。
3. `CREATED` -> `pushCreatedLocal(userId, notification)`。
4. `STATE_CHANGED` -> `pushRefreshLocal(userId)`。
5. destroy 时移除 handler。

业务写路径：

```text
notifyUnchecked
  DB create
  bump cache version
  pushCreatedLocal
  publish CREATED best-effort
    subscriber on source instance -> sourceInstanceId 相同，忽略
    subscriber on other instances -> pushCreatedLocal
```

```text
markRead / markAllRead
  DB update
  bump cache version
  pushRefreshLocal
  publish STATE_CHANGED best-effort
    subscriber on source instance -> sourceInstanceId 相同，忽略
    subscriber on other instances -> pushRefreshLocal
```

来源实例始终本地直推，保证 Redis subscriber 尚未 ready 的启动窗口也不会漏掉本机 SSE；跨实例只依赖 Redis。`sourceInstanceId` 明确阻止来源实例处理自己的 Pub/Sub 回环消息，因此不会产生“本地一次 + 回环再一次”的重复。

## 5. 本地短窗口去重

每个 API 实例维护有上限的最近 `eventId` 集合，只作用于 realtime transport，不进入数据库：

- 收到合法 Redis event 时先判断 eventId。
- 重复 eventId 直接 drop。
- 使用时间窗口/数量上限清理，避免无界增长。

它只用于处理 publish 返回异常、Redis reconnect 边缘行为或重复消息，不承担业务幂等。

## 6. SSE 事件

现有新通知协议不破坏：

```text
message
  data = NotificationVO
```

新增：

```text
refresh
  data = { reason: 'notifications-changed' }

heartbeat
  data = { time: ISO8601 }
```

后端 `subscribe()` 继续为每个用户维护多 `Subject`，并 merge 15 秒 `interval` heartbeat。前端 `NotificationBell` 保留 `onmessage` 新通知逻辑，只增加 `refresh` listener 调用现有 `refresh()`。

## 7. 故障语义

### Redis 启动时不可用

- API 正常启动。
- subscriber handler 已登记。
- publish 返回 null，本实例 SSE 继续工作。
- Redis 恢复后 subscriber 自动订阅，后续事件恢复跨实例传播。

### Redis 运行中断线

- 数据库写入不受影响。
- 缓存继续按 CACHE-001 fail-open。
- realtime 退化为发布实例本地 SSE；其它实例连接可能暂时收不到实时事件，但刷新后从 PostgreSQL 收敛。

### malformed event

- 记录 warning/metric。
- 不向 SSE 发送。
- subscriber 继续消费下一条消息。

## 8. 验证矩阵

1. Fake bus 双实例：A notify -> A/B 本地 SSE 各收到一次。
2. Fake bus 双实例：A markRead -> A/B 都收到 refresh。
3. publish fail：数据库语义不变，本实例仍收到 created/refresh。
4. malformed / unknown version：drop，后续合法消息继续收到。
5. heartbeat：不走默认 message，不触发 Notification toast。
6. 真实 Redis：独立 subscriber + command client 同时执行 GET/SET/PUBLISH/SUBSCRIBE。
7. Redis restart：不重启 API 进程即可重新收到新 publish。
8. API/Web typecheck、Rules、`git diff --check`。
