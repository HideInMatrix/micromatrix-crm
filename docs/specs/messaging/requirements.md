# Messaging 与公告需求

## 1. 定位

Messaging 负责站内 Notification、业务事件模板、多语言渲染、实时刷新和公告。第三方 WeCom/DingTalk/Lark 只是可选外部 channel，其凭据与投递适配归 Enterprise Platform；本领域只负责统一事件、正文和站内事实。

## 2. MessageTaskEvent

当前正式事件只覆盖 `CUSTOMER` 与 `CLUE` 两个业务模块，定义以 `packages/shared/src/message-settings.ts` 的 `MESSAGE_TASK_DEFINITIONS` 为唯一事实源。

当前共 26 个事件：Customer 13 个、Clue 13 个。已删除交易模块的 Opportunity/Contract/Order 等事件不得重新进入消息设置或模板注册表。

## 3. 站内 Notification

- Notification 先持久化 PostgreSQL，再触发缓存失效和实时信号。
- unread count、分页列表、单条已读使用统一 Notification 数据模型。
- 外部 channel 失败不得回滚站内 Notification。
- Notification 可通过 sourceType/sourceId 关联公告等来源，支持精确清理/重建。

## 4. 消息模板与语言

- 用户语言当前支持 `zh-CN / en-US`，默认 `zh-CN`。
- 模板注册表由代码资源维护，不创建租户 MessageTemplate 表或模板编辑器。
- renderer 支持 `${key}` 变量；null/undefined 归一为空字符串，未提供变量保留原占位符。
- `*Time` 值按统一日期时间格式输出；`*User` 可在当前租户内把邮箱/手机号解析为成员名称，无法解析时保持原值。
- 一次业务事件按操作者 language 渲染一次；无操作者的系统/Cron 行为默认 `zh-CN`。
- 同一事件的站内 Notification 与外部 MessageDelivery 复用同一份已渲染 title/content/link。

## 5. Message Settings

- 每个 MessageTaskEvent 保存系统、邮件、WeCom、DingTalk、Lark channel gate。
- 外部 channel 是否可启用还要经过对应 Provider configured/verified/enabled gate。
- 更新消息设置必须按 tenant 隔离并要求现有消息设置写权限。
- 业务代码触发通知时只提交 event、接收人、operator/template context，不在各模块重复硬编码同语义中文正文。

## 6. 公告

- 公告按 tenant 保存 subject/content、可选链接、start/end 时间、原始部门/成员选择和最终 receiver snapshot。
- 部门接收范围包含子部门成员；保存时冻结最终成员集合，后续组织变化不改变历史公告范围。
- 当前有效公告立即生成 Notification；未来公告由定时任务发布。
- 编辑公告先清理该 source 的旧 Notification，再按新内容/范围重新发布或等待未来时间。
- 删除公告同时清理其 Notification，但不影响其它来源。
- 公告已读状态直接使用 Notification.readAt，不新增公告已读表。

## 7. 实时刷新

- 新通知、已读变化、公告重建等在数据库提交后失效通知缓存并发布 Redis Pub/Sub 信号。
- SSE 只是在线刷新提示；Redis/SSE 中断不影响 Notification durable 数据。

## 8. 安全与验收

- 事件、模板和 channel gate 必须按当前产品范围维护，不允许旧销售链事件漂回。
- 通知接收人必须属于当前 tenant，外部 delivery 还需 ACTIVE provider mapping。
- 公告跨租户 ID、部门/成员 ID、source 删除必须 fail-closed。
- Messaging 改动至少覆盖模板双语、Notification CRUD/缓存、公告发布幂等、外部 channel gate 和实时刷新。
