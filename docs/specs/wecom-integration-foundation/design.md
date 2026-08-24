# W3.1 企业微信集成底座技术设计

## 1. 目标与边界

W3.1 将企微凭据从通用 `system_settings` 中分离，建立可扩展、可审计、可安全复用的企业集成模型。页面只开放配置和连接测试；同步、登录、消息三个消费者在后续阶段接入同一 Service，不重复存储凭据。

## 2. UI 设计规格

### Purpose Statement

企业设置面向系统管理员，用于维护企业基础信息和第三方平台连接。企微区域应优先表达是否配置、是否验证以及最后测试结果，并让 Secret 的获取方式、密码查看和保留语义明确可见。

### Aesthetic Direction

采用工业化工具界面，延续现有 Element Plus 管理端的信息密度、间距和状态色，不创建脱离项目的视觉体系。

### Color Palette

- 使用现有 `--el-color-primary`
- 使用现有 `--el-bg-color` 与 `--el-fill-color-light`
- 使用现有 `--el-border-color`
- 成功、警告、失败使用 Element Plus 对应 token

### Typography

沿用项目现有中文字体栈。该选择是现有设计系统约束对通用字体建议的窄范围覆盖，避免单页字体割裂。

### Layout Strategy

- 使用页签分隔“企业信息 / 企业集成 / 开放 API”。
- 企微使用横向状态卡：左侧平台与状态，中部配置摘要，右侧配置/测试动作。
- 配置使用右侧抽屉；已有 Secret 通过受控接口加载到密码输入框，使用眼睛按钮查看；输入区相邻展示管理后台获取路径和官方说明链接。
- 卡片“测试连接”与 Cordys 一致：已配置时直接测试，不要求再次进入抽屉或填写 Secret。
- 图标统一使用项目已有 `lucide-vue-next`。

## 3. 模块关系

```mermaid
flowchart LR
    UI[SettingsView 企业集成页签] --> API[EnterpriseIntegrationsController]
    API --> S[EnterpriseIntegrationsService]
    S --> C[CredentialCipherService]
    S --> W[WeComClient]
    S --> DB[(enterprise_integrations)]
    S -. W3.2 .-> SYNC[组织同步]
    S -. W3.3 .-> SSO[OAuth/扫码登录]
    S -. W3.3 .-> MSG[企微消息发送]
```

## 4. 数据模型

新增 `EnterpriseIntegration`：

| 字段                                                 | 说明                                       |
| ---------------------------------------------------- | ------------------------------------------ |
| `id / tenantId / provider`                           | 租户级集成主键，`tenantId + provider` 唯一 |
| `corpId / agentId`                                   | 企业 ID 与应用 ID                          |
| `secretCiphertext / secretIv / secretAuthTag`        | AES-256-GCM 密文材料                       |
| `secretKeyVersion`                                   | 密钥轮换版本，W3.1 默认 1                  |
| `syncEnabled`                                        | W3.2 预留，本阶段固定 false                |
| `lastTestSucceeded / lastTestMessage / lastTestedAt` | 最后连接测试结果                           |
| `createdById / updatedById / createdAt / updatedAt`  | 审计字段                                   |

不把 access token 持久化。W3.1 的连接测试按请求即时获取 token，避免过早建设缓存和失效刷新机制。

### 加密

- 算法：AES-256-GCM。
- 每次写入生成 12-byte 随机 IV；认证标签单独保存。
- 加密 key 从 `INTEGRATION_CREDENTIALS_KEY` 派生；生产环境必须显式配置。
- 开发环境若未配置，使用带上下文前缀的 JWT access secret 派生，仅用于保持现有本地环境可启动；文档和 `.env.example` 明确要求独立密钥。
- Secret 仅在 Service 内部解密；只传给 `WeComClient` 或返回给通过更新权限校验的受控查看接口。

## 5. API

| 方法 | 路径                                    | 权限                    | 说明                |
| ---- | --------------------------------------- | ----------------------- | ------------------- |
| GET  | `/enterprise-integrations/wecom`        | `system:setting`        | 返回脱敏配置状态    |
| GET  | `/enterprise-integrations/wecom/secret` | `system:setting:update` | 按需查看 Secret     |
| PUT  | `/enterprise-integrations/wecom`        | `system:setting:update` | 新增或更新配置      |
| POST | `/enterprise-integrations/wecom/test`   | `system:setting:update` | 测试并保存配置/结果 |

常规配置响应只包含 `configured`、`secretConfigured`、`corpId`、`agentId`、`syncEnabled`、测试状态和审计时间，不包含任何秘密或密文材料。

首次 PUT 与首次 POST test 必须提供 `appSecret`；已有配置可复用服务端密钥。普通 GET 不返回 Secret，配置管理员打开抽屉时再调用受控查看接口并填入密码框。卡片测试只提交已保存的企业 ID、应用 ID，由服务端解密 Secret 执行；替换凭据时清除旧测试状态。

## 6. 企微连接规则

1. 请求 `GET https://qyapi.weixin.qq.com/cgi-bin/gettoken`。
2. `errcode=0` 且存在 `access_token` 后，请求 `GET /cgi-bin/agent/get`。
3. 第二步 `errcode=0` 才标记成功。
4. 每个请求使用 8 秒超时。
5. 对外只返回规范化消息和可选的企微错误码；不返回 token、Secret 或完整响应。

## 7. 权限与兼容

权限树将 `system:setting:update` 挂在 `system:setting` 下。迁移把所有包含旧 `system:setting` 且不包含新动作码的角色补上 `system:setting:update`，管理员的 `*` 不受影响。

通用企业设置 PUT 同步改用更新权限，前端基础信息保存和 API Token 操作按同一更新能力显示。

## 8. 测试

- `CredentialCipherService`：随机 IV、加密往返、错误 key/篡改失败。
- `EnterpriseIntegrationsService`：空状态、租户隔离、首次 Secret 必填、留空保留/替换、受控查看、替换后状态失效、普通响应不含秘密。
- `WeComClient` 使用注入替身覆盖成功、token 失败、agent 失败；自动化测试不调用真实企微。
- Smoke 覆盖真实 API 的读取、权限拒绝、配置保存和脱敏响应；不使用伪造企微成功结果。
- 浏览器覆盖页签、配置抽屉、Secret 加载/密码查看说明、无需重填保存、卡片直接测试和控制台；使用本地已保存自建应用配置验证真实成功分支。

## 9. 后续数据缺口

- W3.2：外部部门/成员 ID 映射、同步批次、来源、冲突、最后同步状态。
- W3.3 登录：外部身份、用户来源、OAuth state、回调审计和解绑。
- W3.3 消息：`message_task_settings` 企微开关、用户映射、发送任务/失败重试。
