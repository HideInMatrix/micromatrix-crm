# EVENT-001 Redis Pub/Sub 与多实例 SSE 任务

- [x] E1 现场审计与规格冻结
  - 对照 Cordys `MessagePublisher / MessageSubscriber / SSEConsumer / SseService`。
  - 审计 MicroMatrix `NotificationsService` 内存 Subject 与 `NotificationBell` EventSource 协议。
  - 冻结 PostgreSQL 为通知真相源，Redis Pub/Sub 只做非持久实时事件总线。

- [x] E2 Redis Pub/Sub 平台能力
  - 扩展 `RedisService` 的 publish/subscribe 专用能力。
  - subscriber 独立连接、channel 前缀、reconnect/resubscribe。
  - Pub/Sub readiness 与 transport metrics。

- [x] E3 Notifications 多实例事件协议
  - CREATED / STATE_CHANGED 内部 envelope。
  - module init/destroy subscriber 生命周期。
  - 本地 eventId 短窗口去重与 malformed event gate。

- [x] E4 SSE 实时行为
  - CREATED 继续输出默认 `message: NotificationVO`。
  - STATE_CHANGED 输出命名 `refresh` event。
  - 15 秒 `heartbeat` event。
  - 来源实例始终本地投递；Redis 回环按 `sourceInstanceId` 忽略，publish 失败不影响本机 SSE。

- [x] E5 Web 多标签页同步
  - NotificationBell 保持现有 `onmessage` 行为。
  - 新增 refresh listener，复用现有 unread/list refresh。
  - heartbeat 不触发业务 UI。

- [x] E6 测试与真实 Redis 验收
  - 双实例 created / read state propagation。
  - fallback / malformed / duplicate event。
  - 真实 Redis publish/subscribe 与 restart/resubscribe。
  - API/Web typecheck、完整 Rules、`git diff --check`。

- [x] E7 文档封板
  - 更新 architecture / project-progress / specs index / alignment-log。
  - 记录 Redis outage 下的 realtime 降级语义。
  - E2～E6 全绿后标记 EVENT-001 `VERIFIED`。

## 最终验收

- `RedisService` 已增加显式 `micromatrix-crm:event:*` channel、普通 command client + 独立 subscriber client、自动 reconnect/resubscribe，以及 publish/receive/handler/subscribe 指标；业务 Service 仍不持有原始 Redis client。
- `NotificationsService` 已建立版本 1 的 CREATED / STATE_CHANGED envelope，包含 eventId、sourceInstanceId、tenantId、userId、occurredAt；malformed/unknown-version 消息 fail-closed 丢弃并节流告警。
- 新通知在数据库落库和 CACHE-001 版本失效后先投递本实例 SSE，再 best-effort PUBLISH；来源实例收到 Redis 回环后忽略自身消息，其它 API 实例只向各自本地连接投递。远端重复 eventId 使用 60 秒/2000 条有界窗口去重。
- markRead / markAllRead 成功变更后发送 STATE_CHANGED，SSE 映射为 `refresh`；NotificationBell 写操作后也统一重新 `refresh()`，消除 SSE 与 HTTP 返回顺序竞争。新通知仍保持默认 `message = NotificationVO`，并增加 15 秒命名 `heartbeat`。
- 双实例专项覆盖 CREATED 跨实例、来源实例不重复、markRead + markAllRead 跨实例 refresh、Redis publish failure 本机降级、malformed/unknown-version drop 与重复 eventId drop，通知专项 **5/5 PASS**。
- 真实 `redis:7-alpine` Smoke PASS：普通 JSON command round-trip 与 Pub/Sub 同时工作；主动 `CLIENT KILL` subscriber 后 ioredis 自动重连/重新订阅，重连前后消息各收到一次，`subscribeErrors=0`、`handlerErrors=0`，无需重启 API。
- 最终质量批次：API typecheck PASS、Web typecheck PASS、Web production build **4145 modules transformed**、完整 Rules **153/153 PASS**、`git diff --check` PASS。
- EVENT-001 没有引入 durable queue/BullMQ、Export topic、Redis Lock、Cron leader election、流水号、Session 或验证码。

当前状态：**VERIFIED**。
