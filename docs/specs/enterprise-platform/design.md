# Enterprise Platform 设计

## 1. 分层

```text
EnterpriseSettingsModule
  ├── UI / Mail / AI Models / Terms / Global Tasks
  └── CredentialCipherService

EnterpriseIntegrationsModule
  ├── EnterpriseIntegration(provider-scoped credentials)
  ├── WeComClient / DingTalkClient / LarkClient
  ├── OrganizationSync
  ├── ExternalIdentity / OAuthState
  └── MessageDelivery channel adapters
```

第三方页签只是 UI 聚合入口；Provider 真相源仍在 EnterpriseIntegrations 域。

## 2. Secret

`CredentialCipherService` 是公共加密边界，生产必须显式配置 `INTEGRATION_CREDENTIALS_KEY`。AES-256-GCM 每次写入使用新 IV；数据库保存 ciphertext/iv/authTag/keyVersion，API 只暴露 `secretConfigured` 等状态。

## 3. Organization Sync

```text
Provider snapshot
   ↓ normalize
OrganizationSyncPlanner
   ↓
Batch + Items + Conflicts
   ↓ resolve
Apply transaction
   ↓
Department/User + External mappings
```

Planner 是纯计算组件；Apply 负责事务与映射。Redis lease 提前阻止同租户/provider 并发同步，Redis unavailable 时数据库 partial unique/advisory lock 仍是最终保护。

目标部门写入 batch，避免用户生成预览后切换页面节点导致应用位置漂移。

## 4. OAuth

`ExternalOAuthState` 只保存 state hash、nonce hash、flow、tenant、integration、returnPath、expiresAt、consumedAt。Callback 先原子验证/消费 state，再调用 Provider 交换身份。

`ExternalUserMapping` 是组织身份映射；`ExternalIdentity` 是登录身份状态。登录不得用邮箱/手机号自动替代 mapping。

WeCom Workbench 对同一 `state+nonce` 的进行中/刚完成请求使用短生命周期 flight cache 复用结果，解决 WebView 重复导航导致的第二次 state 消费。

## 5. Same-origin Workbench

生产 Nginx 同时承载 `/login/*` PC callback 与 `/mobile/*` Mobile SPA，因此 callback 页面写入的 localStorage token 可被 Mobile 同源读取，再跳转 `/mobile/home`。

Compose 的 `WEB_PUBLIC_URL` 默认保持为空；只有显式配置真实公开域名时才生成 Provider callback。Release smoke 可显式注入 localhost 测试值。

## 6. MessageDelivery

业务通知先生成统一 title/content/link，再分别写站内 Notification 和启用的外部 Delivery。

Delivery 状态机为 `PENDING → SENDING → SUCCEEDED/FAILED/DEAD`。临时网络/provider 错误有限重试；永久凭据/映射错误直接终态。claim 与超时恢复保证多实例不会重复发送同一 delivery。

## 7. Provider adapters

- WeComClient：token、应用连接测试、组织快照、QR/Workbench identity、文本消息。
- DingTalkClient：企业 token、部门/成员分页、unionId→userid OAuth、工作通知。
- LarkClient：tenant token、tenant info、部门/成员分页、OAuth profile、open_id 文本消息。

Provider 协议差异留在 Client/adapter，OrganizationSync、ExternalIdentity、MessageDelivery 状态机保持通用。

## 8. Enterprise settings

`EnterpriseUiSetting / EnterpriseMailSetting / EnterpriseAiModel(+Route) / EnterpriseTerm* / EnterpriseGlobalTask(+Execution)` 使用结构化模型，不回退到 KV。模型运行时通过 service 解密 API Key；浏览器不获取明文。

Global Task 当前安全边界只允许现有已实现的执行模式；自然语言动作不能直接解释成数据库写操作，必须经过显式工具/runtime 后才能扩展。

## 9. 前端

`/system/settings` 聚合企业设置与 Provider 卡片；组织架构复用同一同步 Drawer；成员身份管理复用 provider-aware identity UI；登录页根据 provider gate 展示入口；Mobile 只做容器环境需要的自动授权与页面适配。

## 10. 维护规则

- 新 Provider 优先扩展 provider adapter，不复制整套 mapping/sync/outbox 表。
- Secret 不进入 shared DTO、日志、缓存或 BullMQ payload。
- OAuth state/nonce 原文不持久化。
- 真实 Provider API 或客户端行为发生变化时，先更新 provider adapter 测试与本领域文档，再改产品入口。
