# W3.1 实施任务

- [x] 1. 核对 Cordys 企业设置与企微全链路源码
  - 读取企业设置页、集成列表、配置弹窗、前端 API/模型。
  - 读取 `OrganizationSettingsController`、`IntegrationConfigService`、`TokenService`、企微 DTO 与配置 Domain。
  - 明确连接测试、配置保存、组织同步、登录和消息发送的边界。
  - _Requirements: R1-R7_

- [x] 2. 固化需求、设计和暂缓边界
  - 确认 W3.1 只交付配置、安全存储、连接测试、权限、审计和页面闭环。
  - 确认 W3.2/W3.3 的同步、登录、消息数据缺口进入暂缓台账。
  - _Requirements: R1-R7_

- [x] 3. 新增企业集成 Prisma 模型和迁移
  - 新增租户/provider 唯一配置、AES-GCM 材料、测试状态、同步预留和审计字段。
  - 新增 `system:setting:update` 存量角色兼容迁移。
  - _Requirements: R1, R2, R4, R6_

- [x] 4. 实现凭据加密与企微连接客户端
  - 实现 AES-256-GCM 加解密和生产密钥约束。
  - 实现 token + agent 两步连接测试、超时和安全错误映射。
  - _Requirements: R2, R3_

- [x] 5. 实现企业集成 Service、DTO 和 API
  - 实现脱敏读取、保留/替换 Secret 的 upsert、状态失效和测试结果持久化。
  - 接入租户过滤、读取/更新权限和操作日志。
  - _Requirements: R1-R4, R6_

- [x] 6. 实现 Vue 企业设置企微配置页面
  - 重组企业信息、企业集成和开放 API 页面结构。
  - 实现企微状态卡、配置抽屉、Secret 保留语义、保存和连接测试。
  - 按 `system:setting:update` 控制操作并标记 W3.2 同步边界。
  - _Requirements: R4-R6_

- [x] 7. 完成自动化与浏览器验收
  - 覆盖加密、Service 规则、权限、迁移和 API 脱敏。
  - 运行 Prisma、typecheck、lint、build、规则测试、Smoke。
  - 浏览器验证页面、抽屉、保存、失败测试和控制台。
  - _Requirements: R1-R7_

- [x] 8. 更新文档并本地提交
  - 更新 API、数据模型、parity、菜单、alignment、计划、规格索引和暂缓台账。
  - 明确 W3.2/W3.3 未完成项，不把企微配置等同于企微全能力。
  - _Requirements: R6, R7_
