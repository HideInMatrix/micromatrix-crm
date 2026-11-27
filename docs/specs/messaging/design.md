# Messaging 与公告设计

## 1. 业务通知流程

```text
Business event
  -> MessageTaskEvent
  -> MessageTemplateService.render(event, context, language)
  -> recipients
     ├── Notification (PostgreSQL)
     └── enabled external MessageDelivery
  -> cache invalidation
  -> Redis Pub/Sub
  -> SSE clients refresh
```

站内 Notification 是用户消息事实；外部 channel 是独立 delivery。通知实际发送必须发生在业务事务提交之后；更新类通知先比较字段的规范化存储值，未发生实际变化不通知。外部事件 Inbox 的幂等重放不重新触发通知。

v2 `create`（线索/客户）及 `convert` 路径在业务写入、Inbox SUCCESS 和操作审计的同一事务中写入 `ExternalEventNotification` 持久化任务，API 不再等待模板渲染或渠道投递。Worker 每秒扫描到期任务，每批最多 50 条、每进程 2 并发、一次扫描最多 4 批；任务在消费时读取最新通知开关、有效成员、语言和渠道映射。消费事务按任务 id 和 attempts 条件删除任务、创建系统通知及渠道投递记录，失败整体回滚并指数退避重试（最多 5 分钟间隔，不主动丢弃）。站内通知以 Inbox ID + 事件作为来源标识；实时刷新和即时投递唤醒在消费事务提交之后执行，外部发送仍使用现有投递恢复机制。历史/更新/缴费路径保持原有通知机制。

任务积压与通知实际送达需要独立验收；业务 API 成功不代表通知已送达。外部平台发送后的进程异常仍可能触发现有至少一次投递机制的重试，不能承诺第三方端严格 exactly-once。

## 2. Event registry

`MESSAGE_TASK_DEFINITIONS` 同时给 API/Web 提供 module、event、显示名称和默认 channel 行为。事件集合只包含当前 Customer/Clue 业务；新增或删除业务模块时应同步维护事件注册表、模板和触发点。

MessageSettings 以 event 为稳定键存 channel 开关；共享类型保证前后端不各自维护事件字符串。外部事件新建线索复用 `CLUE_ADD`；外部事件更新线索和客户分别使用 `EXTERNAL_EVENT_LEAD_UPDATED` / `EXTERNAL_EVENT_CUSTOMER_UPDATED`，两者默认关闭。

## 3. Template renderer

`MessageTemplateService` 保存 zh-CN/en-US 类型化资源：

- `normalizeLanguage()` 统一 locale。
- `render()` 返回 title/content。
- `renderText()` 处理显式模板分支。
- User/Time 变量在服务端规范化。

模板是代码资源，不是数据库业务数据；修改模板需要经过代码 review 和测试。

## 4. Notifications

Notification 查询使用 tenant/user 边界。缓存采用 per-user version：任何 create/markRead/source delete 都 bump version，使不同分页和 unread cache 同时失效。

Realtime 只发送轻量 `STATE_CHANGED` 类信号，客户端收到后重新读取 API。

## 5. Announcement

Announcement 保存：subject/content/startAt/endAt/url/linkName、departmentIds、userIds、receiverUserIds、notice 状态和审计字段。

发布流程：

1. 保存时展开部门树并冻结 receiverUserIds。
2. 当前有效则创建 sourceType=announcement/sourceId=<id> 的 Notification。
3. 未来公告由 `announcement-publish` Cron 扫描。
4. 多实例由 DistributedCoordinator 的 MINUTE slot 去重，单公告仍使用 `notice=false` 状态做数据库幂等。
5. 编辑/删除通过 sourceId 精确删除旧 Notification，再按新状态决定重建。

## 6. External channels

Messaging 只产生统一 delivery input；WeCom/DingTalk/Lark 的凭据、身份映射、发送 API、retry 分类和 provider message id 由 Enterprise Platform 的 MessageDelivery adapter 处理。

系统消息与任一外部 channel 相互隔离。外部失败保留审计，不撤销主业务事务。

## 7. User language

`User.language` 是当前通知语言偏好，并通过 CurrentUser/Personal Center 暴露。业务通知按 operator language 一次渲染；Cron/系统动作使用 zh-CN。

## 8. UI

`/system/messages` 聚合消息设置和公告管理。公告列表提供搜索、时间、接收范围、编辑/删除；编辑使用部门/成员选择并遵守当前 Element Plus 页面设计。

通知中心的交互以当前 PC/Mobile 实际实现为准。

## 9. 维护规则

- 新业务事件必须先进入 shared event registry，再接模板和触发点。
- 不新增平行 Notification 表或公告已读表。
- 不把 Provider Secret、access token 或完整第三方响应放入消息正文、缓存或日志。
- 删除业务模块时同步删除其 MessageTaskEvent、模板和 trigger。

## 10. 分类聚合目标设计（v0.2.52）

本节是经确认的新增规格。后端聚合入窗与封批已接线，过渡期仅当 API 与 Worker 进程显式设置 CRM_NOTIFICATION_AGGREGATION=1 时接收新聚合明细；PC/H5 明细浏览器验收及可靠性验收完成前不得在生产启用。关闭开关不停止已持久化批次的恢复。未完成的模块不得作为线上已生效行为。数据库事实源及 migration 流程见 [Prisma ORM 8 Migration 管理规范](../../prisma-migration-policy.md)。

### 10.1 策略注册表

共享纯 TypeScript 策略以明确 event 为键，禁止按 title、content 或 NotificationBizType 模糊匹配。优先顺序：事件显式覆盖 → 分类默认 → 普通已分类事件默认 SAME_CATEGORY；未知/未分类为 NONE。普通优先级 NORMAL，重要独立通知 HIGH；分类与聚合组为不同语义，默认每一分类对应一个聚合组。

| 分类              | 事件                                                                                                                                                     | 聚合模式      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| LEAD_ACTIVITY     | CLUE_ADD、EXTERNAL_EVENT_LEAD_UPDATED、CLUE_MOVED_POOL、CLUE_CONVERT_CUSTOMER、TRANSFER_CLUE、CLUE_DELETED、CLUE_DISTRIBUTED                             | SAME_CATEGORY |
| CUSTOMER_ACTIVITY | CUSTOMER_ADD、EXTERNAL_EVENT_CUSTOMER_UPDATED、CUSTOMER_TRANSFERRED_CUSTOMER、CUSTOMER_MOVED_HIGH_SEAS、CUSTOMER_DELETED、HIGH_SEAS_CUSTOMER_DISTRIBUTED | SAME_CATEGORY |
| BUSINESS_TODO     | CLUE_FOLLOW_UP_OVERDUE、CLUE_AUTOMATIC_MOVE_POOL、CUSTOMER_AUTOMATIC_MOVE_HIGH_SEAS、CLUE_FOLLOW_UP_PLAN_DUE、CUSTOMER_FOLLOW_UP_PLAN_DUE                | SAME_CATEGORY |
| INTERACTION       | CUSTOMER_COLLABORATION_ADD、CLUE/CUSTOMER_FOLLOW_UP_PLAN_COMMENT_ADDED、CLUE/CUSTOMER_FOLLOW_UP_RECORD_COMMENT_ADDED                                     | SAME_CATEGORY |
| INTERACTION       | CLUE/CUSTOMER_FOLLOW_UP_PLAN_COMMENT_MENTIONED、CLUE/CUSTOMER_FOLLOW_UP_RECORD_COMMENT_MENTIONED                                                         | NONE / HIGH   |
| SYSTEM_SECURITY   | 无 event 的系统通知、权限/角色、安全及组织同步通知                                                                                                       | NONE / HIGH   |
| IMPORTANT         | 公告、财务、重要审批                                                                                                                                     | NONE / HIGH   |
| UNKNOWN           | 无明确已登记分类的新通知                                                                                                                                 | NONE / HIGH   |

SAME_EVENT 是合法的事件级覆盖；聚合键必须加入 event，不能与 SAME_CATEGORY 同组。每个已注册的事件必须有显式分类，新增事件缺少策略应由测试/类型约束发现。现有转换事件 type=system 是业务展示分类，不影响明确的 event 分类；公告来源始终独立，即使误传普通 event 也不得聚合。财务/权限通知仅为未来安全边界，并不新增业务事件或恢复已退出的交易模块。

### 10.2 持久化窗口和渠道边界

```text
业务事件 / durable Outbox / 普通通知入口
  -> 接收人、模板和各渠道 gate
  -> 分类策略
      NONE: 现有即时通知/投递
      聚合: PostgreSQL 原始明细 + 渠道归属 + 固定窗口
  -> 到期封批事务
      SYSTEM: notifications 单条可见记录 + 一次提交后 SSE
      WECOM: message_deliveries 单条实际请求 + 明细关联
  -> 独立渠道发送/重试；PC/H5 明细查询
```

按数据库时钟确定接收明细的固定 5000ms 窗口（UTC epoch 分段），不因后续消息到达滑动延后。基线以持久化接收时刻计，不冒充业务发生时刻；业务原始时间单独保留。窗口结束后新明细进入新窗口，不追加已经封批/已读/发送的批次。聚合等待最多一个窗口是设计目标，不包含 Outbox 积压、扫描调度、频控等待及 Provider 网络延迟。每批初始上限建议 500 明细，满批后同窗口分片，实际边界用压测验证；分类、租户、成员、渠道、应用身份或语言不匹配不得合并。

新增 `notification_batches`、`notification_items`。每个渠道批次仅生成一个实际输出，使用批次 channel + outputId 唯一关联（未封批为 null）；明细经 batchId 外键归属，不另建冗余的投递明细关联表。沿用 notifications 作为站内可见事实与 readAt 真相源，沿用 message_deliveries 作为实际外部请求事实；单独保存原始明细，不把摘要当明细。SYSTEM 与 WECOM 批次分别封批，渠道开关在写入明细前判定，不依赖站内开关创建企微明细；同一逻辑明细可对应不同渠道归属。独立明细主键及稳定来源幂等键（外部事件使用 Inbox ID + event + recipient + channel），普通入口使用调用方稳定来源或新生成意图 ID，不能用正文哈希错误去重。历史直接投递/通知默认不关联批次，保留旧接口及历史已读。

批次 scopeKey 由 tenant、recipient、channel、category/group、mode、priority、language、windowStart，以及渠道应用/凭据版本/外部账号的确定性结构计算 SHA-256 摘要；scopeKey + shard 唯一（非空键，避免 PostgreSQL NULL 唯一性漏洞）。索引覆盖到期批次扫描、租户成员明细分页、来源幂等与渠道关联。明细只保存 batchId，tenant/recipient 由父批次决定；输入端检查成员及应用/映射范围，封批校验实际输出的租户/成员/渠道。跨表多态 outputId 由封批事务校验而非外键。数据库只用新增 forward migration，禁止回写已发布 migration、db push 或手改 ref。

### 10.3 原子封批和恢复

- 接收与封批争用同一数据库 scope advisory transaction lock/唯一键，接收事务不追加已封批行；失败保留明细重试。Outbox 原条件认领、明细写入与任务删除同事务；组回滚仍按原逻辑降级单条。
- 到期扫描以有界候选列表加事务锁及条件更新认领，封批事务冻结成员集合、生成统计摘要与实际 Notification/MessageDelivery、写关联、推进批次状态。提交后才触发 SSE/渠道唤醒；渠道丢失唤醒由现有定时扫描恢复；SSE 丢失仅影响实时刷新，已提交记录仍可查询。
- 外部发送不持数据库事务，沿用既有 Token 缓存、并发及退避；认领后再次校验应用/凭据版本、接收映射和渠道状态。发送成功/失败与批次关联结果一致更新；超时或外部成功后本地提交失败是未知结果，保留审计、限制重复发送风险，不能承诺第三方 exactly-once。待频控消息仍为持久待发送任务，频控等待不消耗网络重试次数。重要通知不进入普通聚合，但仍遵守真实渠道限额。
- 未读只统计已封批可见记录，读取或标记已读必须 tenant+user 约束，已封批内容不可追加；批次关联明细按创建时间/ID 稳定分页。SSE 只在提交后一次通知/状态信号，不为每条原始明细推送。
- 摘要展示分类、明细数量和事件计数，避免在卡片直接暴露资源名字/敏感字段；单条走原模板。多条 PC 与 H5 共用鉴权 API，建议 `GET /notifications/batches/:id/items`，渠道专属批次允许本人通过受鉴权入口访问，不要求站内开关开启。批次 id 不是访问凭证；根据当前租户、接收人、资源权限/data scope 判断明细内容，无法验证时仅显示不可访问的通用提示，旧链接也经资源接口授权。企业微信 workbench 路由白名单只新增明确的 H5 批次详情路径，摘要按 UTF-8 字节预算编码，不直接拼接全部正文；官方具体消息长度/额度需核实。

### 10.4 存储层实现边界

`NotificationAggregationStore` 提供 caller-owned transaction append、到期 ID 扫描、单批事务 seal；已接入普通业务通知、直接带业务 event 的站内提醒、v2 外部事件 Outbox 和 WECOM enqueue（受过渡开关控制）。来源摘要锁独立于窗口，scope 摘要锁同时用于入窗和封批；获取锁后重新读取数据库时间，窗口过期则重新计算，禁止持续滑动。原始明细插入与批次 itemCount 同事务，满 500 分片。封批事务内的 output writer 只允许本地数据库写入，校验输出范围后设置 sealedAt/outputId，异常整体回滚；后续 Worker 使用提交后的 outputId 唤醒。无跨事务 SENDING 封批状态，不需要单独恢复封批代次；实际渠道发送代次 fencing 另行实现。

多意图事务统一使用 appendMany，先按 tenant+recipient 摘要排序取得事务锁，再顺序写入；单条 append 使用相同接收人锁，避免多个组按任意顺序占用不同 scope。Outbox 仍按任务 id 稳定认领，失败整体回滚并降级单条。

Worker 每秒独立扫描到期批次（最多取 200 候选、轮转处理 50、4 并发），实际 seal 成功才发出站内 SSE 或渠道执行器唤醒。单项输出沿用原内容、链接及来源；多项输出使用双语分类标题、总数与事件计数，采用 AGGREGATED:<category> 渠道审计事件和 NOTIFICATION_BATCH 站内来源。原始渠道明细保存未截断渲染内容；实际投递保留原有字段长度限制，汇总正文另留 UTF-8 字节预算。新卡片链接映射为 /mobile/mine/message/batch?id=...（PC/H5 页面已接入，真实浏览器及企业微信工作台验收仍待完成，不可生产启用）。企微发送前检查实际批次、当前接收成员/映射、凭据版本及每个原始事件最新开关（不走设置缓存）；任一不符则 DEAD 并保留完整明细，暂不自动拆分部分仍启用事件。错误码 0 且返回非空 invaliduser 也不标为成功。

现有诊断开关下记录 notification_aggregation_perf（扫描、成功封批、站内/企微输出、明细、失败、耗时）及 Outbox aggregatedItems；不输出正文、标识或凭据。封批失败保留待扫，尚无持久化退避或隔离队列；持续失败的候选超过扫描页时可能阻塞后续任务，须在生产启用前完善。渠道配额、实际发送代次 fencing、部分禁用事件拆分策略、租户/成员删除与保留生命周期、真实 SSE/Redis 与浏览器及企业微信终端验收仍待完成。不得把本地集成测试视为生产聚合上线完成。

### 10.5 批次明细与阶段发布

PC 路由 `/notifications/batches/:id`、H5 路由 `/mobile/mine/message/batch?id=...` 均已接入统一 `GET /notifications/batches/:id/items`，按固定明细顺序分页。API 校验当前租户及接收成员、已封批状态及输出归属，重新查询当前成员、租户、角色与角色权限，不直接依赖认证缓存；客户使用 CustomerAccessService，线索检查菜单权限与业务数据范围，跟进计划/记录及评论使用既有业务权限裁决。无法确认具体资源（例如列表链接）、权限已撤回或记录已删除时，只返回事件名称、发生时间等非正文信息，不返回历史正文及链接。响应 private, no-store；站内和企业微信专属批次均支持本人访问。PC/H5 类型检查和构建及真实 PostgreSQL 权限专项通过；真实浏览器、企业微信 SSO/终端交互仍未验收。

v0.2.52 为第八轮阶段发布：允许发布默认关闭新聚合入窗的镜像及新增结构迁移，不代表聚合已达到生产启用条件。API、Worker 必须同版本，显式保持 CRM_NOTIFICATION_AGGREGATION=0；新入窗关闭时保留原通知链路，已持久化批次仍可被 Worker 恢复。生产启用需先完成持久化失败退避、频控、发送代次 fencing、部分关闭事件拆分、生命周期及全链路性能与真实渠道验收。不得将发布镜像等同部署或实际送达。

### 10.6 验收与上线边界

1. 策略：全部现有事件有分类；同类合并、跨类/跨租户/跨成员/跨渠道/跨应用/跨语言不合并；@、公告、权限安全和未知事件不延迟。
2. 数据库：Prisma emit、plan DDL 审计、隔离 PostgreSQL apply、migration check/status/verify；并发入窗/封批、边界时间、分片、回滚、重复来源、宕机恢复，历史通知与已读兼容。
3. 业务：站内/企微独立开关组合；单项原样、多项计数准确；外部失败不影响站内；禁用或变更映射、权限收回、重复请求、渠道未知结果测试。
4. UI：PC 通知列表与详情、H5 消息入口/批次详情/企微授权跳转、分页、已读和拒绝访问；真实浏览器检查两端。
5. 性能：20 RPS × 20s 预计 600 原始明细；分类拆开后两位成员、4 个窗口时，线索与客户类别理想约 16 个渠道摘要，而非未分类方案的 8 个；窗口跨界/分片/开关使实测数量变化。统计原始/站内可见/实际渠道请求数、聚合率、p95 等待/执行、最老积压、Token、SSE、CPU/RAM；50 RPS 持续与 200 事件突发先隔离模拟 Provider，再按已验证额度真实企微端验收。真实 Provider 响应成功与终端收件分别验收。
6. 上线前备份、确认兼容迁移和所有服务同版本、无旧 Worker 并发消费；默认不重发历史记录。先冒烟/对账/检查积压，再逐级加压。正式启用聚合须完成实施并通过全部验收；阶段镜像发布按 §10.5 保持关闭，未授权不改生产数据库、渠道凭据或频率配置。
