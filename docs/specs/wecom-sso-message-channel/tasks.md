# W3.3 实施任务

- [x] 1. 读取 Cordys W3.3 源码并固化边界
  - 核对登录页、企微二维码、SSO Controller/Service、OAuth state、MessageTask、NoticeSendService 和 WeComNoticeSender。
  - 确认 W3.2 外部成员映射为唯一账号识别来源，未知企微成员不得自动注册。
  - 明确 Cordys 无投递重试审计，按 W3.3 既定完成标准补充 outbox。
  - _Requirements: R1-R8_

- [x] 2. 完成 W3.3 需求、设计和任务拆分
  - 固化多租户企业标识、浏览器绑定 state、外部身份、消息投递状态机和页面边界。
  - 把钉钉/飞书、SMTP、公告、模板、富媒体和增量同步保留到暂缓台账。
  - _Requirements: R1-R8_

- [x] 3. 新增 Prisma 模型和前进迁移
  - 新增外部身份、OAuth state、消息投递模型和枚举。
  - 扩展登录日志认证字段、消息事件企微开关及关系/索引/唯一约束。
  - 验证现有租户、成员、映射和消息设置数据无损。
  - _Requirements: R2-R7_

- [x] 4. 扩展企业微信客户端
  - 实现授权 code 换 userid 和文本应用消息发送。
  - 统一超时、错误白名单、临时错误分类，确保 code/token/Secret 不泄漏。
  - 增加客户端规则测试。
  - _Requirements: R2-R4, R6-R7_

- [x] 5. 实现一次性 OAuth state 与统一登录服务
  - 实现 discovery/start/callback API、HttpOnly nonce cookie、state 摘要、TTL、流程绑定和一次消费。
  - 按 ExternalUserMapping/ExternalIdentity 识别 ACTIVE 成员，复用现有 JWT 签发。
  - 覆盖未知成员、禁用成员、停用企业、身份冲突、解绑和重放失败审计。
  - _Requirements: R1-R4_

- [x] 6. 实现外部身份管理
  - 提供成员企微身份查询、按现有映射绑定/恢复和安全解绑 API。
  - 防止移除禁用密码成员的最后登录方式，保持租户和 provider 唯一约束。
  - 写操作日志并提供成员页状态入口。
  - _Requirements: R3-R4, R8_

- [x] 7. 扩展消息设置企微渠道
  - 共享契约、DTO、Service 和 API 增加逐事件/批量 `weComEnabled`。
  - 新增企微渠道 gate，后端强制校验已配置、已验证、同步平台开启。
  - 保持现有系统消息、邮件占位和范围配置行为不回退。
  - _Requirements: R5, R8_

- [x] 8. 实现消息投递 outbox、发送器和重试
  - 业务通知在企微开启时创建逐接收人投递，缺映射也保留 DEAD 审计。
  - 实现 PENDING/SENDING/SUCCEEDED/FAILED/DEAD 状态机、条件认领、3次退避和超时恢复。
  - 增加 Cron 补偿、分页审计和手工重试 API，渠道失败不影响业务与站内消息。
  - _Requirements: R6-R7_

- [x] 9. 对齐登录页和企业设置
  - 登录页增加 Cordys 风格的其他登录方式；PC 直接打开官方企微扫码组件，工作台 WebView 自动进入网页 OAuth，不向普通用户展示企业标识输入框。
  - 新增公共回调页面，完成 loading/success/error 和原返回路径跳转。
  - 企业微信卡片展示统一登录/消息能力摘要与可复制企业登录 URL。
  - _Requirements: R1-R4, R8_

- [x] 10. 对齐消息设置和投递记录页面
  - 增加企微通知表头批量开关与逐事件开关，准确显示配置门槛和权限状态。
  - 增加投递记录抽屉、状态/事件/关键字筛选、分页和失败任务手工重试。
  - _Requirements: R5, R7-R8_

- [x] 11. 完成规则测试、专项 Smoke 与浏览器验收
  - 覆盖 state、身份、登录审计、渠道 gate、投递、重试、并发和租户隔离。
  - 使用本地企微夹具走完整 OAuth cookie/callback/JWT 和消息发送链路。
  - 浏览器验证登录页、回调页、企业设置、消息设置和投递抽屉，无新增 console error/warn。
  - _Requirements: R1-R8_

- [x] 12. 更新文档并本地提交
  - 更新 API、数据模型、parity、菜单、alignment、主线计划、规格索引和暂缓台账。
  - 仅在全部验收通过后把 DB-006、DB-014 和 W3.3 标记 VERIFIED，并明确其余保留缺口。
  - 核对工作区范围并创建 W3.3 本地 Git 提交。
  - _Requirements: R5-R8_

- [x] 13. 修正 Cordys 企业微信双登录流程
  - [x] PC 点击企业微信图标后直接打开 `@wecom/jssdk` 登录组件；后端依次解析 URL 指定企业、部署默认企业或唯一可用企业，不再弹出企业标识输入框。
  - [x] 企业微信工作台 WebView 检测 `wxwork` 后走独立网页 OAuth 链路，并与 PC `QR_WECOM` state/回调严格区分。
  - [x] 已补充两条登录链路的专项测试、浏览器验收和文档证据；最终阶段状态由第 14 项数据库复验决定。
  - _Requirements: R1-R4, R8_

- [x] 14. 按 Cordys 直接重建 W3.3 用户/OAuth 模型并复验
  - [x] OAuth flow 改为 Cordys `QR_WECOM/WECOM`，不保留 `WECOM_OAUTH2` 数据库 flow 兼容值；后者仅作为登录认证来源审计。
  - [x] 用户邮箱改为可空、性别改为 Boolean，头像迁入独立 `user_extensions`；组织同步移除占位邮箱。
  - [x] 规则测试 `66/66`、API/Web 类型检查与 Lint 通过。
  - [x] 已重建本地数据库并重新执行迁移、Seed、生产构建、19 条专项 Smoke 和最终 diff 检查，W3.3/DB-014 恢复 `VERIFIED`。
  - _Requirements: R2-R4, R8_
