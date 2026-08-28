# W3.5 用户个人中心对齐任务

- [x] 1.1 读取 Cordys 用户菜单、个人中心、密码、我的计划、我的导出与 Mobile 源码并形成证据矩阵。
- [x] 1.2 实现 `/personal/center/*` Cordys API facade 与 CurrentUser phone 补齐。
- [x] 1.3 重建桌面侧边栏底部用户菜单和个人中心 Drawer。
- [x] 1.4 接入我的计划、我的导出、退出登录和改密后强制重新登录。
- [x] 1.5 对齐 Mobile “我的”个人信息、手机号/邮箱和改密入口。
- [x] 1.6 补齐 Cordys 条件式 API Key Tab、`PERSONAL_API_KEY:*` 权限、`/user/api/key/*` 生命周期与 AK/SK Guard。
- [x] 1.7 API + Desktop/Mobile Browser Smoke、全量回归、空库复放、文档收口与本地提交。

验收结果：Personal Center/API Key API **44/44**、Desktop/Mobile Browser **23/23**、根级 Smoke **223/223**、rules **114/114**，全仓 typecheck、ESLint、production build 全绿；隔离空库 **14/14**，可从零应用 **37/37 migration** 并连续 Seed 两次。

关键边界：个人信息修改写操作日志；手机号/邮箱全局唯一；改密后旧 access/refresh 会话立即失效；API Key 最多 5 个，支持更新/启停/过期/删除，AK/SK 可真实调用受保护 API，跨用户 ID 操作拒绝。已删除企业设置中重复的“开放 API / 365 天 JWT”旧链路，开放 API 凭证只保留 Cordys 个人 API Key。Cordys API 模块虽然导出 `sendEmailCode`，但当前个人信息/改密组件没有实际调用链，本阶段不新增死 API。

当前状态：**VERIFIED**。
