# W3.5 用户个人中心 Cordys 源码与 API 审计

## 1. 范围

本执行单元对齐 CordysCRM 用户入口与个人中心，不重新设计用户/角色模型。行为第一事实来源为 CordysCRM 源码，截图只用于确认位置与视觉层级。

桌面入口源码：

- `frontend/packages/web/src/layout/components/layout-sider.vue`
- `frontend/packages/web/src/layout/default-layout.vue`
- `frontend/packages/web/src/views/system/business/components/personalInfoDrawer.vue`
- `frontend/packages/web/src/views/system/business/components/editPersonalInfoModal.vue`
- `frontend/packages/web/src/views/system/business/components/editPasswordModal.vue`
- `frontend/packages/web/src/views/system/business/components/personalExportDrawer.vue`

后端源码：

- `backend/crm/.../PersonalCenterController.java`
- `backend/crm/.../PersonalCenterService.java`
- `PersonalInfoRequest.java`
- `PersonalPasswordRequest.java`

移动端源码：

- `frontend/packages/mobile/src/views/mine/index.vue`
- `frontend/packages/mobile/src/views/mine/detail.vue`

## 2. Cordys 桌面交互事实

用户入口位于左侧菜单底部，不放在顶部 Header。下拉项顺序：

1. 当前用户名；
2. 个人信息；
3. 我的计划；
4. 我的导出（拥有客户/线索/商机任一导出权限时出现）；
5. 退出系统。

个人信息与我的计划进入同一个全屏 `PersonalInfoDrawer`：

- 个人信息展示头像、姓名、角色、手机号、邮箱、部门；
- 可修改手机号、邮箱；
- 可修改密码；
- 我的计划复用当前用户 FollowUpPlan 数据；
- 修改密码成功后退出当前会话。

我的导出单独打开导出 Drawer，只展示当前用户任务，可下载成功任务、取消/清理任务。

### 企业“三方设置”与个人 API Key 的边界

Cordys `views/system/business/index.vue` 的“三方设置”加载 `integrationList.vue`，其企业级集成来源明确为企微、钉钉、飞书、DataEase、MaxKB、大单网与企查查等外部平台；该页面没有“开放 API / 开发 API”凭证签发入口。

Cordys 开放 API 凭证归属个人中心：`personalInfoDrawer.vue` 在拥有 `PERSONAL_API_KEY:READ` 时显示 API Key Tab，管理接口独立为 `/user/api/key/*`。因此 MicroMatrix 早期放在“企业设置 → 第三方”的 365 天 JWT 令牌属于重复且位置错误的自研遗留，W3.5 直接删除，不保留兼容入口。

## 3. Cordys API 契约

| API | 语义 |
| --- | --- |
| `GET /personal/center/info` | 当前用户详情 |
| `POST /personal/center/update` | 更新当前用户手机号/邮箱，校验唯一性 |
| `POST /personal/center/info/reset` | 校验原密码后修改密码并使当前会话退出 |
| `POST /personal/center/follow/plan/list` | 当前用户“我的计划”分页 |
| `/system/export-center/*` | 当前用户导出中心 |
| `GET /user/api/key/add|list` | 当前用户 API Key 新增/列表 |
| `POST /user/api/key/update` | 修改描述与有效期 |
| `GET /user/api/key/enable/:id|disable/:id|delete/:id` | 启停/删除本人 API Key |

`PersonalInfoRequest` 字段只有 `phone/email`；`PersonalPasswordRequest` 为 `originPassword/password`。

## 4. MicroMatrix 当前事实与差距

已有能力：

- `User` 已有 `phone/email/deptId/name/gender/defaultPwd`；头像在 `UserExtension.avatar`；
- `CurrentUser` 已有姓名、邮箱、部门、角色、头像，但缺少 `phone`；
- `/auth/me` 已能恢复当前用户；
- `/auth/change-password` 已校验原密码、更新 bcrypt hash、清理 `defaultPwd`；
- `FollowUpPlansView` 与 `/follow-up-plans/*` 已存在；
- `ExportTaskButton` 与 `/export-tasks/*` 已是“当前用户导出任务”。

差距：

- 用户入口在 Header 顶部且只有“退出登录”；
- 没有 Cordys `/personal/center/*` API facade；
- 没有桌面个人中心 Drawer；
- 没有用户自助手机号/邮箱更新；
- 我的计划/我的导出没有从用户入口进入；
- Mobile “我的”只有静态账号/企业信息，不能编辑手机号/邮箱和密码。

## 5. 实施决策

1. 不重新设计用户/角色模型；新增 `authVersion` 与 `UserApiKey` 两个最小持久化能力分别承载改密会话失效和 Cordys `user_key` 生命周期。
2. 新增 `PersonalCenterModule`，提供 Cordys 路径 `/personal/center/info|update|info/reset|follow/plan/list`。
3. `/personal/center/info` 返回专用 `PersonalCenterVO`，包含 `userId/userName/phone/email/departmentName/roles/avatarUrl/passwordLoginEnabled`。
4. 手机号唯一性按当前租户校验；邮箱继续按当前系统登录账号约束做全局唯一冲突检查，避免跨租户登录歧义。
5. 修改密码复用 `AuthService.changePassword`；Web 成功后清理本地 token 并回登录页。
6. 我的计划 facade 复用现有 FollowUpPlan service，不复制计划模型。
7. 我的导出直接复用 `/export-tasks/*`；Web 只移动入口，不重新实现任务数据。
8. 桌面把用户入口从 Header 移到侧边栏底部；Header 保留顶部任务/通知/事件/帮助等全局动作。
9. Mobile “我的”同步接个人信息 API，并提供手机号、邮箱与密码编辑。
10. 删除企业设置 → 第三方中的旧“开放 API / 365 天 JWT”卡片、`POST /auth/api-token` 与 `AuthService.issueApiToken()`；长期开放 API 只保留个人 AK/SK。

## 6. 验收门槛

- Personal Center API Smoke：详情、更新、唯一性、密码错误/成功、计划分页、租户边界；
- Desktop Browser：侧边栏底部入口、菜单顺序、个人信息 Drawer、计划、导出、退出；
- Mobile Browser：个人信息展示与编辑入口；
- 根 Smoke / rules / typecheck / ESLint / production build / `git diff --check` 全绿。
