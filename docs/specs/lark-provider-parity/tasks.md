# DB-015B 飞书 Provider 对齐任务

当前状态：**VERIFIED**。

- [x] T1 Cordys 源码审计与边界冻结
  - [x] 配置字段：企业 ID、App ID、App Secret、redirectUrl。
  - [x] tenant token / tenant info / 部门 / 成员分页协议。
  - [x] `open_id` 用户映射与 `orders.is_primary_dept` 主部门语义。
  - [x] PC QR、LARK OAuth、LARK_MOBILE OAuth 与文本消息协议。
  - [x] Lark Suite 国际版当前 TODO，明确排除。

- [x] T2 配置与 LarkClient
  - [x] Prisma + 增量 migration：`redirectUrl`、`larkEnabled`、Lark OAuth flows；已应用 baseline 保持不可变。
  - [x] tenant token / tenant info / organization snapshot。
  - [x] user OAuth token/profile / text message。
  - [x] 配置 API、Secret 生命周期、连接测试、Web 卡片。

- [x] T3 组织同步
  - [x] `/organization-sync/lark/*` provider-aware API。
  - [x] open_department_id/open_id mapping、主部门、分页、幂等与冲突处理。
  - [x] Web 组织架构飞书同步入口、成员 LARK 身份管理。

- [x] T4 OAuth / ExternalIdentity
  - [x] discovery/start/callback，QR/LARK/LARK_MOBILE flow 与 nonce cookie 隔离。
  - [x] open_id→ACTIVE mapping→ExternalIdentity→JWT。
  - [x] PC 登录/callback、飞书容器与 Mobile 自动 OAuth。

- [x] T5 消息 Provider
  - [x] `larkEnabled` channel gate。
  - [x] MessageDelivery enqueue/send/retry/DEAD/message_id。
  - [x] Message Settings 飞书列、gate 与投递记录。

- [x] T6 验收与封板
  - [x] Provider/配置/同步/SSO/outbox 专项；完整 API Rules **263/263 PASS**。
  - [x] 已有开发库增量 migration PASS；fresh migration history + Seed PASS；两条路径 DB→Schema 均 `No difference detected.`。
  - [x] root typecheck/build PASS；lint **0 error / 8 个既有 warning**；Prisma validate、当前变更集 Prettier、`git diff --check` PASS。
  - [x] local Lark mock + 真实 Nest/PostgreSQL/HTTP **36/36 PASS**；Workbench Host Browser 配置/同步/ExternalIdentity/投递记录闭环 PASS。
  - [x] DB-015B VERIFIED，父 backlog DB-015 同步关闭。

最终 Browser 证据：飞书配置卡显示连接正常并可重新测试；组织同步真实生成 PREVIEW_READY，幂等预览为 `新增0/更新0/禁用0/不变3`，确认应用后进入 `SUCCEEDED`；成员 LARK 身份显示 `open_id=ou_lark_user_1` 与绑定/最近登录时间；消息设置显示 LARK 逐事件 gate，飞书投递记录真实显示“新建客户 → 飞书测试成员 → 已送达 → 1/3”。
