# DB-015B 飞书 Provider 对齐需求

状态：`VERIFIED`

## 1. 来源与范围

DB-015B 以项目内 CordysCRM 当前源码为第一事实来源，覆盖飞书（中国版）第三方配置、组织同步、PC 扫码/OAuth、飞书容器与 Mobile OAuth、文本消息通知。Cordys 当前 `LARK_SUITE` 国际飞书登录仍标记为 TODO/未上线，因此本单元不扩展国际飞书协议。

## 2. 配置与凭据

- 飞书配置 shall 持久化企业 ID、App ID、App Secret 与 OAuth 回调地址；MicroMatrix 继续使用通用 `EnterpriseIntegration`，其中 `agentId` 承载 Cordys 的飞书 App ID。
- App Secret shall 继续使用 CredentialCipher，不得明文落库、默认回显或写日志。
- 首次保存/测试必须提供 Secret；留空更新保留旧 Secret；关键凭据或回调地址变化必须提升 `credentialVersion`、使旧连接测试与同步预览失效。
- 连接测试 shall 通过 `tenant_access_token/internal` 获取真实 tenant access token；不得只做字段非空校验。
- 已经在任何数据库执行过的 migration 必须视为不可变；不得通过继续修改已应用的 `20260905084900_baseline` 向现有环境补字段。
- Lark 后续 schema 变更使用独立增量 migration `20260911153000_lark_provider_schema`，并同时验证“已有 baseline 数据库升级”和“空库从完整 migration 历史创建”两条路径。

## 3. 组织同步与身份映射

- 继续复用 `EnterpriseIntegration / ExternalDepartmentMapping / ExternalUserMapping / OrganizationSyncBatch`，不得新增 Lark 平行映射表。
- 飞书部门外部主键使用 `open_department_id`，根部门固定为 `0`；企业根名称来自 tenant info API。
- 飞书成员映射主键使用 `open_id`；不得改用 email/mobile 猜测身份。
- 子部门和部门成员均按 `page_token / has_more` 分页读取；成员读取使用每页 50，与 Cordys 当前实现一致。
- 多部门成员只归属 `orders[].is_primary_dept=true` 指定的主部门；不得简单使用 `department_ids[0]`。
- 预览、冲突处理、原子应用、缺失映射禁用、默认角色与 coordination 继续复用 provider-aware OrganizationSync 引擎，并按 `LARK` 隔离锁键和映射。

## 4. OAuth 与外部身份

- PC shall 提供飞书扫码/OAuth 登录入口；飞书客户端/容器和 Mobile shall 支持 OAuth 自动登录。
- PC 扫码授权使用飞书授权地址和 App ID；Mobile 使用 `https://open.feishu.cn/open-apis/authen/v1/authorize` 语义，回调路径必须保持站内安全 return path。
- OAuth code shall 使用 App ID/App Secret/redirect URI 换 user access token，再通过 user info API读取 `open_id`。
- 登录必须命中当前租户 ACTIVE `LARK` ExternalUserMapping；不得使用 email/mobile 自动匹配登录身份。
- 成功登录继续复用 `ExternalIdentity`、JWT、登录审计、state hash + browser nonce + TTL + 单次消费安全模型。

## 5. 消息 Provider

- `MessageTaskSetting.larkEnabled` shall 成为真实 channel gate，而非仅保留 Prisma enum/channel 常量。
- BusinessNotifications 已渲染的 title/content/link shall 进入通用 MessageDelivery outbox。
- 文本消息 shall 调用 `/open-apis/im/v1/messages?receive_id_type=open_id`，每个接收人使用其 ACTIVE LARK mapping 的 `open_id`。
- 请求体 shall 使用 `receive_id`、`msg_type="text"` 与 JSON 字符串 `content={"text":"..."}`；不得把 App ID 当接收人 ID。
- provider/网络瞬时错误继续有限重试，永久凭据/成员错误 fail-closed，外部发送失败不得回滚主业务事务。

## 6. Web / Mobile 与验收

- 企业设置第三方页 shall 提供飞书配置、连接测试、同步开关与默认角色。
- 组织架构 shall 提供飞书同步入口并复用同一个 OrganizationSync Drawer。
- 成员第三方登录身份 shall 支持 LARK 查看/绑定/解绑。
- 消息设置 shall 提供飞书逐事件开关、channel gate 和飞书投递记录。
- PC 登录页 shall 提供飞书登录入口；Mobile/飞书容器 shall 自动进入 Lark OAuth，手动登录模式仍可显式绕过自动跳转。
- Provider client、配置安全、组织快照、OAuth identity 与 MessageDelivery 专项测试必须全绿。
- fresh migration history + Seed、已有数据库升级、Prisma validate/diff、API Rules、root typecheck/lint/build、当前变更集 Prettier、`git diff --check` 与真实 Workbench Host Browser 验收均需通过后，方可标记 `VERIFIED`。
