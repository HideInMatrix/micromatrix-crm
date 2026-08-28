# W3.5 用户个人中心技术设计

## 后端

- 新增 `PersonalCenterModule`，Controller 前缀 `/personal/center`。
- `GET /info` 从当前认证用户、部门、角色和 `UserExtension` 组装专用 VO。
- `POST /update` 只允许修改 `phone/email`；手机号、邮箱均按 Cordys 用户级语义做全局唯一，并复用 `BusinessChangeLogService` 写字段 diff。
- `POST /info/reset` 复用 `AuthService.changePassword`，不复制密码校验逻辑；成功事务内更新密码并递增 `User.authVersion`。
- `POST /follow/plan/list` 复用 `FollowUpPlansService.list(..., mine=true)`，输出 Cordys Pager 形状。
- 导出中心继续复用现有 `/export-tasks/*`，不增加重复 ExportTask 表和 Service。
- 新增 Cordys `/user/api/key/add|list|update|delete/:id|enable/:id|disable/:id`，使用 `PERSONAL_API_KEY:READ/ADD/UPDATE/DELETE` 四个源码权限码。
- `UserApiKey` 映射 Cordys `user_key`；每个用户最多 5 个，所有更新/启停/删除额外校验当前用户所有权。
- 全局 `AuthGuard` 在 Bearer JWT 之外接受 `X-Access-Key / X-Secret-Key`；校验 Secret、启用状态、到期时间和用户状态后复用原角色/数据权限链。
- JWT access/refresh 全部携带 `authVersion`；改密自增版本后旧会话即时失效，适配多实例部署，不依赖内存黑名单。
- 删除早期自研的企业设置“开放 API / 365 天 JWT”链路；Cordys 将开放 API 凭证归属于个人中心 API Key，企业“三方设置”只承载企微/钉钉/飞书/DataEase/MaxKB/标讯/企查查等企业级集成。

## Web

- `DefaultLayout` 左侧菜单保持 `flex-column`，用户触发器位于菜单底部固定区。
- 个人信息/我的计划/API Key 使用全屏 `PersonalCenterDrawer`；API Key Tab 只在 `PERSONAL_API_KEY:READ` 时出现。
- 我的导出通过 `ExportTaskButton` 暴露的 `open()` 复用原 Drawer；Header 去掉旧“导出任务”文本入口和用户名下拉。
- 改密成功后清空本地 token 并跳转登录页。
- Drawer 使用 `[visible, activeTab]` 单一组合 watcher，避免从 API Key 关闭后经左下菜单进入“我的计划”时重复请求列表。

## Mobile

- `/mine` 继续作为既有 Mobile “我的”入口。
- 页面加载 `/personal/center/info`，手机号/邮箱与密码编辑使用底部 Popup。

## 数据模型

现有 User/Role 结构保持不重设计。本轮新增两个最小数据库变更：

- `User.authVersion`：服务端会话版本，用于改密后即时吊销历史 JWT；
- `UserApiKey` / `user_key`：Cordys 个人 AK/SK 生命周期模型。

对应 migration：`20260828170500_personal_center_auth_version`、`20260828173000_personal_api_keys`。
