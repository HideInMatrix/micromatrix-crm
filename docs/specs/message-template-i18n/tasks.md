# DB-008 消息模板与多语言资源任务

当前状态：**VERIFIED**。

- [x] T1 Cordys 源码审计
  - [x] `MessageTemplateUtils / Translator / NotificationConstants`。
  - [x] `CommonNoticeSendService / NoticeSendService / AbstractNoticeSender`。
  - [x] `zh_CN / en_US` properties 与 `User.language`。
  - [x] 确认无租户模板管理 UI，不新增模板表。

- [x] T2 用户语言偏好
  - [x] User schema + 唯一 baseline。
  - [x] CurrentUser / PersonalCenterVO / update API。
  - [x] PC / Mobile 个人中心语言选择。

- [x] T3 MessageTemplateService
  - [x] 双语事件名与正文资源。
  - [x] `${param}`、null、Time、User 处理。
  - [x] 默认 subject 规则与 locale fallback。

- [x] T4 业务通知接入
  - [x] BusinessNotificationsService 统一 render。
  - [x] 客户/线索/商机/联系人/池/计划评论通知迁移。
  - [x] 到期通知、合同阶段与审批结果迁移。
  - [x] Notification / MessageDelivery 同文验证。

- [x] T5 验收
  - [x] renderer / business notifications 专项。
  - [x] fresh baseline + Seed。
  - [x] API Rules、typecheck、lint、build。
  - [x] Browser 中英语言偏好与真实通知。
  - [x] Prettier / `git diff --check`。

- [x] T6 文档封板
  - [x] backlog / parity / project-progress / alignment-log / docs index。
  - [x] 全绿后标记 `DB-008 VERIFIED`。

最终验收（2026-09-08）：MessageTemplate / BusinessNotifications / 到期 / 审批专项 **21/21 PASS**；完整 API Rules **238/238 PASS**；fresh PostgreSQL 唯一 `20260905084900_baseline` + Seed PASS，Prisma validate 与 database→schema diff=`No difference detected.`；PC/Mobile + 真实 API + headless Chrome CDP Browser **52/52 PASS**，覆盖 PC `zh-CN ↔ en-US`、两次真实 `CUSTOMER_ADD` 中英文 Notification、Mobile 双向语言保存，API 5xx=0、Runtime exception=0；root typecheck/build PASS、lint **0 error / 8 个既有 warning**、Prettier 与 `git diff --check` PASS。
