# W3.3 企业微信统一登录与消息渠道设计

## 1. 设计结论

W3.3 复用 W3.1 唯一加密配置和 W3.2 唯一成员映射，不复制 Cordys 的默认组织假设。统一登录使用数据库一次性 state + HttpOnly 浏览器 nonce；消息渠道使用持久化 outbox 投递任务，把第三方网络请求从业务事务中隔离。

## 2. Cordys 对照

| 能力        | Cordys 源码                                          | MicroMatrix 实现                                               |
| ----------- | ---------------------------------------------------- | -------------------------------------------------------------- |
| 登录入口    | `login-form.vue`、`tabQrCode.vue`、`weComQrCode.vue` | 登录页其他登录方式 + 企业标识/URL参数 + 企微授权跳转           |
| state       | `OAuthStateService`                                  | `ExternalOAuthState`：摘要、10分钟 TTL、浏览器 nonce、一次消费 |
| 回调        | `SSOController/SSOService`                           | `WeComSsoController/Service` + 现有 `AuthService` JWT 签发     |
| 用户识别    | 企微 userid → 已同步用户 resourceId                  | userid → `ExternalUserMapping` → `ExternalIdentity` → `User`   |
| 渠道开关    | `MessageTask.weComEnable`                            | `MessageTaskSetting.weComEnabled`                              |
| 企微 sender | `WeComNoticeSender`                                  | `MessageDeliveryService` + `WeComClient.sendTextMessage`       |
| 异常        | 记录服务日志后吞掉                                   | 持久化 PENDING/SENDING/SUCCEEDED/FAILED/DEAD 并有限重试        |

## 3. 数据模型

### 3.1 `ExternalIdentity`

- 归属 tenant、provider、integration、user。
- 保存规范化 externalSubject、状态 ACTIVE/REVOKED、绑定来源、绑定/解绑人和时间、最近登录时间。
- 唯一约束：`tenantId + provider + externalSubject`、`tenantId + provider + userId`。
- 身份状态与 W3.2 `ExternalUserMapping.active` 分离：映射描述组织来源，身份描述是否允许登录。

### 3.2 `ExternalOAuthState`

- 保存 stateHash、browserNonceHash、flow、tenantId、integrationId、returnPath、expiresAt、consumedAt。
- 只保存 SHA-256 hex；原始随机值仅返回浏览器，nonce 仅存在 HttpOnly cookie。
- 回调通过条件更新 `consumedAt`，确保一次性消费；开始新流程时清理过期/已消费历史。

### 3.3 `LoginLog` 扩展

- 新增 `authType`，存 `PASSWORD` 或 `WECOM`。
- 新增 `externalSubject`，只保存已规范化企微 userid，不保存 code/token/state。

### 3.4 `MessageTaskSetting` 扩展

- 新增 `weComEnabled Boolean @default(false)`。
- 现有 35 事件不需要全量回填行；缺行时继续使用共享定义默认值。

### 3.5 `MessageDelivery`

- 一条记录对应一个事件、渠道和本地接收人。
- 保存 event、channel、userId、externalSubject 快照、title/content/link、status、attempts、maxAttempts、nextAttemptAt、providerMessageId、errorCode/errorMessage、sentAt。
- 状态：`PENDING → SENDING → SUCCEEDED`；临时错误为 `FAILED` 并设置下次时间；永久错误或耗尽重试为 `DEAD`。
- 索引覆盖 tenant/status/nextAttemptAt、tenant/event、tenant/userId/createdAt。

## 4. API

### 4.1 公共统一登录

- `GET /auth/wecom/discovery?tenant=<slug>`：返回是否可用、企业显示名、corpId、agentId 和登录 URL 提示，不返回 Secret。
- `POST /auth/wecom/start`：接收 tenantSlug 和受限 returnPath，签发 state、设置 HttpOnly nonce cookie，返回企业微信授权 URL。
- `POST /auth/wecom/callback`：接收 code/state，校验 nonce cookie并消费 state，交换 userid、识别身份、签发现有 JWT。

授权回调默认使用 `${origin}/login/wecom/callback`；生产环境可用 `WECOM_OAUTH_REDIRECT_URI` 固定覆盖。returnPath 只允许以 `/` 开头且不能是 `//` 的站内路径。

### 4.2 身份管理

- `GET /external-identities/wecom/users/:userId`：查看本租户成员企微映射和身份状态。
- `POST /external-identities/wecom/users/:userId/bind`：根据现有 ACTIVE `ExternalUserMapping` 创建或恢复身份。
- `POST /external-identities/wecom/users/:userId/unbind`：安全撤销身份；禁用密码登录的成员不得移除最后登录方式。

接口使用现有 `system:member` / `system:member:update` 权限并严格限定 tenant。

### 4.3 消息设置与投递

- 现有 `GET/PATCH/POST /message-settings` 契约增加 `weComEnabled`。
- `GET /message-settings/channels/wecom/status` 返回 configured/verified/enabled/available/reason。
- `GET /message-deliveries` 分页筛选投递记录。
- `POST /message-deliveries/:id/retry` 手工重试本租户失败任务。

## 5. 企微客户端

- `exchangeLoginCode`：获取 access token 后调用 `/auth/getuserinfo`，白名单读取 userid，拒绝外部联系人 openid 和空主体。
- `sendTextMessage`：获取 access token 后调用 `/message/send`，请求体为 touser、agentid、text.content、msgtype=text；白名单读取 errcode/errmsg/msgid/invaliduser。
- 超时 8 秒；token、Secret、code 不进入错误文本。客户端返回结构化 transient 标识供投递服务判断重试。

## 6. 消息执行流程

1. 业务 Service 仍调用 `BusinessNotificationsService`。
2. 服务先解析/过滤当前租户 ACTIVE 接收人；站内消息按 `systemEnabled` 发送。
3. `weComEnabled` 时，投递服务为每个接收人创建 outbox。缺少 ACTIVE 映射时直接记录 DEAD，站内消息不受影响。
4. 创建后触发一次非阻塞处理；Cron 每分钟补偿扫描到期任务，并恢复超过 5 分钟的 SENDING。
5. worker 通过条件 `updateMany` 抢占单条任务；成功/失败各自落库，不把异常抛回业务事务。

## 7. 页面设计

- 登录页保留现有卡片和密码表单；下方增加“其他登录方式”分隔线与企微图标按钮。存在 `tenant` 查询参数时直接使用，缺失时弹出企业标识对话框。
- 新增 `/login/wecom/callback` 公共路由，显示“正在验证企业微信身份”、失败原因和返回密码登录按钮；成功后写入 token 并跳转受限 returnPath。
- 企业微信卡片增加“统一登录/企业微信消息”能力摘要和可复制的企业登录 URL；其可用性跟随已验证且已开启的组织同步配置。
- 消息设置在邮件列后增加企微列，保持 Cordys 的表头批量开关和逐行开关；右上角增加投递记录入口，抽屉展示状态、事件、接收人、尝试次数和错误。

## 8. 安全与测试

- state 和浏览器 nonce 使用 `randomBytes(32)`；数据库只存 SHA-256，cookie 为 HttpOnly、SameSite=Lax、10分钟 Max-Age，生产 HTTPS 时 Secure。
- 外部 code、token、Secret 不写日志；provider 错误只保留 errcode 和裁剪 errmsg。
- 测试覆盖 state 过期/重放/浏览器不匹配、未知/禁用/解绑成员、身份冲突、消息开关门槛、缺映射审计、临时/永久错误、重试耗尽、并发认领和租户隔离。
- 专项 Smoke 使用本地企微夹具，实际走 state cookie、callback、JWT、消息设置、业务通知、投递发送、失败重试和审计查询。

## 9. 保留缺口

- 钉钉、飞书 provider；企微富媒体/Markdown 消息；邮件 SMTP；自定义模板；公告。
- 企微增量回调、自动组织同步、多部门关系和 unionid/open_userid 迁移策略。
