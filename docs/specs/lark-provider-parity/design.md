# DB-015B 飞书 Provider 对齐设计

状态：`VERIFIED`

## 1. 设计原则

DB-015A 已将企业集成、组织同步、ExternalIdentity 与 MessageDelivery 收敛为 provider-aware 基座。DB-015B 不复制该状态机，只新增 `LARK` provider client、协议适配和 UI 入口。国际飞书 Lark Suite 不在本轮范围。

## 2. 数据模型

- `EnterpriseIntegration.provider=LARK` 复用现表。
- `corpId`：Cordys 飞书配置中的企业 ID。
- `agentId`：飞书 App ID。
- 新增通用可空 `redirectUrl`，供 LARK 显式保存 OAuth 回调地址；WECOM/DINGTALK 不受影响。
- Secret 继续使用现有 `secretCiphertext / secretIv / secretAuthTag / secretKeyVersion`。
- `MessageTaskSetting` 新增 `larkEnabled Boolean @default(false)`。
- `ExternalOAuthFlow` 增加 `QR_LARK / LARK / LARK_MOBILE`，分别隔离 PC 扫码、桌面飞书容器与 Mobile OAuth state。
- `MessageDeliveryChannel.LARK` 与 `EnterpriseIntegrationProvider.LARK` 已存在，直接启用 runtime。
- migration 采用 append-only 策略：`20260905084900_baseline` 保持已发布内容不变，Lark 新增枚举值、`redirectUrl` 与 `larkEnabled` 由 `20260911153000_lark_provider_schema` 增量升级。验收同时比较现有开发库与 fresh DB 到当前 Prisma Schema 的差异，禁止仅以 `prisma migrate status` 代替 schema diff。

## 3. LarkClient

生产默认指向 `open.feishu.cn`，测试允许通过 `LARK_API_BASE` 覆盖到本地 mock。

- `getTenantAccessToken(appId, secret)`：POST `/open-apis/auth/v3/tenant_access_token/internal`。
- `getTenantInfo(token)`：GET `/open-apis/tenant/v2/tenant/query`。
- `getOrganizationSnapshot(token)`：从根 `0` 获取子部门及成员，处理 `has_more/page_token`，按 `orders.is_primary_dept` 确定主部门，输出 provider-neutral OrganizationSnapshot。
- `exchangeUserAccessToken(...)`：POST `/open-apis/authen/v2/oauth/token`。
- `getOAuthProfile(accessToken)`：GET `/open-apis/authen/v1/user_info`，返回 `open_id` 等身份信息。
- `sendText(token, openId, text)`：POST `/open-apis/im/v1/messages?receive_id_type=open_id`。

## 4. 组织同步

`OrganizationSyncService` 的 provider switch 扩展到 LARK，Planner/Apply/coordination 不复制。部门 mapping externalKey=`open_department_id`；成员 mapping externalKey=`open_id`。同步默认角色、冲突绑定、disable/unchanged 语义完全沿用 DB-015A。

## 5. SSO

新增 `LarkSsoModule`，安全模型直接复用 DingTalk/WeCom：

1. discovery 只暴露必要公开配置和可用性；
2. start 生成随机 state + browser nonce，仅存 hash；
3. callback 先原子消费 state，再换 user token/profile；
4. 以 profile `open_id` 精确查当前租户 ACTIVE LARK mapping；
5. 创建/恢复 ExternalIdentity，更新 lastLoginAt，调用 AuthService 构建 JWT；
6. QR/Desktop/Mobile 使用独立 flow/cookie，防止跨流 replay。

## 6. 消息投递

MessageSettings 增加 LARK channel gate。MessageDelivery 对 LARK 按 tenant/provider 查运行配置和 ACTIVE external mapping，通过 LarkClient 发送已经渲染好的文本。成功保存飞书 message_id；provider code/HTTP 错误沿用现有 retry/dead 分类框架并使用 `LARK_*` errorCode。

## 7. UI 与验收

- `LarkIntegrationCard` 复用 DingTalk 卡片交互骨架，但字段为企业 ID / App ID / App Secret / 回调地址。
- `OrganizationSyncDrawer` 已 provider-aware，仅增加 LARK API branch。
- Member identity dialog 增加 LARK provider。
- PC Login/Callback 和 Mobile UA guard 增加 Lark/Feishu。
- MessageSettings/MessageDeliveryDrawer 扩展 LARK。
- 使用本地 Lark mock + fresh schema + Workbench Host Browser 做从配置→同步→OAuth→业务通知→投递记录的真实闭环。

## 8. 最终验收事实

- 当前开发库从已应用 baseline 升级 `20260911153000_lark_provider_schema` 后，database→schema diff=`No difference detected.`。
- 隔离 `db015b_final` 空库按 baseline → Lark 增量 migration 顺序 deploy，Seed PASS，database→schema diff=`No difference detected.`。
- 完整 API Rules **263/263 PASS**；Lark mock + 真实 Nest/PostgreSQL/HTTP smoke **36/36 PASS**。
- Workbench Host Browser 真实覆盖配置/连接测试、组织预览→应用→幂等复验、LARK ExternalIdentity、消息设置与“已送达”投递记录。
