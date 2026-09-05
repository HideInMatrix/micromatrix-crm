# 企业设置对齐任务

## W3.4-S0 独立领域骨架

- [x] 新建企业设置专用 Prisma 模型与 migration。
- [x] 将凭证加密服务下沉到 `common`，企业微信回归测试保持通过。
- [x] 新建 `EnterpriseSettingsModule` 并接入 `AppModule`。
- [x] 新增 shared 类型，不再使用 `Record<string, unknown>` 表达企业设置。

## W3.4-S1 界面设置

- [x] 独立 UI setting GET/PUT。
- [x] 资源附件租户校验与上传绑定。
- [x] 前端主题/风格/登录页/平台资源设置。
- [x] 重置默认值与保存应用。

## W3.4-S2 第三方

- [x] 将现有企业微信集成卡移入 Cordys“第三方”页签。
- [x] 保持组织同步、连接测试、同步开关走现有专用 API。
- [x] 开放 API 入口保留但不污染企业设置持久化。

## W3.4-S3 邮件设置

- [x] SMTP 独立模型/API。
- [x] 密码 AES-256-GCM 加密。
- [x] SSL/TLS/认证连接测试。
- [x] 前端详情 + 编辑抽屉/表单 + 测试连接。

## W3.4-S4 模型设置

- [x] 模型 CRUD、启停、搜索。
- [x] API Key 加密。
- [x] AI 参数与日限额。
- [x] 路由策略。
- [x] 前端表格、编辑抽屉、路由策略对话框。

## W3.4-S5 术语设置

- [x] 分类 CRUD。
- [x] 术语 CRUD、启停。
- [x] 术语发现实体与 API 边界。
- [x] 前端分类 + 术语列表 + 编辑抽屉。

## W3.4-S6 全局任务

- [x] 任务 CRUD、启停。
- [x] 绑定可用模型。
- [x] 执行记录模型与查询 API。
- [x] 前端任务列表、执行记录、编辑抽屉。

## W3.4-S7 验收

- [x] 新企业设置六页签替换旧 `SettingsView` 内容，保留 `/system/settings` 菜单路由。
- [x] 删除前端 `settingApi` 与后端 `/settings`、`SettingsModule`、`SettingsService`。
- [x] 删除 Prisma `SystemSetting`，新增 migration 删除 `system_settings` 表；历史 migration 保持不变。
- [x] 全仓复扫 `SystemSetting`、`systemSetting`、`settingApi`、后端 `/settings`，确认真实消费者为 0。
- [x] Prisma validate/generate。
- [x] API rule tests。
- [x] Shared/API/Web typecheck。
- [x] Web build。
- [x] enterprise-settings smoke。
- [x] `git diff --check` / Prettier / ESLint。
- [x] 更新 Cordys parity / alignment / DB tracking。

## W3.4-S8 AI 模型运行时与全局任务手动执行

- [x] AI 模型增加正式运行时调用层，模型测试必须通过后端解密凭证并调用配置的 Provider，不允许前端读取 API Key。
- [x] 模型设置增加“测试”入口，返回成功状态、耗时和最小响应预览，不回传密钥。
- [x] 全局任务增加手动执行 API，并为每次执行真实创建 `EnterpriseGlobalTaskExecution`，落 `PENDING/RUNNING/SUCCEEDED/FAILED`、输入、输出、错误与起止时间。
- [x] 本阶段只闭环 `only_analysis`：将任务条件/动作作为分析指令交给绑定模型并持久化结果；`ask/auto` 的 CRM 数据写操作在 Agent/Tool Runtime 完成前不得伪装为已执行。
- [x] 全局任务页面增加“立即执行”，执行完成后可直接在“执行记录”查看模型输出。
- [x] 执行记录的结果列改为 Drawer 详情入口，完整展示长文本分析结果、错误、原始输出与输入上下文，表格本身不承载长结果正文。
- [x] 使用本地已配置模型完成一次真实模型测试和一次真实全局任务执行；不得通过手工插入成功记录代替运行时。
- [x] API/Web typecheck、build、lint、diff-check 通过并更新 alignment log。
