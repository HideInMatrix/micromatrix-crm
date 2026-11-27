# Messaging 与公告需求

## 1. 定位

Messaging 负责站内 Notification、业务事件模板、多语言渲染、实时刷新和公告。第三方 WeCom/DingTalk/Lark 只是可选外部 channel，其凭据与投递适配归 Enterprise Platform；本领域只负责统一事件、正文和站内事实。

## 2. MessageTaskEvent

当前正式事件只覆盖 `CUSTOMER` 与 `CLUE` 两个业务模块，定义以 `packages/shared/src/message-settings.ts` 的 `MESSAGE_TASK_DEFINITIONS` 为唯一事实源。

事件集合、模块归属、显示名称和默认行为以 `packages/shared/src/message-settings.ts` 的 `MESSAGE_TASK_DEFINITIONS` 为准；已退出的交易模块事件不得重新进入消息设置或模板注册表。

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
- 外部事件新建线索复用 `CLUE_ADD`；外部事件更新线索、更新客户分别使用独立消息事件，默认关闭并由管理员在消息设置中控制。
- 外部事件更新通知只在字段实际存储值发生变化后发送，接收人为当前负责人；无负责人或负责人为调用账号本人时不通知。幂等重放不得重复发送。
- v2 新增和转换事件的通知任务必须随业务事务持久化，由 Worker 异步消费；任务重试不得重复创建站内通知与渠道投递记录，失败任务必须保留并可恢复。通知开关、接收人过滤和渠道投递规则继续生效。

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

## 9. 分类聚合（v0.2.52 目标规格，生产尚未启用）

- CRM 站内通知与真实企业微信通知采用统一分类策略；分类明确的普通业务通知默认 `SAME_CATEGORY`。支持事件级 `SAME_EVENT` / `NONE` 覆盖，未知事件、无事件的系统通知、公告、安全、权限/角色变更、财务/重要审批和 @ 提及独立即时处理。即时不代表绕过渠道额度或网络等待。
- 以明确的事件注册表分类，不凭正文、标题或展示 type 推断。线索动态与客户动态分开；业务待办、普通互动各自独立分类。线索转换属于线索动态，即使现有展示 type 为 system 也不改变分类。重要通知不得混入普通业务汇总。
- 同租户、同成员、同分类/聚合组、同优先级、同语言及同一固定 5 秒窗口才可合并；事件级聚合还要求相同 event。企业微信额外隔离应用、凭据版本、外部接收账号。每批明细上限可限制内存及分页成本，超限拆成后续独立批次，不丢弃。
- 每个渠道先执行原有事件开关、接收成员有效性和渠道 gate 校验，再对合格明细聚合；站内与 WeCom 允许不同明细集合。不启用的新渠道聚合（DingTalk/Lark）维持原样。不得借聚合开启原本关闭的通知，也不得因外部失败撤销站内通知。
- 原始事件、正文、业务链接和渠道结果可追溯；站内列表按可见聚合记录计未读，单个批次已读不影响其他批次，封批后不可追加。窗口内仅一项时保持原消息格式和跳转。多项显示分类摘要及按事件统计，支持 PC/H5 分页查看明细。摘要不暴露受限业务名称，明细和跳转需要当前租户、接收人及业务权限校验；无法校验的明细不得展示敏感内容。
- 明细持久化与消费幂等、封批、渠道认领和重试必须可跨进程/重启恢复。禁止仅用内存定时器承载消息；历史记录不迁移重发，不改历史已读。外部成功仅代表 Provider 接受或接口返回成功，不代表终端已收到。明确拒绝和未知发送结果区分处理，不声称 exactly-once。
- 发送频控以企业微信实际额度和管理员配置为准，不盲目提高并发；超限等待需持久化、可观察，不吞消息。未验证的额度不得当作渠道事实。业务压测可以采用独立模拟 Provider，但最终验收必须包含真实企业微信成员端收到消息。
