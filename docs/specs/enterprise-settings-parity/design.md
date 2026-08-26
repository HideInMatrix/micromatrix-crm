# 企业设置对齐设计

## 1. 边界

新增 `EnterpriseSettingsModule` 作为企业设置聚合域。它与现有 `EnterpriseIntegrationsModule` 平级，不替代后者。

```text
System
├── EnterpriseSettingsModule
│   ├── UI settings
│   ├── Mail settings
│   ├── AI model settings
│   ├── Term settings
│   └── Global tasks
└── EnterpriseIntegrationsModule
    └── WeCom / future DingTalk / Lark
```

第三方页签是前端聚合入口，数据仍由专用集成域提供。

旧 `SettingsModule` / `SystemSetting` 通用 KV 链在六页签替换完成后彻底删除；新增企业参数必须进入明确的领域模型，不再恢复 miscellaneous key-value 兼容层。

## 2. 数据模型

### 2.1 `EnterpriseUiSetting`

每租户一行，保存：`theme/customTheme/style/customStyle/title/slogan/helpDoc` 与 4 个 UI 资源附件 ID。

资源文件继续复用公共 `Attachment` 基础设施，但附件 ID 的绑定与租户校验由企业设置服务负责。

### 2.2 `EnterpriseMailSetting`

每租户一行，保存 SMTP 配置。密码使用 AES-256-GCM，拆分 `ciphertext/iv/authTag/keyVersion` 存储。

读取时只返回 `passwordConfigured: boolean`，编辑请求中不提交密码表示保留原密码。

### 2.3 `EnterpriseAiModel`

一租户多模型。API Key 与 SMTP 密码采用同一个 `common` 凭证加密服务。模型运行参数使用结构化列，而不是 JSON 字符串，避免后续筛选/校验困难。

路由策略使用 `EnterpriseAiModelRoute` 单独保存，不把模型优先级塞入模型行。

### 2.4 术语

- `EnterpriseTermCategory`
- `EnterpriseTerm`
- `EnterpriseTermDiscovery`

分类和术语都有租户边界；同一租户分类名唯一，同一分类标准术语唯一。

### 2.5 全局任务

- `EnterpriseGlobalTask`
- `EnterpriseGlobalTaskExecution`

任务可引用当前租户的 AI 模型。执行记录独立保存状态、输入/输出、错误与起止时间。

## 3. API

统一前缀 `/enterprise-settings`：

```text
GET/PUT  /enterprise-settings/ui
POST     /enterprise-settings/ui/assets/:slot

GET/PUT  /enterprise-settings/mail
POST     /enterprise-settings/mail/test

GET/POST /enterprise-settings/models
PUT      /enterprise-settings/models/:id
DELETE   /enterprise-settings/models/:id
PATCH    /enterprise-settings/models/:id/status
GET/PUT  /enterprise-settings/models/route-strategy

GET/POST /enterprise-settings/term-categories
PUT/DELETE /enterprise-settings/term-categories/:id
GET/POST /enterprise-settings/terms
PUT/DELETE /enterprise-settings/terms/:id
PATCH    /enterprise-settings/terms/:id/status

GET/POST /enterprise-settings/global-tasks
GET/PUT/DELETE /enterprise-settings/global-tasks/:id
PATCH    /enterprise-settings/global-tasks/:id/status
GET      /enterprise-settings/global-tasks/executions
```

本阶段按任务顺序逐个闭环，不允许通过 `SettingsService.updateAll()` 代替。

## 4. 加密设计

现有 `CredentialCipherService` 从企业微信目录下沉到 `common/services` 并由 `CommonModule` 全局导出。

- 算法：AES-256-GCM；
- key material：`INTEGRATION_CREDENTIALS_KEY`（保持已有部署兼容）；
- 开发环境可继续使用 JWT secret 派生 fallback；
- 生产环境必须显式配置 key；
- 同一明文每次产生不同 IV；
- 企业设置只保存密文组件。

## 5. SMTP 测试

连接测试由 API 服务端执行，避免浏览器直接访问 SMTP：

1. 建立 TCP 或 implicit TLS 连接；
2. 等待 `220`；
3. `EHLO`；
4. 若启用 TLS 且非 implicit SSL，执行 `STARTTLS` 后重新 `EHLO`；
5. 若配置账号密码，优先使用服务器宣告的 `AUTH PLAIN`，否则使用 `AUTH LOGIN`；
6. `QUIT`。

测试请求可临时携带未保存密码；未携带时使用当前加密配置。

## 6. 前端

`SettingsView.vue` 只负责六页签容器，各页签拆成独立组件，避免再次形成一个超大系统设置组件。

页面结构与 Cordys 一致：

```text
界面设置 | 第三方 | 邮件设置 | 模型设置 | 术语设置 | 全局任务
```

第三方页签复用现有 `WeComIntegrationCard`，不复制企业微信状态。

## 7. 兼容策略

- 2026-08-26 全仓消费者扫描确认：`SystemSetting` / 后端 `/settings` 没有任何业务模块、测试、seed 或脚本消费者；唯一真实调用链是旧 `SettingsView.vue` 的“企业信息”页签通过 `settingApi` 自读自写。
- 旧 KV 当前只保存 `companyName/companyWebsite/contactEmail/announcement` 四项；四项均没有标题栏、登录页、首页、通知等其他读取点，因此不能视为现行业务事实源。
- `/system/settings` 是企业设置的前端菜单路由，必须保留并切换到新的企业设置六页签；后端 `/settings`、`settingApi`、`SettingsModule`、`SettingsService` 与 Prisma `SystemSetting` 则在新页面替换完成后删除。
- 删除 `SystemSetting` 时使用独立 migration 删除 `system_settings` 表，不修改历史 migration。
- 旧四项 KV 不自动迁移到新模型；若后续确认某项仍有产品需求，应在对应独立领域中重新定义语义和数据模型，而不是继承旧 KV。
