# DB-015A 钉钉 Provider 对齐设计

状态：`VERIFIED`

## 1. Cordys 事实

- `DingTalkThirdConfigRequest`：`agentId`（AppKey/ClientId）、`appSecret`、`corpId`、`appId`（内部应用 AgentId）、`startEnable`。
- 企业 access token 由 AppKey/AppSecret 获取；OAuth user token 使用 authorization code。
- OAuth 用户先得到 unionId，再通过企业 token 映射为 userid。
- 部门树从根 `dept_id=1` 递归 `listsubid`；部门详情 `department/get`；成员 `user/list` 分页。
- 工作通知使用 `asyncsend_v2`，payload 为 `agent_id + userid_list + text`。

## 2. MicroMatrix 复用边界

继续复用 provider-scoped 直接模型：`EnterpriseIntegration`、部门/成员 Mapping、`ExternalIdentity / ExternalOAuthState`、SyncBatch/Item/Conflict 与 `MessageDelivery`。Provider client 与登录协议独立实现，不把 WeCom client 扩成大条件分支。

## 3. EnterpriseIntegration 字段

新增 nullable `clientId`：DINGTALK `clientId` = AppKey，DINGTALK `agentId` = 内部应用 AgentId，`corpId` = CorpId，现有 encrypted Secret = AppSecret。这样不会把 Cordys 的两个 ID 压缩进同一字段。

## 4. Runtime 结构

- `DingTalkClient`：token、connection test、组织快照、OAuth identity、文本消息。
- `EnterpriseIntegrationsService`：新增 DingTalk CRUD/runtime context，Secret 生命周期继续复用既有安全逻辑。
- `OrganizationSyncService` 抽 provider execution adapter；planner 与批次模型保持通用。
- `MessageDeliveryService` 抽 channel enqueue/process adapter，共用 retry/outbox 状态机。
- SSO 复用现有 OAuth state 与 external identity，新增 DingTalk flow 与 API/controller。

## 5. 失败策略

- 未配置/未测试/未启用：gate 明确不可用，不发送。
- token 失败：配置测试失败；runtime 投递按 provider 错误分类。
- 缺映射：MessageDelivery DEAD，保留审计。
- 组织 API 返回不完整树：同步预览失败，不部分应用。
