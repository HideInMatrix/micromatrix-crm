# W3.7-9.4E DB-012 Webhook 实施计划

## 1. Schema / 契约

1. Shared 新增 `ApprovalWebhookConfig`、`ApprovalWebhookMethod`，并把 `webHookConfig?` 挂入 `ApprovalPostConfig`。
2. DTO 增加 Webhook 配置和测试连接 request。
3. Flow normalize/version compare/detail/实例 snapshot 全量保留 Webhook 配置；disabled 配置允许保存，enabled 配置必须完整合法。
4. 新增 Migration 68：`ApprovalWebhookDelivery`，记录 TEST/RUNTIME、PASS/REJECT、节点、状态、HTTP status、耗时、响应大小和安全错误摘要，不保存敏感 header/body/query/response body。

## 2. 配置校验

1. `webHookMethod` 仅 GET/POST。
2. enabled 时 URL 必填，协议仅 HTTP/HTTPS；URL 长度、header/body 长度有上限。
3. header 必须为 string→string 的 JSON object，拒绝 framing/hop-by-hop 头。
4. POST enabled 时 body 必须为合法 JSON；GET 忽略 body 但不删除配置，保持 Cordys round-trip。
5. URL 安全目标校验最终仍由发送 client 在每次请求前执行，保存期校验不能替代 runtime SSRF gate。

## 3. 安全 Client

1. 新增 `ApprovalWebhookClient`：URL parse、DNS resolve、非公网 IP 拒绝、DNS pin、redirect disabled、timeout、request/response 上限。
2. 新增 placeholder resolver，数据只来自当前实例业务资源和 metadata 字段映射。
3. 所有错误转为稳定错误码与脱敏 message；不记录 raw URL query/header/body/response body。

## 4. API / Runtime

1. 新增 `POST /api/approvals/flows/webhook/test`，要求 `system:process:update`。
2. 测试连接同步执行安全请求并写 TEST delivery audit，2xx 返回成功；失败返回 400/502 类业务异常且 audit 保留。
3. `ApprovalsService` 在 9.4D 字段后置动作完成后 queue Webhook；主审批请求不等待第三方网络结果。
4. runtime delivery 先落 PENDING，再异步执行，最终标 SENT/FAILED。
5. pass/reject/auto-pass/ANY/ALL 与 UPDATE reject restore→post 顺序必须保持。

## 5. 验收

1. Rules：normalize/version compare、disabled round-trip、method/url/header/body validation。
2. isolated HTTP：68 migrations + Seed + 本地 webhook mock；测试连接 GET/POST、placeholder、runtime pass/reject/auto-pass/ALL 单次、冻结版本、UPDATE reject final value。
3. 安全专项：localhost/private target 默认拒绝、userinfo/redirect/hop-by-hop header/oversize response/timeout fail-closed；test-only loopback override 只在 test 环境生效。
4. 审计专项：SENT/FAILED、source/action/node/status/httpStatus/bytes/duration 正确；数据库不出现 Authorization/Cookie/body secret。
5. 回归：DB-010、DB-011 A～E、9.4A～D、Root、空库双 Seed、typecheck/lint/build、Prisma validate、`git diff --check`。

## 6. 收尾

更新 `tasks.md`、advanced audit/plan、project-progress、alignment-log、parity、deferred backlog；9.4E 真实证据齐全后标记完成并把唯一执行指针切换到 9.4F。
