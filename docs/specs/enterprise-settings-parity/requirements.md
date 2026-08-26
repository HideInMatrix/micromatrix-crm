# 企业设置对齐需求

## 1. 目标

将 Cordys CRM 的“系统 / 企业设置”完整复刻为 MicroMatrix CRM 的独立系统域，而不是继续把企业级配置堆入通用 `SystemSetting(key/value)`。

本规格覆盖 Cordys `frontend/packages/web/src/views/system/business` 下的六个主页签：

1. 界面设置（`pageSettings`）
2. 第三方（`syncOrganization`）
3. 邮件设置（`mailSettings`）
4. 模型设置（`modelSettings`）
5. 术语设置（`termSettings`）
6. 全局任务（`globalTask`）

## 2. 强制架构约束

### R-ES-001 独立系统域

- 企业设置必须拥有独立的 Prisma 模型、Nest Service、Controller、DTO 与前端 API 类型。
- 企业设置完成领域化后不再保留通用 `SystemSetting` KV 模型；无法归属具体业务域的后续参数也必须先定义明确领域模型，不回退到通用 key/value 存储。
- 业务模块不得直接读取企业设置数据库表；需要消费配置时必须经过企业设置服务暴露的明确接口。
- 企业设置不得反向依赖线索、客户、商机等销售业务模块。

### R-ES-002 公共基础设施可以复用

- 密钥加密、认证、权限、Prisma、附件存储等属于公共基础设施，可以复用。
- 企业邮件不得依赖“企业微信集成模块”的私有加密实现；密钥加密能力应下沉到 `common`。
- 第三方页签复用既有 `EnterpriseIntegration` / `OrganizationSync` 专用能力，因为它们本身就是独立集成域，而不是 `SystemSetting`。

## 3. 功能需求

### R-ES-101 界面设置

对齐 Cordys 的：

- 主题模式与自定义主题色；
- 平台背景风格与自定义颜色；
- 登录页标题、Slogan；
- 浏览器图标、登录 Logo、登录背景图；
- 平台 Logo；
- 帮助文档地址；
- 重置默认值、保存并应用；
- 图片资源必须归属当前租户。

### R-ES-102 第三方

- 继续使用现有企业微信配置、连接测试、同步开关、组织同步能力；
- 开放 API 令牌入口可暂时放在第三方页签内，后续若 Cordys 源码确认独立入口再迁移；
- 不复制一套新的企业微信表。

### R-ES-103 邮件设置

对齐 Cordys SMTP 字段：

- SMTP Host；
- SMTP Port；
- SMTP Account；
- SMTP Password；
- From；
- Recipient；
- SSL；
- TLS（Cordys 源字段拼写为 `tsl`，MicroMatrix API 统一使用 `tls`）；
- 连接测试；
- 密码加密落库，读取接口不返回明文密码。

### R-ES-104 模型设置

独立维护 AI 模型：

- 显示名称、模型 ID、供应商、API Base URL、API Key；
- `temperature`、`max_tokens`、`top_p`；
- 全局每日调用上限、用户每日调用上限；
- 启停、搜索、增删改；
- 路由策略；
- API Key 加密存储；
- 后续智能体/全局任务只能通过模型服务查询可用模型，不能直接耦合模型表。

### R-ES-105 术语设置

- 术语分类 CRUD；
- 标准术语、同义词、禁用词、适用场景、系统映射；
- 术语启停；
- 术语发现、采纳与忽略保留独立实体边界。

### R-ES-106 全局任务

- 任务名称；
- 触发类型：事件/手动语义（`manual`）与定时（`cron`）；
- 执行条件；
- 执行动作；
- 确认级别：`ask` / `auto` / `only_analysis`；
- 适用 AI 模型；
- 启停、增删改；
- 执行记录独立持久化，支持后续停止/删除/审计。

## 4. 权限

- 页面读取继续使用 `system:setting`。
- 修改类动作继续使用 `system:setting:update`，避免本轮无必要扩大 RBAC 迁移面。
- 后续若 Cordys 源码出现更细权限，再拆分子权限；当前不得因 UI 拆页签而绕过权限校验。

## 5. 验收标准

- `system_settings` 不承载六个页签的新数据。
- Prisma schema 中存在企业设置专用实体，并通过 migration 落库。
- API DTO 做输入校验；密钥字段不明文落库、不在 GET 响应中返回。
- 租户隔离覆盖所有查询和写入。
- 前端企业设置采用 Cordys 六页签信息架构。
- 已完成页签必须能真实读写后端，禁止仅做静态 UI 假完成。
- Shared/API/Web typecheck、API rule tests、Web build、Prisma validate/generate 通过。
