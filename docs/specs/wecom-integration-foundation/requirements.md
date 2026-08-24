# W3.1 企业微信集成底座需求

## 范围

本阶段以项目内 `CordysCRM/` 源码为第一事实来源，对齐“企业设置 / 第三方集成”中的企业微信配置底座。W3.1 交付租户级企微配置、密钥加密、连接测试、读取/更新权限、操作日志和真实页面闭环，为 W3.2 组织同步与 W3.3 登录/消息通道提供唯一配置来源。

组织同步、第三方用户映射、OAuth/扫码登录和企微消息发送不是 W3.1 的完成项，但对应数据缺口必须进入暂缓台账。

## Cordys 源码基线

- 企业设置页面：`frontend/packages/web/src/views/system/business/index.vue`
- 集成列表：`frontend/packages/web/src/views/system/business/components/integrationList.vue`
- 配置弹窗：`frontend/packages/web/src/views/system/business/components/editIntegrationModal.vue`
- 前端 API/模型：`frontend/packages/lib-shared/api/modules/system/business.ts`、`models/system/business.ts`
- 后端入口：`OrganizationSettingsController`
- 后端实现：`IntegrationConfigService`、`TokenService`
- 企微模型：`WecomThirdConfigRequest`
- 数据结构：`OrganizationConfig`、`OrganizationConfigDetail`

## 用户故事与验收标准

### R1 租户级配置

- 当管理员进入企业设置时，系统 shall 返回当前租户的企业微信配置状态，不得返回其他租户的数据。
- 系统 shall 为同一租户只保存一份 `WECOM` 配置，并为后续钉钉、飞书扩展保留 provider 维度。
- 未配置时系统 shall 返回稳定的“未配置”视图对象，而不是依赖前端捕获 404。
- 配置 shall 至少保存企业 ID、应用 ID、密钥密文、验证状态、最后测试结果、创建/更新审计和预留的组织同步开关。

### R2 配置更新与秘密保护

- 当具有更新权限的管理员保存企业 ID、应用 ID和应用 Secret 时，系统 shall 校验必填项和长度后持久化。
- 应用 Secret shall 使用服务端密钥以 AES-256-GCM 加密，不得以明文或可逆无密钥编码写入数据库。
- 常规配置 GET 响应、操作日志、错误信息和前端卡片状态 shall 不返回应用 Secret、access token、密文、IV 或认证标签；受控 Secret 查看接口是唯一例外。
- 首次配置应用 Secret shall 必填；已有配置再次打开时 shall 允许配置管理员按需查看并复用已保存 Secret，不要求重复填写。
- 应用 Secret 替换时 shall 重新加密并产生新的 IV 和认证标签；企业 ID、应用 ID 或 Secret 变化时 shall 清除原连接验证成功状态，并保持组织同步关闭。
- 常规配置读取 shall 只返回 `secretConfigured`；查看 Secret shall 使用独立受控接口，并强制校验 `system:setting:update`，避免只读用户获得秘密。

### R3 连接测试

- 当管理员提交连接测试时，系统 shall 使用企业 ID 和应用 Secret获取企微 access token，再使用应用 ID查询应用信息。
- 连接测试 shall 同时验证 token 和应用可用性，任一步失败均 shall 返回可理解的失败结果。
- 测试请求 shall 支持新配置和已保存配置；卡片上的测试按钮 shall 直接使用服务端已保存 Secret，不要求重新打开配置或填写 Secret。
- 对齐 Cordys 行为，连接测试 shall 保存当前配置和最后测试状态；失败配置也 shall 可继续编辑和重新测试。
- 外部请求 shall 设置超时，不得把 access token、Secret 或完整第三方响应写入日志和业务响应。

### R4 权限与审计

- 企业设置页面和 GET 接口 shall 使用 `system:setting` 读取权限。
- 配置保存和连接测试 shall 使用 `system:setting:update` 更新权限，并由后端强制校验。
- 原来拥有 `system:setting` 的存量角色 shall 在迁移后继续拥有更新权限，避免发布后意外降权。
- 保存与连接测试 shall 写入操作日志，但日志 shall 只记录资源、动作、操作者和非秘密状态。

### R5 页面交互

- `/system/settings` shall 清晰区分企业基础信息、企业集成和开放 API，不把企微配置混入通用键值输入框。
- 企业集成区 shall 展示企微的未配置、待验证、连接正常或验证失败状态，以及企业 ID、应用 ID和最后测试时间。
- 具有更新权限的用户 shall 能打开配置抽屉、保存配置并执行连接测试；只读用户不得看到可写操作。
- 已有 Secret 在卡片中 shall 只显示“已配置”状态；配置管理员打开抽屉时 shall 安全加载真实值到密码输入框，并使用输入框眼睛按钮控制明文可见性。
- Secret 表单字段 shall 保持必填；已有配置由已加载值满足校验，无需管理员重复输入。
- Secret 输入区 shall 说明获取方式：企业微信管理后台 → 应用管理 → 自建应用 → 对应应用详情，并链接 Cordys 源码引用的企业微信 Secret 官方说明；同时提示应用需要启用。
- 组织同步 shall 明确标记为 W3.2 待接入，本阶段不得提供会产生同步效果的开关。

### R6 公共底座边界

- 企业微信配置 shall 成为后续组织同步、OAuth/扫码登录和消息发送器的唯一凭据来源，不得在各模块重复保存 Secret。
- W3.1 shall 预留同步状态字段，但服务端 shall 拒绝或不暴露把同步设为开启的入口。
- 企微外部部门/成员映射、同步任务/冲突记录、外部身份、OAuth state 和消息渠道开关缺口 shall 写入暂缓台账。

### R7 验证与文档

- 本阶段 shall 覆盖加密往返、常规读取不回显、受控查看、租户隔离、首次 Secret 必填、留空保留/替换、状态失效、已保存配置直接测试、连接测试成功/失败和权限目录的自动化测试。
- 本阶段 shall 通过 Prisma validate/generate/迁移、typecheck、lint、build、规则测试、Smoke 和浏览器验收。
- 本阶段 shall 更新 API、数据模型、parity、菜单状态、alignment log、计划、规格索引和暂缓台账。

## 非目标

- 不在 W3.1 拉取或写入企微部门、成员。
- 不在 W3.1 建立本地用户与企微用户的映射或同步冲突处理。
- 不在 W3.1 接入企微 OAuth、扫码登录、回调或会话绑定。
- 不在 W3.1 接入消息设置中的企微渠道或发送器。
- 不在 W3.1 同时实现钉钉、飞书；数据模型保留 provider 扩展能力。
- 不复刻 Cordys 的 DataEase、MaxKB、企查查等独立集成。
