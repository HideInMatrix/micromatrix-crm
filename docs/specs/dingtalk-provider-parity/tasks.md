# DB-015A 钉钉 Provider 对齐任务

当前状态：**VERIFIED**。

- [x] T1 Cordys 源码审计与 DB-015 拆分
  - [x] 配置/Token/组织 API。
  - [x] OAuth unionId → userid。
  - [x] 工作通知 payload。
  - [x] DB-015 拆分为 015A DingTalk / 015B Lark。

- [x] T2 配置与 Client
  - [x] baseline / Prisma 字段：`EnterpriseIntegration.clientId`、`MessageTaskSetting.dingTalkEnabled`、`ExternalOAuthFlow.QR_DINGTALK/DINGTALK` 已并入唯一 `20260905084900_baseline`。
  - [x] DingTalkClient token/test：企业 token、部门/成员、OAuth、unionId→userid、工作通知均已实现并纳入专项测试。
  - [x] 配置 API、Secret 生命周期和 Web 卡片：CorpId / AppKey / AgentId / Secret、加密保存、连接测试、同步开关均已接入。

- [x] T3 组织同步
  - [x] DingTalk snapshot：递归部门、成员分页、`dept_id_list` 第一项主部门语义与 Cordys 一致。
  - [x] provider-aware sync runtime：WECOM / DINGTALK 复用 Planner/Batch/Apply，但使用独立 provider 映射与 coordination key。
  - [x] 映射/冲突/应用回归：真实 Nest + fresh PostgreSQL + local DingTalk mock 已完成 preview/apply 并创建本地成员与 DINGTALK mapping。

- [x] T4 OAuth / 外部身份
  - [x] state/discovery/start/callback：QR 与 Workbench 使用独立 flow/cookie，state hash + browser nonce + TTL + 单次消费。
  - [x] unionId → userid → mapping → ExternalIdentity：真实 API smoke 已验证 ACTIVE identity、lastLoginAt 与 replay fail-closed。
  - [x] PC/容器登录与审计：PC callback/workbench route、DingTalk UA guard、Mobile workbench start 与 DINGTALK/DINGTALK_OAUTH2 登录审计已接入。

- [x] T5 消息 Provider
  - [x] dingTalkEnabled channel gate。
  - [x] MessageDelivery enqueue/worker/retry/provider 审计：独立 DINGTALK mapping、task_id、重试/DEAD 状态机与成功记录禁止重试均已验证。
  - [x] 消息设置 UI 与投递记录：事件开关、DingTalk gate、channel-aware delivery drawer 均已接入。

- [x] T6 验收与文档封板
  - [x] 专项 + Rules + fresh baseline：DB-015A/邻接专项 26/26，Outbox 8/8，完整 API Rules **250/250 PASS**；frontend-shared `/auth/me` refresh 回归 **4/4 PASS**；fresh baseline + Seed PASS，DB→Schema `No difference detected.`。
  - [x] typecheck/lint/build/Prettier/diff-check：最终 root typecheck/build PASS，lint **0 error / 8 个既有 warning**，Prisma format/validate PASS，当前变更集 Prettier 与 `git diff --check` PASS。
  - [x] Browser/API fail-closed smoke：真实 Nest + fresh PostgreSQL + local DingTalk mock API smoke **33/33 PASS**；新版 Workbench Host Browser（`desktop_chromium_cdp`）已真实完成 DingTalk 登录入口、配置/连接测试、组织同步结果与重复预览幂等、OAuth callback→JWT→Dashboard、消息设置及“已送达”投递记录验收。Mobile workbench OAuth 后端由同轮 33/33 runtime 覆盖，Mobile production build/typecheck PASS；后续再次新建 Host Browser 时 broker 出现统一 timeout，仅记为 Workbench 运行期工具异常，不推翻已取得的 Browser 证据。
  - [x] DB-015A 正式封板为 VERIFIED；下一执行单元为 DB-015B Lark。
