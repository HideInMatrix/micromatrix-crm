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

新增 `notification_batches`、`notification_items`。每个渠道批次最多生成一个实际输出，使用批次 channel + outputId 唯一关联（未封批或全量抑制为 null）；明细经 batchId 外键归属，不另建冗余的投递明细关联表。沿用 notifications 作为站内可见事实与 readAt 真相源，沿用 message_deliveries 作为实际外部请求事实；单独保存原始明细，不把摘要当明细。SYSTEM 与 WECOM 批次分别封批，渠道开关在写入明细前判定，不依赖站内开关创建企微明细；同一逻辑明细可对应不同渠道归属。独立明细主键及稳定来源幂等键（外部事件使用 Inbox ID + event + recipient + channel），普通入口使用调用方稳定来源或新生成意图 ID，不能用正文哈希错误去重。历史直接投递/通知默认不关联批次，保留旧接口及历史已读。

批次 scopeKey 由 tenant、recipient、channel、category/group、mode、priority、language、windowStart，以及渠道应用/凭据版本/外部账号的确定性结构计算 SHA-256 摘要；scopeKey + shard 唯一（非空键，避免 PostgreSQL NULL 唯一性漏洞）。索引覆盖到期批次扫描、租户成员明细分页、来源幂等与渠道关联。明细只保存 batchId，tenant/recipient 由父批次决定；输入端检查成员及应用/映射范围，封批校验实际输出的租户/成员/渠道。跨表多态 outputId 由封批事务校验而非外键。数据库只用新增 forward migration，禁止回写已发布 migration、db push 或手改 ref。

### 10.3 原子封批和恢复

- 接收与封批争用同一数据库 scope advisory transaction lock/唯一键，接收事务不追加已封批行；失败保留明细重试。Outbox 原条件认领、明细写入与任务删除同事务；组回滚仍按原逻辑降级单条。
- 到期扫描以有界候选列表加事务锁及条件更新认领，封批事务冻结成员集合、生成统计摘要与实际 Notification/MessageDelivery、写关联、推进批次状态。提交后才触发 SSE/渠道唤醒；渠道丢失唤醒由现有定时扫描恢复；SSE 丢失仅影响实时刷新，已提交记录仍可查询。
- 外部发送不持数据库事务，沿用既有 Token 缓存、并发及退避；认领后再次校验应用/凭据版本、接收映射和渠道状态。发送成功/失败与批次关联结果一致更新；超时或外部成功后本地提交失败是未知结果，保留审计、限制重复发送风险，不能承诺第三方 exactly-once。待频控消息仍为持久待发送任务，频控等待不消耗网络重试次数。重要通知不进入普通聚合，但仍遵守真实渠道限额。
- 未读只统计已封批可见记录，读取或标记已读必须 tenant+user 约束，已封批内容不可追加；批次关联明细按创建时间/ID 稳定分页。SSE 只在提交后一次通知/状态信号，不为每条原始明细推送。
- 摘要展示分类、有效明细数量和事件计数，避免在卡片直接暴露资源名字/敏感字段；单项也使用安全摘要，见 §10.9。PC 与 H5 共用鉴权 API，建议 `GET /notifications/batches/:id/items`，渠道专属批次允许本人通过受鉴权入口访问，不要求站内开关开启。批次 id 不是访问凭证；根据当前租户、接收人、资源权限/data scope 判断明细内容，无法验证时仅显示不可访问的通用提示，旧链接也经资源接口授权。企业微信 workbench 路由白名单只新增明确的 H5 批次详情路径，摘要按 UTF-8 字节预算编码，不直接拼接全部正文；官方具体消息长度/额度需核实。

### 10.4 存储层实现边界

`NotificationAggregationStore` 提供 caller-owned transaction append、到期 ID 扫描、单批事务 seal；已接入普通业务通知、直接带业务 event 的站内提醒、v2 外部事件 Outbox 和 WECOM enqueue（受过渡开关控制）。来源摘要锁独立于窗口，scope 摘要锁同时用于入窗和封批；获取锁后重新读取数据库时间，窗口过期则重新计算，禁止持续滑动。原始明细插入与批次 itemCount 同事务，满 500 分片。封批事务内的 output writer 只允许本地数据库写入，校验输出范围后设置 sealedAt/outputId，异常整体回滚；后续 Worker 使用提交后的 outputId 唤醒。无跨事务 SENDING 封批状态，不需要单独恢复封批代次；实际渠道发送代次 fencing 见 §10.7。

多意图事务统一使用 appendMany，先按 tenant+recipient 摘要排序取得事务锁，再顺序写入；单条 append 使用相同接收人锁，避免多个组按任意顺序占用不同 scope。Outbox 仍按任务 id 稳定认领，失败整体回滚并降级单条。

Worker 每秒独立扫描到期批次（最多取 50 个到期且未隔离的候选、4 并发），实际 seal 成功才发出站内 SSE 或渠道执行器唤醒。单项与多项均输出双语分类标题、有效总数与事件计数，采用 AGGREGATED:<category> 渠道审计事件和 NOTIFICATION_BATCH 站内来源。原始渠道明细保存未截断渲染内容；实际投递保留原有字段长度限制，汇总正文另留 UTF-8 字节预算。新卡片链接映射为 /mobile/mine/message/batch?id=...（PC/H5 页面已接入，真实浏览器及企业微信工作台验收仍待完成，不可生产启用）。企微发送前检查实际批次、当前接收成员/映射、凭据版本及每个原始事件最新开关（不走设置缓存）；身份不符或有效明细为空则终止并保留原明细；部分事件禁用时仅投影有效明细，见 §10.9。错误码 0 且返回非空 invaliduser 也不标为成功。

现有诊断开关下记录 notification_aggregation_perf（扫描、成功封批、站内/企微输出、明细、失败、耗时）及 Outbox aggregatedItems；不输出正文、标识或凭据。v0.2.53 开发中已实现持久化退避与隔离、发送代次 fencing，见 §10.7；退避或隔离的批次不再占用扫描名额。渠道配额见 §10.8，部分禁用处理见 §10.9；租户/成员删除与保留生命周期见 §10.10；真实 SSE/Redis 与 PC/H5 浏览器初步验收及 20 RPS 基线见 §10.12；真实企业微信终端及更高负载验收仍待完成。不得把本地集成测试视为生产聚合上线完成。

### 10.5 批次明细与阶段发布

PC 路由 `/notifications/batches/:id`、H5 路由 `/mobile/mine/message/batch?id=...` 均已接入统一 `GET /notifications/batches/:id/items`，按固定明细顺序分页。API 校验当前租户及接收成员、已封批状态及输出归属，重新查询当前成员、租户、角色与角色权限，不直接依赖认证缓存；客户使用 CustomerAccessService，线索检查菜单权限与业务数据范围，跟进计划/记录及评论使用既有业务权限裁决。无法确认具体资源（例如列表链接）、权限已撤回或记录已删除时，只返回事件名称、发生时间等非正文信息，不返回历史正文及链接。响应 private, no-store；站内和企业微信专属批次均支持本人访问。PC/H5 类型检查和构建及真实 PostgreSQL 权限专项通过；真实 PC/H5 浏览器基础展示、刷新、PC 清理确认/取消已通过 §10.12；企业微信 SSO/终端交互及更多浏览器授权/分页场景仍待验收。

v0.2.52 为第八轮阶段发布：允许发布默认关闭新聚合入窗的镜像及新增结构迁移，不代表聚合已达到生产启用条件。API、Worker 必须同版本，显式保持 CRM_NOTIFICATION_AGGREGATION=0；新入窗关闭时保留原通知链路，已持久化批次仍可被 Worker 恢复。生产启用需先完成 §10.7 可靠性开发与全部验收、频控、部分关闭事件拆分、生命周期及全链路性能与真实渠道验收。不得将发布镜像等同部署或实际送达。

### 10.6 验收与上线边界

1. 策略：全部现有事件有分类；同类合并、跨类/跨租户/跨成员/跨渠道/跨应用/跨语言不合并；@、公告、权限安全和未知事件不延迟。
2. 数据库：Prisma emit、plan DDL 审计、隔离 PostgreSQL apply、migration check/status/verify；并发入窗/封批、边界时间、分片、回滚、重复来源、宕机恢复，历史通知与已读兼容。
3. 业务：站内/企微独立开关组合；单项安全摘要、多项计数准确、永久抑制及有效子集；外部失败不影响站内；禁用或变更映射、权限收回、重复请求、渠道未知结果测试。
4. UI：PC 通知列表与详情、H5 消息入口/批次详情/企微授权跳转、分页、已读和拒绝访问；真实浏览器检查两端。
5. 性能：20 RPS × 20s 预计 600 原始明细；分类拆开后两位成员、4 个窗口时，线索与客户类别理想约 16 个渠道摘要，而非未分类方案的 8 个；窗口跨界/分片/开关使实测数量变化。统计原始/站内可见/实际渠道请求数、聚合率、p95 等待/执行、最老积压、Token、SSE、CPU/RAM；50 RPS 持续与 200 事件突发先隔离模拟 Provider，再按已验证额度真实企微端验收。真实 Provider 响应成功与终端收件分别验收。
6. 上线前备份、确认兼容迁移和所有服务同版本、无旧 Worker 并发消费；默认不重发历史记录。先冒烟/对账/检查积压，再逐级加压。正式启用聚合须完成实施并通过全部验收；阶段镜像发布按 §10.5 保持关闭，未授权不改生产数据库、渠道凭据或频率配置。

### 10.7 v0.2.53 可靠性设计与实施边界

封批失败持久化记录 sealFailures、nextSealAttemptAt、sealDeadAt、sealErrorCode（固定非敏感分类码）。退避 5s、30s、120s、600s，第五次失败隔离，不删除原明细。到期扫描同时过滤 sealedAt、sealDeadAt、windowEnd、nextSealAttemptAt；失败批次不得占据正常候选页。封批失败事务整体回滚后，通过相同 scope 事务锁和观察到的失败代次条件记录失败；如果另一个进程已封批或推进代次，不再覆盖。DB 本身不可用时不能保证记录失败，恢复后仍可扫描。隔离批次保留待审计与后续受控恢复，不自动重放；本阶段不提供开放的重试接口。

实际渠道投递每次认领生成唯一 claimToken（与 attempts 独立），原子条件更新只认领未耗尽次数且已到期的 PENDING/FAILED。成功和失败回写须同时匹配 id、tenantId、SENDING、claimToken；过期回写仅记 stale_claim 诊断，不改变新状态。人工重试以旧状态/令牌/次数/更新时间作条件更新，并生成新令牌，即使 attempts 重置也不复用旧代次。超时恢复清除 SENDING 状态并保留审计；次数耗尽进入 DEAD，未耗尽按原机制恢复待重试。第三方已接收而本地回写失败、网络超时等仍为未知结果；fencing 只保证本地状态不被旧认领覆盖，不能保证 Provider exactly-once。成功回写数据库异常不应被当成 Provider 拒绝。迁移仅增加字段和索引，API/Worker 必须同版本；聚合开关保持 0。频控见 §10.8，部分事件关闭处理仍待独立验收。

### 10.8 企业微信主动频控（R8.8.3）

2026-11-27 调研：官方发送应用消息页面 https://developer.work.weixin.qq.com/document/path/90236 本次未能直接读取。公开文档副本 https://github.com/wxkingstar/doc-hub-mcp/blob/main/wecom/001-%E4%BC%81%E4%B8%9A%E5%86%85%E9%83%A8%E5%BC%80%E5%8F%91/002-%E6%9C%8D%E5%8A%A1%E7%AB%AFAPI/009-%E6%B6%88%E6%81%AF%E6%8E%A5%E6%94%B6%E4%B8%8E%E5%8F%91%E9%80%81/002-%E5%8F%91%E9%80%81%E5%BA%94%E7%94%A8%E6%B6%88%E6%81%AF.md 与腾讯 HiFlow https://hiflow.tencent.com/docs/applications/qiyeweixinthird/ 提及应用每天账号上限×200人次、同成员30次/分钟及超额可能不下发；前者另载1000次/小时。不能将这些历史副本、第三方应用说明或群聊限制视为当前自建应用实际额度。正式开启前核对管理员后台额度及实际发送统计，留出外部应用调用余量。

CRM 业务目标是降低同一接待成员短时间内的同类通知打扰，而非限制业务量。聚合仍按接收人、分类、渠道及固定 5 秒窗口执行，保留所有原始明细；成员轮班或人数变化无需修改配置。主动频控独立于聚合：应用滚动 1 秒默认 10 次，成员滚动 60 秒默认 24 次、3600 秒默认 800 次（本地保护值，不是官方额度承诺）。应用与成员滚动 24 小时预算 CRM_WECOM_APP_DAILY_LIMIT、CRM_WECOM_MEMBER_PER_DAY 均可选，未设置、空字符串或 0 表示不启用该日窗口；显式正整数（1–1000000）才启用对应本地上限，其他非空非法值仍安全延期。关闭日窗口不关闭短时保护、应用冷却、预约记录或持久化重试，也不代表平台额度无限。CRM_WECOM_RATE_LIMIT 默认 0；聚合与频控分别验收，推荐真实渠道启用短时保护，不再以配置每日预算作为开启条件。禁止混合版本/混合配置消费者，重要通知不绕过已启用的配额。

真实 corpId+agentId 摘要为应用 scope，应用+externalSubject 摘要为成员 scope，不使用 secret、凭据版本或 CRM 租户作为额度分区。同一企业应用跨租户使用共享额度，隔离数据内容；只存不可逆摘要及时间，不存正文/凭据。数据库时钟、应用 advisory xact lock、滚动窗口预约账本及应用冷却状态。每次实际 POST 前在短事务中验证 SENDING 与 claimToken（不匹配不得发送）、检查所有窗口，批准才写一条预约；未批准不写任何预约，在同事务按代次回写 PENDING、nextAttemptAt、WECOM_RATE_LIMIT_WAIT 并恢复刚扣的次数。预约成功后不返还（崩溃、网络未知结果保守计费），不持事务发网络请求；Token 获取失败走原网络重试。频控存储异常禁止 POST，尽可能持久化延期并返还认领次数，数据库本身不可用时只能留 SENDING 待既有恢复。收到45009或HTTP429，应用共享冷却至少60秒，实际已发请求消耗正常次数；冷却非官方解封保证，继续遵守配额及退避。限流待发由有界秒级扫描恢复，不阻塞执行器线程；账本过期清理有界执行。由于预约与网络非原子，不保证第三方 exactly-once 或其他系统的调用量。当前阶段只验证隔离模拟 Provider，真实渠道启用另行授权。

实施状态：新增预约账本、冷却状态两表及四个索引；秒级待发扫描新增 channel/status/nextAttemptAt/createdAt 复合索引，真实 PostgreSQL 迁移、并发配额与模拟 Provider 回归已通过。可选每日预算为部署级配置，启用时不同应用分别独立计数但使用相同配置值；不启用日窗口时仍记录发送预约，且保留真实平台限额退避。原先已延期的任务仍按 nextAttemptAt 到期自动恢复，不盲目重放或提前清除配额等待。配额按实际 POST 前预约时间计，不等同 Provider 实际到达时间；进程暂停、网络、跨系统额外调用或未知官方额度仍可能产生差异。冷却仅覆盖当前应用，未尝试自动解封；清理每分钟最多各 5000 个过期预约/冷却，关闭频控时不主动清理。长期账本容量、索引 DDL 锁及多进程负载需在上线前验收。

### 10.9 事件禁用与延迟通知安全投影（R8.8.4）

保留单批次及全部原始明细、来源去重键，不物理复制或迁移明细。封批时按当前租户/成员状态和渠道事件设置筛选；禁用的明细同事务标记 suppressedAt/suppressionReason，永不自动恢复（之后启用只影响新通知）。原始 itemCount 不变，输出计数和本人详情分页仅包含未抑制明细。全量抑制时封批但无输出、无 SSE、无外部请求。站内与企微分别判断各自渠道，不相互影响。

安全优先修订单项原样展示规则：所有延迟批次包括单项都只输出分类、已启用事件计数和批次链接，不发送历史资源名称、正文、业务链接或模板变量；本人通过鉴权明细接口实时校验数据范围后进入当前业务记录。详情只返回静态事件名称及授权链接，不返回历史模板正文/标题/自定义链接标签：目标记录权限不能证明模板中所有其他资源和字段的访问权。原始内容只留审计存储；后续若恢复正文展示须实现逐字段安全投影。立即发送的非聚合通知不变。这样即使入窗后资源被转移或权限被收回，也不会从延迟卡片泄露历史业务正文；事件类型及计数属于已选接收人的通知元数据，并非资源级访问授权。历史已发送的原始通知不追溯撤回。

企微在 Token 获取后、POST 构造前按当前 SENDING/claimToken 条件锁定记录，重新校验实际应用、凭据版本、活动成员、映射、租户渠道状态及最新事件开关；仅未抑制且仍启用的明细生成实际发送摘要并同事务保存。身份变更或全部抑制时终止，不调用 POST、不消耗本次发送次数；部分禁用继续原投递 ID，不新增投递，额度按一次实际 POST 预约。频控等待、网络重试后再次筛选，不自动重放已抑制明细。配置/权限修改与外部 POST 无分布式原子性，检查后极短窗口内仍可能变动；不承诺撤销已发送消息。明细接口继续按实时资源权限脱敏，永久排除抑制明细。生产聚合继续关闭。

实施状态：迁移 20261127T0235_notification_item_suppression 仅新增两字段，隔离 PostgreSQL apply/check/status/verify 通过。封批及实际发送投影、原明细永久标记、全禁用无输出/发送、频控等待恢复与遗留单项安全替换通过专项测试。详情实时数据范围检查后仅返回静态标签及授权链接。历史已发送内容不撤回；已封批的站内摘要是封批时快照，不因以后渠道设置变更回溯删除。数据库故障、Token 获取失败和真实 Provider 网络尝试仍走既有异常重试；并非所有未 POST 的异常都能无损返还尝试次数。检查、配额预约与 Provider POST 无原子保证。生命周期清理不得删除仍待发的批次关联；权限逐字段投影、真实浏览器/SSO、真实渠道和负载测试尚待验收。

### 10.10 聚合数据生命周期（R8.8.5）

保守部署策略：CRM_NOTIFICATION_RETENTION=0 默认关闭到期归档；启用时 CRM_NOTIFICATION_RETENTION_DAYS 默认90天（允许30–3650天），从封批及输出最终完成两者较晚时间计算。仅归档已封批、非隔离、站内已读或输出已不存在、企微 SUCCEEDED 或输出已不存在、以及无输出且所有明细均永久抑制的批次。未读站内、未封批、隔离、PENDING/SENDING/FAILED/DEAD 企微批次不自动过期。清除原始明细的同时写入仅含来源 SHA256 及原不透明批次/明细 ID 的有限期去重墓碑，默认自归档起保留30天（见 §10.11）；保留批次壳、原 itemCount、归档时间及输出关联。历史摘要和已读/投递结果不改；详情提示已超过保留期限、返回0明细。墓碑为伪匿名记录，到期后仅经用户确认手动清除，容量及清理积压仍需监控。

真实租户或成员已不存在时，Worker 独立于到期归档开关进行孤儿清理：保留去重墓碑，清除归属正确的聚合原始明细、批次壳、站内输出；企微输出保留最小投递结果审计，移除接收账号、用户、标题正文链接及 providerMessageId，未成功状态终止并禁止人工重试，已成功保持成功。该机制不追溯撤回已发外部消息，不删除普通非聚合历史。停用成员/租户非删除，不触发孤儿清理。成员删除事务与入窗、封批、清理使用相同 recipient advisory lock；顺序 recipient→scope→output，发送前投影锁 output，清理必须先核验输出归属及状态后删除原明细。租户硬删除无现有业务入口，以实际缺失检测为兜底。清理与 POST 无分布式原子性，已出网的请求无法取消。

Worker 单独定时执行，每分钟持久游标按批次主键扫描至多50条，循环回卷，短事务竞争领取扫描页、逐批在事务中重新验证，使用 try-lock 跳过忙碌的 recipient/scope；失败下次全周期重扫，对有限积压跨重启持续遍历。每批最多500明细，超出上限或数量不一致不得归档/删除，留待人工核查。归档状态、墓碑和删除同事务提交。归档/孤儿清理日志仅记录聚合计数，不输出正文或身份。清理开关关闭仍扫描孤儿；默认不清理活跃身份的历史。生产启用到期归档前确认业务保留期限并测量积压、锁等待与墓碑容量。

实施状态：迁移 20261127T0253_notification_lifecycle 新增墓碑、持久扫描游标和 detailsArchivedAt。归档/删除与去重同事务，旧代次发送前再验 claimToken（包括无频控的普通企微路径，避免旧版单项关联删除后落入即时路径）；成员删除、入窗和封批统一 recipient 锁。隔离库真实成员删除、Token 获取期间清理、待发及隔离保护、跨实例清理、事务回滚、持久墓碑重放通过。保留期配置是部署级策略，默认关闭；已删除身份孤儿清理独立运行。当前为50批/分钟全量循环扫描，包含归档批次壳；大量历史时清理延迟随总批次数增加，需在 R8.9 测量并确定清理吞吐和实际删除时效。有限期墓碑在有效期及清理积压期间占用数据库空间，聚合来源重放去重不等同任意非聚合入口 exactly-once。没有租户硬删除 API，不新增该高风险入口；仅检测实际缺失。生产未启用到期归档。

### 10.11 去重凭据有限保留与手动确认清理（R8.8.6）

用户撤回自动清理方案。保留 expiresAt，CRM_NOTIFICATION_DEDUP_RETENTION_DAYS 默认30天（1–3650整数天，非法值回退30），自归档或孤儿清理创建时按数据库时钟确定；期限只表示允许手动清理的最早时间。Worker 不自动删除任何去重凭据，也不自动补齐旧记录的期限。到期后仍参与幂等判断，直到经用户确认删除。已有期限不随配置变化缩短或延长。原始明细到期归档仍默认关闭，成员删除后的隐私清理及频控账本既有机制不在本次撤回范围。

新增 tenantId 归属（新墓碑必须写入批次租户；旧空归属/空期限不纳入用户清理，禁止跨租户猜测）。在 PC 系统消息设置提供去重凭据清理按钮。GET preview 使用当前认证租户，最多选取5000条已到期且归属明确的候选，返回数量、是否还有更多及候选摘要指纹。POST cleanup 需消息设置读取和更新权限、显式 confirm=true、预览指纹和数量；在事务内按租户互斥锁重新选取并锁定候选，指纹/数量变化即拒绝，重新预览后再确认。删除仅限确认的候选及已到期条件，写入同事务操作日志（不记录来源键或正文）；不得自动循环下一批。取消确认、预览、打开页面均不删除。无到期或无归属的旧凭据需要受控核查，不能由普通租户清理。该阶段未发布，生产尚无这些旧版墓碑。删除后直接重放旧来源可能重新生成通知，外部 Inbox/Outbox 幂等不变；不保证任意旧来源永久去重。生命周期容量及清理吞吐纳入 R8.9。

### 10.12 R8.9 隔离真实服务、浏览器与 20 RPS 基线（2026-11-27）

新增 `apps/api/tests/notification-e2e-isolated.test.ts`、`notification-e2e-browser.ts`、`notification-e2e-http-load.ts` 可复跑验收入口。每次以独立随机容器、端口、测试密钥、空 PostgreSQL 及 Redis 启动真实 API / Worker，正式迁移 graph 初始化并验证 schema；仅本地合成数据、loopback WeCom HTTP mock，不用生产库、生产凭据或真实 Provider。退出时清理本轮容器/子进程，临时目录保留非敏感日志、JSON 及可选浏览器截图。需要 Docker 本地镜像 postgres:18-alpine / redis:7-alpine、Node 25 和已构建 API；浏览器模式额外需要已构建 PC/H5 及 Chromium（R89_CHROME_PATH 可指定路径）。仓库根目录执行：

- `pnpm --filter @micromatrix/api test:notification-e2e-isolated`：真实通知链路冒烟。
- `R89_BROWSER=1 pnpm --filter @micromatrix/api test:notification-e2e-isolated`：附加真实 Chromium 浏览器交互，独立 profile，使用本轮真实 API 签发的 JWT 恢复会话。
- `R89_HTTP_LOAD=1 pnpm --filter @micromatrix/api test:notification-e2e-isolated`：附加真实 API Key、模板、创建/转换业务链 20 RPS × 20 秒。

冒烟 r89-174b5ad0：30 合成 Outbox → 60 双渠道明细 → 4 批次（2 站内 / 2 mock POST），SSE ID 2/2 精确一致，Token 1，quota 2，Outbox 0，耗时 6372ms。本人详情 200、未登录 401、跨租户 404、private/no-store；未确认清理拒绝，明确确认删除测试凭据。首轮 SSE 测试脚本漏解析无 event 字段的默认 message，修正脚本后对账通过，未修改业务 SSE 协议。

浏览器 r89-7dba3af2：PC 系统消息设置手动清理弹窗、取消保留数据库行、确认后删除、PC 站内批次和 H5 企微批次脱敏展示及刷新通过，保存三张截图。使用可见/未遮挡真实 DOM 按钮 click 触发实际 Vue handler；H5 设置移动 UA/390×844，非真实手机或企微内嵌浏览器。前两轮浏览器脚本等待遮罩/确认框时序及桌面 UA 引发误判，均已修正测试配置。尚未验收真实 SSO、真机、浏览器所有分页/资源跳转/权限变化场景；授权有效资源详情 HTTP 已在业务链负载测试验证。

HTTP 基线 r89-c4a8474c：200 条链路、2 位真实测试成员、400 HTTP、19.956s、20.044 RPS，成功 400/400、200/200 链路，HTTP avg/P50/P95/P99/max=33.16/29.45/59.12/81.55/95.21ms；chain avg/P95=66.35/109.59ms，最大并发链 3、最大调度偏差87ms。Inbox SUCCESS400、线索200、客户200、1200 明细 sourceKey 唯一且未抑制、40批次（站内20 / mock WECOM20）、Token1、SSE ID 20/20 无重复、Outbox 0、请求结束后清空与对账4050ms。两个成员授权客户详情分别12/11条、静态事件标签和安全链接通过。相对于各渠道600条原始意图，摘要输出减少96.67%。20s 区间 API/Worker 各21个 ps 进程 CPU/RSS 样本（86–20016ms）：API CPU峰58%、RSS峰315.0MiB；Worker CPU峰56.4%、RSS峰332.9MiB，分别为单进程口径，非整机 CPU、容器资源或生产可比数据。压测后首次观测 Outbox28，未测全程积压峰值。

验收发现两处真实缺陷并修复：清理确认 DTO 保留原始 JSON 值，避免全局 implicit conversion 将字符串 false/true、数字1等转换为布尔真；仅 literal true 可授权，真实 HTTP 测试拒绝 false、字符串、数字、null、缺失。全新租户事件模板首次并行初始化同一表单时出现 25P02（旧代码捕获 unique violation 后在已中止事务中继续查询）；慢路径 ensureForm 先取 tenant 级事务 advisory lock，再读取/创建/修复，正常已初始化表单读取不增加锁，避免多表单相反顺序加锁；真实 API 冷启动后通过模板创建和400请求。该修复不修改业务字段或迁移。

R8.9 当前：R8.9.1 真实服务冒烟/20 RPS 业务链通过；R8.9.2 基础浏览器交互通过（真机/SSO及完整权限场景未完）；R8.9.3 独立真实 Provider mock 故障注入高并发待验；R8.9.4 20 RPS 基线通过；R8.9.5 50 RPS 持续与200突发、R8.9.6 整机/PG/Redis资源与生命周期吞吐、R8.9.7 发布审查仍待执行。隔离测试不等同生产容量或真实终端收件证明。生产聚合、频控、自动归档保持0；去重到期不自动删除；不提交、不发布、不修改生产。

### 10.13 R8.9 持续负载、突发、故障恢复与生命周期实测（2026-11-27）

在 §10.12 真实服务隔离验收脚本基础上，增加独立可复跑模式（仓库根目录，API 已构建，所有测试使用新建隔离 PG/Redis 容器及 loopback mock，结束清理本轮容器）：

- `R89_HTTP_LOAD=1 R89_LOAD_PROFILE=burst200 pnpm --filter @micromatrix/api test:notification-e2e-isolated`：200 个独立线索创建 HTTP 请求同时提交。
- `R89_HTTP_LOAD=1 R89_LOAD_PROFILE=steady50 pnpm --filter @micromatrix/api test:notification-e2e-isolated`：25 条创建→转换链/秒，持续60秒，目标50 HTTP RPS。安全阈值128条在途链，业务失败停止新发请求，等待已发请求完成。
- `R89_FAULTS=1 R89_LIFECYCLE=1 pnpm --filter @micromatrix/api test:notification-e2e-isolated`：真实 HTTP provider 明确拒绝、实际 Worker 重启、按原定时任务恢复；去重凭据大批量预览及两次明确确认。不得在普通生产/开发库运行该隔离脚本。

**突发 r89-8fa16aec（PASS）**：200/200 HTTP，200线索、Inbox SUCCESS200、无转换；973ms 完成，HTTP avg/P50/P95/P99/max=685.94/657.92/940.72/951.82/954.47ms，最大同时在途200，最大调度偏差18ms。400明细、12批次（SYSTEM6、WECOM6），SSE ID 6/6、Token1、发送账本6、摘要减少97%。观测 Outbox 峰200、最老等待6267ms，排空及对账14267ms。应用滚动1秒预约峰2、成员滚动60秒峰3/3。

**持续 r89-4ee123b2（数据完整性通过，长期稳态容量未通过）**：1500/1500链、3000/3000 HTTP、60.006s、49.995 RPS；HTTP avg/P50/P95/P99/max=23.26/23.20/34.17/43.09/128.41ms，chain avg/P95=46.54/60.43ms，最大同时在途链5、最大调度偏差9ms。Inbox SUCCESS3000、线索1500、客户1500、9000双渠道明细且 sourceKey 全唯一、168批次（SYSTEM84、WECOM84）、SSE ID84/84、Token1、预约84、投递 attempts 全1；应用滚动1秒预约峰4、两成员滚动60秒峰24/24。相对4500原始意图/渠道，摘要减少98.13%；投递记录创建至 sentAt avg/P95/max=385.63/1044/1069ms（不含 Outbox 与5s聚合等待）。请求结束至清空和对账45687ms。首轮 r89-018cd9ab 已执行完整请求和排空但断言 Token 必须为1失败：API/Worker均可执行到期投递，进程级缓存允许各取一次；已更正无故障单应用最多两进程各一次的测试断言，未修改缓存机制。通过轮实际1次。

**容量缺口（发布审查明确未关闭）**：50 RPS业务链每秒产生约75个 Outbox 意图，观测积压 0/286/530/788/1023/1289/1522（0/10/20/30/40/50/60秒），结束后70/80/90/100秒为1114/704/314/0，最老等待峰39645ms。实际消费约40–50意图/秒，无法长期跟上75意图/秒。日志满批200意图的 prepare约100–170ms、persist约3.2–4.5s，持久化占主要耗时。优先优化 appendMany 批量来源查重、身份校验和分组批量写入，在维持 recipient/source/scope、5秒窗口、500上限、事务回滚及权限语义不变前提下复测；不能只增大扫描并发、扩大窗口或放宽频控。负载期间继续使用接收入窗时间，不等于原始事件发生时间；持续积压导致批次数增加。50 RPS通过短时业务与对账不等于稳态吞吐或生产可启用。

**资源**：burst API/Worker各8个样本，CPU峰61.2/44.3%、RSS峰285.25/278.16MiB；PG/Redis容器CPU峰16.28/1.98%，内存观测117/10.59MiB。steady API/Worker各53个样本，CPU峰63.1/67.8%、RSS峰450.52/454.06MiB；PG/Redis容器CPU峰56.11/2.02%、内存观测126.6/10.79MiB；采样覆盖请求及排空阶段（最后约104秒，随后完成最后对账）。ps 为单进程口径，docker stats 为容器口径，不是整机、生产2核服务器、磁盘IO或PG连接池容量结论。异步采样间隔约2秒，峰值均为观测值，短时峰值可能未捕获。

**故障 r89-bac0f863（PASS）**：真实模拟HTTP返回40014及45009各一次，两条FAILED attempts1，持久化下一次尝试；无inline POST重放。停止本轮Worker再启动新Worker，新增聚合投递在冷却时PENDING/attempts0，下一次时间不早于冷却到期；不改数据库时间/重试时间，实际定时恢复。故障阶段共5 POST（2拒绝+3成功）、最终三条 SUCCEEDED attempts[1,2,2]、冷却60s、Token2、账本与所有实际POST对账、总74.308s。尚未模拟真实网络未知结果、长时间故障/大规模故障注入，不承诺Provider exactly-once。

**手动清理 r89-bac0f863（PASS）**：5001条合成过期凭据+1条未到期；生命周期 sweep扫描10批、0自动删除，70.31ms。真实鉴权HTTP预览5000条38.26ms；用户确认语义请求删除5000条55.90ms；剩余1条需第二次确认，未到期1条保留。未运行自动到期归档（保持关闭），不是50批满负荷归档/历史百万批清理吞吐测试，亦不改变用户禁止自动删除墓碑的决策。

R8.9 当前：R8.9.1 真实服务通过；R8.9.2 PC/H5基础浏览器通过（SSO/真机及更多浏览器权限场景仍待）；R8.9.3 明确拒绝/重启/冷却真实HTTP恢复通过（网络未知结果及大规模故障待）；R8.9.4 20 RPS基线通过；R8.9.5 200突发及50 RPS业务完整性通过，50 RPS长期稳态容量缺口仍在；R8.9.6 局部资源与手动清理通过、整机/连接池/大历史归档吞吐待；R8.9.7 审查结论：尚不能开启生产聚合/频控，建议先完成聚合写入优化及同条件复测，不将阶段版本发布等同生产启用。保持所有生产开关0，未提交/发布/部署。

### 10.14 R8.10 聚合批量持久化优化（2026-11-27）

appendMany 改为真正的批量写入：按来源键组内去重、保持结果顺序；先获取排序后的 recipient/source 锁，批量查明细及墓碑（每次最多500键），未人工删除的过期墓碑仍有效。事务内按租户、成员、凭据版本、外部账号复用身份校验，完整作用域分组，DB时钟及scope锁确定5秒窗口，跨窗口重新计算，500条分片上限不变。每批 createAll 明细及一次条件计数更新，按来源键匹配返回ID；单条 append 复用批量路径。保留事务回滚、退避隔离、即时通知、频控、权限及手动清理语义；无数据库结构变更。批量同组共享接收时间，不承诺跨组输入执行次序。

真实PG新增专项：498条旧分片追加4条独立及1条重复（500+2）；逆序竞争多租户/成员组；组内重复及ID映射；无聚合事件；错误映射与调用方回滚；凭据版本变更后重新校验；未人工删除过期墓碑；实际scope锁阻塞跨窗口后移入新窗口、旧分片计数不变。

**50 RPS × 60秒同条件复测 r89-5fb6a089 PASS**：1500链，3000/3000 HTTP，60.005s，49.996 RPS，HTTP avg/P50/P95/P99/max=23.31/22.39/35.17/43.29/61.78ms。Inbox3000、线索1500、客户1500、9000唯一来源双渠道明细，104批次（站内52、mock企微52），Token1、SSE ID52/52、投递attempts全1，应用秒峰4、成员分钟峰24/24。摘要减少98.84%。Outbox观测峰1522→70（-95.40%），最老任务39.645→2.285s（-94.24%），排空及对账45.687→4.457s（-90.24%），投递记录创建至sentAt平均385.63→82.60ms（不含Outbox及聚合等待）。积压抽样0/59/35/50/26/50/65/0（约0/9/19/29/39/49/59/63s）。两轮日志各4530意图（含30冒烟），0重试/0回退组；持久化累计83483.07→30424.99ms，平均18.43→6.72ms/意图，降低63.56%，含组内认领/写入，不是孤立SQL基准。API/Worker CPU峰63.1/67.8→56.8/46.0%，RSS峰450.52/454.06→472.45/394.75MiB；PG容器CPU峰56.11→50.25%，内存126.6→123.5MiB，Redis CPU峰2.02→1.71%。API RSS略增。优化后各33个样本，非生产整机或连接池容量结论。

**200事件突发复测 r89-1ddbbc4f PASS**：200/200 HTTP、200线索、862ms完成、瞬时完成吞吐231.953 RPS，HTTP avg/P95/P99/max=604.54/818.79/826.73/828.91ms，400明细、8批次（站内4、mock企微4），SSE ID4/4，Token1，应用秒峰2、成员分钟峰2/2。Outbox峰200，排空及对账14.267→8.320s。采样未捕获最老任务非零峰，不解释为真实零等待。固定窗口对齐影响批次数，不将批次减少全部归因于算法。

结论：50 RPS×60秒有限持续测试的聚合写入积压缺口已关闭，仍不承诺更长期或生产2核稳态容量；真实企微/SSO、生产资源及长历史归档吞吐待验。建议进入v0.2.53发布前最终整理，首发保持聚合、频控、自动归档关闭；去重凭据必须手动确认删除。未提交、发布或操作生产。
