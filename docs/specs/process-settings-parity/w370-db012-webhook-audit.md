# W3.7-9.4E DB-012 Webhook 源码审计

审计日期：2026-09-02

## 1. 范围

本单元只关闭 DB-012 的 Webhook 配置、连接测试、安全 HTTP client、审批运行时发送和发送审计。

9.4F 的 Vue Flow 高级配置 UI、统一 `nodes + links` 写契约迁移和旧线性 payload 自动推导清理不在本单元提前实施。

## 2. Cordys 源码事实

Cordys `WebHookConfig` 保存以下字段：

- `webHookEnable`：是否启用；
- `webHookUrl`：Webhook 地址；
- `webHookMethod`：`GET / POST`；
- `webHookHeader`：请求头 JSON 字符串；
- `webHookBody`：POST 请求体 JSON 字符串；
- `webHookDescribe`：说明。

`ApprovalPostConfigDTO` 同时包含 `fieldUpdateConfigs` 与 `webHookConfig`，因此 Webhook 与 9.4D 字段更新属于同一个 pass/reject 后置配置快照。

Cordys 运行时事实：

- 审批节点真正完成后异步发送 Webhook；
- pass/reject 使用各自的 post config；
- `GET` URL 支持 `${...}` 业务字段占位符，并做 URL encode；
- `POST` body 为 JSON，并递归替换字符串节点中的 `${...}` 占位符；
- 提供 `/approval-flow/webhook/test` 连接测试；
- 前端明确提示“后台异步执行，前端不展示响应结果”。

Cordys 原实现直接记录原始 URL、解析 URL、请求体与响应体，并直接向用户 URL 发起请求；没有形成足够严格的 SSRF、私网地址、DNS rebinding、响应大小和敏感材料日志边界。

## 3. MicroMatrix 当前现场

9.4D 结束后：

- `ApprovalNodeApprover.passPostConfig/rejectPostConfig` 已持久化 JSON；
- Shared/DTO/FlowVersion 比较/实例 `nodesSnapshot` 已承载 `fieldUpdateConfigs`；
- runtime 已在人工 APPROVE、REJECT、AUTO_PASS 和 ANY/ALL 节点完成点执行字段后置动作；
- UPDATE reject 已固定为“先恢复 DB-010 快照，再执行 reject post”；
- 尚无 `webHookConfig` Shared/DTO/normalize/validation；
- 尚无连接测试 API、安全 HTTP client、运行时发送和发送审计表。

## 4. 安全边界决定

MicroMatrix 不机械复制 Cordys 任意 URL 请求实现。9.4E 固定以下边界：

1. 仅允许 `http:` / `https:`，仅允许 `GET` / `POST`；禁止 URL userinfo、fragment 和无 hostname URL。
2. hostname 必须先解析；所有候选地址只要命中 loopback、link-local、RFC1918、CGNAT、ULA、multicast、unspecified、documentation/reserved 等非公网地址即拒绝。
3. 实际请求使用预解析地址并通过自定义 `lookup` pin 到已校验公网 IP，避免校验后 DNS rebinding；不自动跟随 redirect。
4. 请求头必须是 JSON object；拒绝 `host/content-length/transfer-encoding/connection/upgrade/proxy-*` 等 hop-by-hop 或可破坏 framing 的头。
5. POST body 必须是合法 JSON；配置与运行时请求体上限 64 KiB，请求头 JSON 上限 16 KiB。
6. 单次请求默认 5 秒超时；响应体最多读取 64 KiB，超过上限主动中止并记失败。
7. 2xx 视为连接/发送成功；非 2xx 记失败，不要求第三方必须返回 JSON。
8. 审计表不保存原始 Authorization/Cookie/API Key/header/body/query 参数/response body，也不保存可能承载 token 的 URL path；只保存 method、origin、path redaction marker、HTTP status、响应字节数、耗时和安全错误摘要。
9. 测试连接和 runtime 均走同一个安全 client，禁止 Controller/Service 直接 `fetch(userUrl)`。
10. 测试环境只有在 `NODE_ENV=test` 且显式 `APPROVAL_WEBHOOK_TEST_ALLOW_LOOPBACK=1` 时允许 loopback，用于 isolated HTTP mock server；该旁路不放行 RFC1918 等其他私网地址，生产路径没有该旁路。

## 5. 占位符契约

9.4E 支持顶层审批业务字段，不提前扩展复杂子表：

- `${quotation.id}` / `${quote.id}`；
- `${contract.id}`、`${invoice.id}`、`${order.id}`；
- 系统字段按 metadata `key`；
- 自定义字段同时支持 field `key` 和 fieldId。

GET 在 URL 中插值后按单值 URL encode；POST body 对 JSON 字符串节点递归插值：整值仅为一个占位符时保留 number/boolean/null 类型，混合文本时按字符串替换。

未知占位符 fail-closed，运行时发送记 FAILED，不用空字符串静默吞掉配置错误。

## 6. 运行时顺序

节点完成顺序固定为：

1. 必要时执行 DB-010 restore；
2. 执行 9.4D field updates；
3. 读取更新后的真实业务字段并冻结生成本次 Webhook 请求；
4. 创建 Webhook delivery 审计记录；
5. 后台异步发送；
6. 更新 delivery 为 SENT / FAILED；
7. 主审批状态机继续推进，不因为第三方失败回滚审批。

ANY 只在首个真正完成节点的审批动作发送一次；ALL 只在最后一个待办完成时发送一次；AUTO_PASS 发送一次；SIGN 不独立触发节点 Webhook。

## 7. 结论

9.4E 应在现有 `ApprovalPostConfig` 上补 `webHookConfig`，新增独立安全 client/service 和 `approval_webhook_deliveries` 审计真相源，并把测试连接与 runtime 全部收口到同一发送边界。完成后下一执行单元进入 9.4F。
