# W3.7-9.4E DB-012 Webhook 专项验收

验收日期：2026-09-02

## 1. 关闭范围

本次关闭 DB-012 9.4E：

- `ApprovalPostConfig.webHookConfig` Shared/DTO/Flow write/detail/version compare/实例冻结契约；
- `POST /api/approvals/flows/webhook/test` 安全连接测试；
- GET/POST Webhook 请求、业务字段占位符解析和运行时发送；
- pass/reject/AUTO_PASS/ANY/ALL 节点完成点单次发送；
- 9.4D 字段后置更新完成后读取最新业务值再发送 Webhook；
- runtime Webhook 失败只记录发送失败，不回滚已完成审批状态机；
- Migration 68 `approval_webhook_deliveries` 作为 TEST/RUNTIME 发送审计真相源；
- SSRF、内网目标、DNS rebinding、redirect、超时、响应上限、危险 Header 和敏感日志等安全边界。

9.4F 的 Vue Flow 条件图/高级设置 UI、全部调用方统一 `nodes + links` 写契约以及旧线性 payload 自动推导清理仍未关闭，因此 DB-012 继续保持 `IN_PROGRESS`。

## 2. Cordys 对齐与安全补强结论

- Cordys `WebHookConfig` 的真实配置字段为 `webHookEnable/webHookUrl/webHookMethod/webHookHeader/webHookBody/webHookDescribe`，并与字段更新共同属于 pass/reject `ApprovalPostConfig`。
- Cordys 在节点完成后异步调用 Webhook，GET URL 和 POST JSON body 均支持业务字段占位符，并提供 `/approval-flow/webhook/test` 连接测试。
- MicroMatrix 保留上述业务语义，但不复制 Cordys 任意 URL 请求和原始请求/响应日志行为；R11 明确要求增加安全边界。
- enabled 配置只允许 HTTP/HTTPS + GET/POST，禁止 URL userinfo/fragment；header 必须为 string→string JSON object，禁止 `Host/Content-Length/Transfer-Encoding/Connection/Upgrade/proxy-*` 等 framing/hop-by-hop 头；POST body 必须为合法 JSON。
- 每次请求前重新解析 hostname；只要任一候选地址命中 loopback、RFC1918、link-local、CGNAT、ULA、multicast、unspecified、documentation/reserved、IPv4-mapped IPv6 或 NAT64 非公网目标即 fail-closed。
- 实际 socket lookup pin 到已经校验的公网地址，避免 DNS 校验后 rebinding；redirect 被禁用。
- 单次请求默认 5 秒超时，响应最多 64 KiB；header JSON 上限 16 KiB，请求 body 上限 64 KiB。
- 测试连接和 runtime 使用同一个 `ApprovalWebhookClient`，业务 Controller/Service 不直接 `fetch(userUrl)`。
- 隔离 Smoke 只在 `NODE_ENV=test + APPROVAL_WEBHOOK_TEST_ALLOW_LOOPBACK=1` 时允许 loopback mock server；该测试旁路不放行其他私网地址，生产路径无此旁路。

## 3. Schema、FlowVersion 与审计

- Migration 68 新增 `ApprovalWebhookDeliverySource(TEST/RUNTIME)`、`ApprovalWebhookDeliveryStatus(PENDING/SENT/FAILED)` 和 `approval_webhook_deliveries`。
- 审计记录保存 tenant、instance/flow/version/node/action/source/method、HTTP status、响应字节数、耗时和稳定错误摘要。
- 审计不保存 Authorization/Cookie/API Key、header/body/query、response body；目标 path 也只保存 redaction marker，避免 token 出现在路径或查询参数中。
- `ApprovalWebhookConfig` 已进入 Shared、DTO、Flow normalize/version compare/detail 和 `nodesSnapshot`。在途实例只读取创建时冻结配置，后续修改当前 FlowVersion 不影响旧实例。
- webhook-only post config 可以保存；disabled 配置保留 round-trip，但不执行网络请求。

项目从未发布，本次 Migration 68 不增加历史 Webhook delivery backfill。

## 4. 占位符与 Runtime 顺序

9.4E 支持当前四个审批业务资源顶层字段：

- `${quotation.id}` / `${quote.id}`；
- `${contract.id}`；
- `${invoice.id}`；
- `${order.id}`；
- 系统字段支持 metadata `key`；
- 自定义字段同时支持 field key 和 fieldId。

GET 对每个占位符值做 URL encode；POST 对 JSON 字符串节点递归替换，整值占位符可保留 number/boolean/null 类型。未知占位符 fail-closed 并记录 FAILED，不用空字符串静默吞掉配置错误。

节点完成顺序固定为：必要时 DB-010 restore → 9.4D field update → 读取更新后业务值 → 创建 PENDING delivery → 后台发送 → SENT/FAILED 审计。ANY 只在节点首次真正完成时发送一次，ALL 只在最后一名审批人完成时发送一次，AUTO_PASS 发送一次，SIGN 不独立触发。

## 5. Rules / isolated HTTP

完整 Rules 最终结果：**141/141 PASS**。新增规则覆盖：

- Webhook config normalize/version compare 和 webhook-only post config；
- enabled GET/POST、URL/header/body 校验；
- framing/hop-by-hop header gate；
- loopback、私网、保留地址、IPv4-mapped IPv6、NAT64 等 SSRF 地址分类；
- 公网 IPv4 地址仍可正确通过地址分类。

`pnpm --filter @micromatrix/api smoke:w370-db012-webhook` 从隔离 PostgreSQL 执行 **68/68 migrations + Seed + Shared/API build**，最终稳定结果 PASS：

```text
testConnectionPostGet        PASS
privateTargetGate            PASS
forbiddenHeaderGate          PASS
redirectDisabled             PASS
responseLimitGate            PASS
timeoutGate                  PASS
webhookAuditRedaction        PASS
frozenWebhookVersion         PASS
postFieldBeforeWebhook       PASS
rejectGetPlaceholder         PASS
allNodeSingleSend            PASS
autoPassWebhook              PASS
runtimeFailureNonBlocking    PASS
```

专项 Smoke 使用仅测试环境可开启的 loopback mock，并额外验证默认私网目标拒绝；生产安全判断没有测试旁路。

## 6. 相邻审批回归

- DB-010 regression：PASS。
- DB-011 9.3A task/record migration smoke：PASS。
- DB-011 9.3B add-sign、9.3C return-back、9.3D approver revoke、9.3E attachment/comment HTTP：全部 PASS，专项脚本已同步当前 **68 migrations** 基线。
- DB-012 9.4A Condition HTTP：PASS，**68 migrations**。
- DB-012 9.4B approver policy HTTP：PASS，**68 migrations**。
- DB-012 9.4C field permission HTTP：PASS，**68 migrations**。
- DB-012 9.4D post field HTTP：PASS，**68 migrations**。

9.4E 没有提前开放新的流程设计器 UI，因此本单元不新增 Browser 验收。最近相邻 UI 基线继续为 9.4C Field Permission PC/Mobile **21/21**、9.3E Browser **28/28**、9.4A Condition Browser **14/14** 与 `/system/modules` **47/47**。

## 7. 全局封板证据

- Root Smoke：**227/227 PASS**。
- Rules：**141/141 PASS**。
- 隔离空库：**68/68 migrations + Seed 2/2**，Seed 计数稳定，运行时关键资源检查全部通过。
- workspace typecheck：PASS。
- ESLint：PASS。
- Shared/API/Web production build：PASS；Web **4144 modules transformed**。
- Prisma validate：PASS。
- `git diff --check`：PASS。

验证期间继续确认 live API `tsc --watch` 与 isolated Smoke / production build 会共同重建 `apps/api/dist`。最终专项和静态封板期间仅暂停 API TypeScript watcher，保留 `node --watch dist/main.js` 及原开发进程链；所有验证结束后恢复 watcher。该处理仅规避验证环境对同一 build 目录的并发竞争，不属于业务代码兼容分支。

## 8. 结论

W3.7-9.4E 已满足 Cordys Webhook 配置/测试连接/运行时语义，并完成 R11 要求的 SSRF、内网目标、DNS pin、超时、响应限制和敏感审计补强；Migration、Rules、专项 HTTP、相邻审批回归、Root、空库与静态构建证据齐全，可以标记完成。

DB-012 继续 `IN_PROGRESS`。

下一执行单元：**W3.7-9.4F Vue Flow 条件图、更多设置开放、统一 `nodes + links` 写契约迁移与旧线性 payload 自动推导清理**。
