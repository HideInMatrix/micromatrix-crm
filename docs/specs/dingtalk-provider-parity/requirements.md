# DB-015A 钉钉 Provider 对齐需求

状态：`VERIFIED`

## 1. 来源与拆分

DB-015 正式拆分为 DB-015A DingTalk 与 DB-015B Lark；015B 在 015A 封板后独立执行。本单元以项目内 CordysCRM 当前源码为第一事实来源，覆盖 `DINGTALK_SYNC / DINGTALK_OAUTH2 / DINGTALK_NOTICE`、组织同步、OAuth/扫码登录和工作通知。

## 2. 配置与凭据

- 钉钉配置 shall 持久化 `corpId`、AppKey/ClientId、内部应用 AgentId 与 AppSecret。
- AppSecret shall 继续使用 CredentialCipher，不得明文落库、回显或写日志。
- 首次保存/测试必须提供 Secret；留空更新保留旧 Secret；关键凭据变化必须使旧连接测试与同步预览失效。
- 连接测试 shall 通过真实钉钉 token API 验证 AppKey/AppSecret。
- pre-release 数据库继续只有唯一 `20260905084900_baseline`。

## 3. 组织同步与身份映射

- 复用 `EnterpriseIntegration / ExternalDepartmentMapping / ExternalUserMapping / OrganizationSyncBatch`，不新增 DingTalk 平行映射表。
- 部门以 `dept_id` 为外部主键，根部门为 `1`；成员以 `userid` 为映射主键，并保留 `unionid` 快照供 OAuth 解析。
- shall 递归读取直属子部门，再按部门分页读取成员；多部门成员不得重复创建本地用户。
- 预览、冲突处理、原子应用、缺失映射禁用与默认角色规则继续复用现有同步语义。

## 4. 登录与外部身份

- PC shall 支持钉钉 OAuth/扫码登录；钉钉容器登录复用同一一次性 OAuth state 安全边界。
- OAuth code shall 交换 user access token，读取 `unionId`，再通过企业 access token 解析为组织 `userid`。
- 登录必须命中当前租户 ACTIVE DingTalk user mapping；不得用 email/mobile 猜测登录身份。
- 成功登录继续复用 `ExternalIdentity`、JWT、登录审计和 return path 安全边界。

## 5. 消息 Provider

- `MessageTaskSetting.dingTalkEnabled` shall 成为真实 channel gate，而非预留字段。
- BusinessNotifications 已渲染的 title/content/link shall 进入通用 MessageDelivery outbox。
- 工作通知使用内部应用 AgentId、目标 `userid_list` 与 text 消息；缺失 DingTalk 映射时保留 DEAD 审计。
- 临时 provider/网络错误有限重试；永久凭据/成员错误 fail-closed；不得影响主业务事务。

## 6. Web 与验收

- 企业设置第三方页 shall 提供 DingTalk 配置、连接测试、同步开关与默认角色。
- 消息设置 shall 提供 DingTalk 全局/逐事件开关及投递记录。
- 登录页 shall 提供 DingTalk 登录入口；未配置或未验证时不可伪装可用。
- Provider client、配置安全、组织快照、OAuth identity、MessageDelivery 专项测试必须全绿。
- fresh baseline + Seed、Prisma validate/diff、API Rules、root typecheck/lint/build、Prettier、`git diff --check` 全绿。
