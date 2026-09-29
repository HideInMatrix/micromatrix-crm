# Enterprise Platform 需求

## 1. 定位

Enterprise Platform 负责租户级企业设置和第三方 Provider。它既包含 UI/邮件/AI/术语/全局任务等企业配置，也统一承载 WeCom、DingTalk、Lark 的凭据、连接测试、组织同步、外部身份、OAuth/Workbench 登录和消息通道。

业务模块不得直接读取 Provider Secret 或企业设置表；消费者必须通过对应 Service/runtime context。

## 2. 企业设置

- UI 设置：主题、品牌标题/Slogan、Logo/背景、帮助地址等展示配置按租户隔离。
- Mail：SMTP host/port/account/from/recipient/SSL/TLS；密码加密落库，读取只返回已配置状态。
- AI Model：模型 ID、Provider、Base URL、API Key、采样参数、调用限额、启停和路由策略；API Key 不回显。
- Terms：术语分类、标准词、同义词、禁用词、场景和发现/采纳状态。
- Global Task：事件/手动/cron 触发、条件、动作、确认级别、模型和独立执行记录。
- 企业参数必须进入明确领域模型，不恢复通用 `SystemSetting(key/value)` 作为杂项存储。

## 3. Provider 通用约束

当前支持 `WECOM / DINGTALK / LARK`。

- 每个租户/provider 只保存一份有效集成配置。
- Secret 使用公共 CredentialCipher（AES-256-GCM）加密；GET、日志和错误响应不得泄露 Secret/token/密文组件。
- 凭据变化必须提升凭据版本并使旧验证结果、旧同步预览等相关运行态失效。
- 配置必须经过真实 Provider API 连接测试，不能只做字段非空校验。
- 组织同步、OAuth、消息发送共享同一份 Provider 凭据，不复制 Secret。

## 4. 组织同步

- 统一使用 `EnterpriseIntegration / ExternalDepartmentMapping / ExternalUserMapping / OrganizationSyncBatch / Item` 等 provider-aware 模型。
- 同步分为 Preview → Conflict Resolution → Apply，不能把外部快照直接写入本地组织。
- 批次绑定 tenant、provider、credentialVersion 和本地 targetDepartmentId。
- 外部部门/成员 ID 是映射主键；email/mobile 只能用于冲突提示，不能静默猜测绑定。
- Preview 生成完整差异后才允许 Apply；部分外部读取失败不得生成可应用的半成品预览。
- Apply 在事务、唯一约束和分布式协调保护下执行，并保留批次/项目审计。
- 外部缺失成员只按既有映射规则处理，不得误禁用未由该 Provider 管理的本地成员。

## 5. 外部身份与登录

- Provider 登录必须命中当前租户 ACTIVE external mapping，不自动注册未知外部成员。
- OAuth state 使用随机原值 + 服务端 hash、浏览器 HttpOnly nonce、TTL、flow 和站内 returnPath；回调一次性原子消费。
- 不同 Provider/不同入口使用不同 flow/cookie，禁止跨 flow 重放。
- 成功登录复用当前 AuthService/JWT/CurrentUser；失败不产生 token，并写安全 LoginLog。
- 外部身份 bind/unbind 必须保证同一 provider subject 与本地用户的一致唯一关系。

## 6. WeCom

- PC QR flow 使用 `QR_WECOM / qr-wecom`。
- Workbench 使用 `WECOM / wecom`，网页 OAuth scope 为 `snsapi_base`。
- Workbench 先 `auth/getuserinfo` 获取 userid；存在 `user_ticket` 时读取授权详情，否则可用通讯录成员接口补充资料。
- 同一 state 的并发重复 callback 在短窗口内复用同一个完成结果，避免前端重复导航造成 `state_used` 登录循环。
- `wxwork` Mobile 容器隐藏重复页面 Header；Workbench entry 由后端签发 state/nonce 并 302 到授权地址。
- 生产必须设置真实 `WEB_PUBLIC_URL` 或 `WECOM_OAUTH_REDIRECT_URI`，不得生成 localhost OAuth 回调。

## 7. DingTalk

- 配置保存 corpId、AppKey/ClientId、内部应用 AgentId、AppSecret。
- 组织同步使用 dept_id / userid；OAuth 先获取 unionId，再解析组织 userid。
- 工作通知按 userid_list 发送文本，缺映射时保留 DEAD 审计。

## 8. Lark

- 配置保存企业 ID、App ID、App Secret 和 redirectUrl。
- 组织同步使用 open_department_id / open_id，并按主部门信息确定成员唯一主归属。
- PC/Desktop/Mobile 使用隔离 OAuth flow；回调以 open_id 精确映射。
- 文本消息按 open_id 发送并保存 provider message id。

## 9. 消息通道

- WeCom/DingTalk/Lark 只是 Notification 的外部 channel，不替代站内 Notification。
- Channel 开关受 Provider configured/verified/enabled gate 约束。
- 外部 MessageDelivery 使用持久 outbox、有限重试、SENDING claim、DEAD 终态和管理员手工重试。
- 外部失败不得回滚主业务事务或站内消息。

## 10. 权限与验收

- 企业设置读取/修改继续服从 `system:setting` / `system:setting:update` 等现有权限。
- 组织同步、身份管理、消息设置/投递分别使用其现有细粒度权限。
- 所有 Provider 路径必须覆盖 tenant 隔离、Secret 不回显、state replay、mapping 冲突和外部错误分类。
- Provider 真实客户端行为不能完全由 mock 替代；WeCom Workbench 等发布前仍需真实容器 smoke。
