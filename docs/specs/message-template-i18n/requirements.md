# DB-008 消息模板与多语言资源需求

状态：`VERIFIED`

## 1. 来源与边界

本执行单元以项目内 `CordysCRM/` 当前源码为第一事实来源，重点对齐：

- `NotificationConstants.Module / Event / TemplateText`
- `MessageTemplateUtils`
- `Translator`
- `CommonNoticeSendService / NoticeSendService / AbstractNoticeSender`
- `cordys-crm_zh_CN.properties / cordys-crm_en_US.properties`
- `LocalLanguageService / User.language`

源码审计确认：Cordys 的消息模板是代码常量引用 i18n resource key，再使用 `${param}` 变量渲染；消息设置页没有租户自定义模板编辑器。因此 DB-008 **不得新增 MessageTemplate Prisma 表或租户模板管理 UI**。

本轮只对齐“通知消息模板与通知语言偏好”，不把整个 PC/Mobile UI 国际化纳入范围。

## 2. 功能要求

### R1 用户语言偏好

- `User` shall 持久化 `language`，首批只接受 `zh-CN / en-US`，默认 `zh-CN`。
- `/auth/me` 与个人中心 info shall 返回当前 `language`。
- 个人中心编辑 shall 可以修改语言；写入后立即进入后续通知渲染上下文。
- pre-release 数据库继续只有唯一 `20260905084900_baseline`，不得为 DB-008 新增第二条 migration。

### R2 消息资源与模板注册表

- 后端 shall 建立 `zh-CN / en-US` 两套资源，事件名与正文语义以 Cordys properties 为基线。
- 当前 `MessageTaskEvent` 的 47 个事件 shall 都有稳定事件名资源；有 Cordys `_TEXT` 的事件 shall 有默认正文模板。
- 系统消息默认标题 shall 按 Cordys 规则生成：`事件本地化名称 + notice.event.subject`。
- 公告继续使用 DB-007 自身标题，不经过事件标题拼接。

### R3 模板渲染

- renderer shall 支持 `${key}` 变量替换。
- `null / undefined` 上下文值 shall 视为空字符串。
- key 以 `Time` 结尾时，若可解析为时间 shall 格式化为 `yyyy-MM-dd HH:mm:ss`。
- key 以 `User` 结尾时 shall 支持通过当前租户用户的邮箱/手机号解析为姓名；无法解析时保持原值，不阻断消息发送。
- 未提供的变量 shall 保持 `${key}` 原样，避免静默生成误导文本。

### R4 通知发送语言

- 与 Cordys 一致，业务通知 shall 使用**操作者 language**渲染一次后发送给本次全部接收人，而不是按每个接收人分别翻译。
- 没有有效操作者（Cron/系统动作）时 shall 默认 `zh-CN`。
- 同一次业务事件的站内 Notification 与外部 MessageDelivery shall 复用完全相同的已渲染 title/content。

### R5 现有业务通知迁移

- `BusinessNotificationsService` shall 成为 MessageTaskEvent 默认模板渲染入口。
- 当前已经接入 MessageTaskEvent 的客户、线索、商机、联系人、池回收、跟进计划/评论、报价/合同到期与审批结果等链路 shall 迁移为 `event + templateContext`，不再各自维护同语义中文正文。
- 与 MessageTaskEvent 无对应关系的加签、退回等专用审批通知可以继续保留专用文本，不得为通过 DB-008 伪造 Cordys 事件。

## 3. 非目标

- 不新增租户消息模板数据库表。
- 不新增“消息模板管理”页面。
- 不在本轮把整个 Web/Mobile UI 翻译为英文。
- 不实施邮件、钉钉、飞书 Provider；它们分别由既有 backlog 跟踪。

## 4. 验收门槛

- Message renderer 专项测试覆盖中/英资源、title、变量、null、Time、User、fallback。
- BusinessNotifications 专项覆盖操作者语言、系统默认语言、站内/企微同文。
- User language API 与个人中心 Browser 实测通过。
- 至少一条真实业务事件在 `en-US` 下产生英文 Notification，再切回 `zh-CN` 产生中文 Notification。
- Prisma validate/generate、fresh baseline + Seed、API Rules、root typecheck/lint/build、Prettier、`git diff --check` 全绿。

## 5. 最终验收

- 2026-09-08：专项 **21/21 PASS**，API Rules **238/238 PASS**。
- fresh baseline + Seed PASS，Prisma validate PASS，database→schema diff=`No difference detected.`。
- PC/Mobile + 真实 API Browser **52/52 PASS**；英文/中文 `CUSTOMER_ADD` Notification 均由真实业务链生成，API 5xx=0、Runtime exception=0。
- root typecheck/build PASS；lint 0 error / 8 个既有 warning；Prettier 与 `git diff --check` PASS。
