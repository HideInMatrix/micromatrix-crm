# EVENT-001 Redis Pub/Sub 与多实例 SSE 需求

## 1. 背景与目标

CACHE-001/CACHE-002 已将 Redis 建成可降级缓存基础设施，但当前 `NotificationsService` 的 SSE 客户端集合仍只存在于单个 Node.js 进程内。单实例运行时通知可以实时送达；当 API 扩为多个实例后，通知写请求与用户 SSE 长连接可能落到不同实例，当前内存 `Subject` 无法跨实例传播。

CordysCRM 的 `MessagePublisher -> Redis Topic -> SSEConsumer -> SseService` 已明确使用 Redis Pub/Sub 解决这一问题。本单元按相同业务语义迁移，但保持 MicroMatrix 已有 PostgreSQL Notification 真相源和 CACHE-001 缓存架构，不把 Redis Pub/Sub 当持久消息队列。

## 2. 功能需求

### R1 Redis 事件总线基座

- Redis 访问继续统一收口在全局 Redis 基础设施，业务模块不得自行创建 Redis 客户端。
- Pub/Sub channel 必须使用 MicroMatrix 专属前缀，避免和同 Redis 实例中的其它应用冲突。
- 发布连接与订阅连接必须符合 Redis Pub/Sub 连接语义；订阅连接不能复用为普通 GET/SET/INCR 命令连接。
- Redis 启动晚于 API、运行中断线或恢复后，订阅能力必须能自动恢复；不得要求重启 API 才重新订阅。
- Redis 未配置或不可用时，事件发布必须 fail-open，调用方得到明确失败结果并可走本机降级路径。

### R2 通知实时事件协议

- 首批只定义通知实时事件，不顺带扩展 Export/BullMQ/组织同步等 topic。
- Redis 事件必须带协议版本、事件类型、租户、用户和发生时间。
- `CREATED` 事件携带当前已经落库的 `NotificationVO`，Redis 不负责生成通知内容。
- `STATE_CHANGED` 事件只表示通知已读状态需要刷新，不在 Redis 中复制整份通知列表或未读计数。
- 无法解析、版本不支持、缺少必要字段的消息必须丢弃并记录受节流的 warning，不能让 subscriber 异常退出。

### R3 多实例 SSE 分发

- 每个 API 实例只维护本实例真实 EventSource 连接。
- 新通知必须先写 PostgreSQL并完成 CACHE-001 通知缓存版本失效，再发布 Redis 事件。
- Redis 发布成功时，所有 API 实例通过订阅消费同一事件，并仅向本实例目标用户的 SSE 连接推送。
- 发布方必须始终先完成本实例 SSE 投递，再 best-effort 发布 Redis；事件携带来源实例标识，来源实例收到 Redis 回环消息时必须忽略自身事件，避免正常路径重复通知。
- Redis 发布失败或当前没有有效 subscriber 时，本实例实时体验不受影响；其它实例暂时无法收到跨实例事件，但数据库通知仍然可通过列表接口读取。
- 不要求 Redis Pub/Sub 提供持久化或补发语义；客户端重连/刷新后的 PostgreSQL 查询负责最终收敛。

### R4 SSE 向后兼容与多标签页状态同步

- 新通知继续使用默认 SSE `message`，`event.data` 保持现有 `NotificationVO` JSON，避免破坏当前 NotificationBell 消费契约。
- 单条已读、全部已读成功后发布 `STATE_CHANGED`，后端把它映射为命名 SSE event `refresh`；PC 多标签页收到后重新读取未读数/最近通知。
- SSE 增加命名 `heartbeat` 事件，默认 15 秒发送一次，用于保持代理链路与长连接活性；heartbeat 不触发业务提示。
- 同一用户在一个实例上允许多个 SSE 连接，事件需投递给全部本地连接。

### R5 一致性与失败语义

- PostgreSQL Notification 永远是业务真相源；Redis Pub/Sub 消息丢失不能造成通知记录丢失。
- Redis publish/subscribe 失败不能回滚已经成功的 Notification create/read 数据库写入。
- 同一 API 实例不得因为“本地直推 + 收到自己发布的 Redis 消息”导致正常路径重复通知。
- 对模糊发布失败可能产生的重复事件，消费者应至少以 notification id / event identity 做本实例短窗口去重。
- EVENT-001 不替换 CACHE-001 的通知缓存版本失效逻辑。

### R6 可观测与安全

- `/health` 可暴露 Pub/Sub 是否启用、subscriber 是否 ready，以及 publish/receive/fallback/drop 等累计计数；不得暴露 Redis URL、密码、channel 中的业务敏感数据或消息正文。
- Pub/Sub payload 不允许包含 JWT、密码、API Secret、企业微信 Secret、OAuth state 等凭据。
- Redis 仍不发布宿主端口，EVENT-001 不改变现有 Compose fail-open 部署原则。

## 3. 验收要求

- 单元测试证明两个独立 `NotificationsService` 实例共享一个事件总线时，实例 A 创建通知可以实时到达实例 B 的 SSE 客户端，并且实例 A 不重复收到两次。
- 单元测试证明 markRead / markAllRead 可跨实例产生 `refresh` 事件。
- 单元测试证明 Redis 不可用时仍执行本机 SSE 降级，数据库操作成功语义不变。
- 单元测试证明 malformed/unknown-version Pub/Sub 消息不会影响后续合法事件消费。
- 使用真实 Redis 验证 publish/subscribe、subscriber reconnect/resubscribe 和普通缓存命令连接互不干扰。
- API typecheck、Web typecheck、完整 Rules 与 `git diff --check` 必须通过。
- 最终同步 architecture、project-progress、specs 索引与 alignment-log 后才能将 EVENT-001 标记为 `VERIFIED`。

## 4. 非本批范围

- BullMQ / durable queue / consumer retry。
- Export DOWNLOAD topic。
- 组织同步锁、Cron leader election。
- Redis Stream、Kafka、RabbitMQ。
- 业务流水号与 Redis INCR 编号。
- Session、验证码、登录限流。
