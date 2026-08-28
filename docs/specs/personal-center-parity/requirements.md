# W3.5 用户个人中心对齐需求

## 目标

将当前仅位于 Header 且只有“退出登录”的用户入口，按 CordysCRM 对齐为完整个人中心，并复用现有用户、跟进计划和导出任务底座。

## 需求

1. 桌面用户入口移动到左侧菜单底部，Header 不再展示用户名。
2. 用户菜单包含：个人信息、我的计划、我的导出、退出系统；我的导出按导出权限显示。
3. 个人信息展示头像、姓名、角色、手机号、邮箱、部门。
4. 当前用户可自助修改手机号和邮箱；按 Cordys `countByPhone/countByEmail` 语义执行全局唯一性校验，并写入操作日志。
5. 当前用户可通过原密码修改密码；成功后服务端使已签发 access/refresh 会话立即失效，当前 Web 会话退出并返回登录页。
6. “我的计划”只展示当前用户计划，并继续执行目标资源读取权限。
7. “我的导出”只展示当前用户导出任务，可下载成功任务、取消/清理任务。
8. Mobile “我的”同步读取个人中心 API，支持手机号/邮箱编辑、修改密码和退出登录。
9. 拥有 `PERSONAL_API_KEY:READ` 时，个人中心显示 API Key Tab；按 ADD/UPDATE/DELETE 分权，最多 5 个，支持新增、列表、描述/有效期、启停和删除。
10. API Key 使用 Cordys `X-Access-Key / X-Secret-Key` 请求头真实调用受保护 API；停用或过期立即拒绝，所有 ID 操作按当前用户隔离。
11. 不重新设计 User/Role；只为服务端会话版本和 Cordys `user_key` 增加最小持久化模型。
12. 删除企业设置 → 第三方中重复的“开放 API / 365 天 JWT”入口与 `/auth/api-token` 旧接口；长期开放 API 凭证只保留个人 API Key。

## 验收

- Cordys `/personal/center/*` 与 `/user/api/key/*` 关键 API 路径存在且真实执行；
- API Key 权限、5 个上限、AK/SK 认证、启停/过期、跨用户隔离有自动化证据；
- Desktop/Mobile Browser 验收通过；
- 根 Smoke、rules、typecheck、ESLint、production build 与 diff check 全绿。
