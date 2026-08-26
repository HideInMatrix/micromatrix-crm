# W3.4.1 首页最终专项验收记录

> 执行单元：W3.4.1 / tasks 2.2～2.5
>
> 验收日期：2026-08-26
>
> 结论：W3.4.1 首页验收通过并关闭；下一执行单元进入 W3.4.2 线索与线索池。

## 1. 本轮闭环范围

W3.4.1 已按 Cordys 普通工作台源码完成以下闭环：

- 新建独立 `HomeModule`，首页统计不再复用旧 Dashboard 宽泛 Scope。
- 实现线索、商机、进行中商机、赢单四组统计，支持今日/本周/本月/本年自然周期、上一周期环比、本人/部门/全部数据范围。
- 首页统计点击使用一次性 `HomeFilterPayload` 进入真实线索/商机列表，目标列表再次执行模块权限、数据范围和字段语义校验。
- `/dashboard` 重建为 Cordys 普通工作台：默认密码提醒、数据概览、统计设置、刷新、快捷入口、我的计划、审批待办和消息通知。
- 快捷入口限制 1～5 个，按模块开关与动作权限过滤；跨页入口复用客户、联系人、线索、商机、合同、订单原有新增表单，发票、跟进记录、跟进计划使用真实业务 API/对话框。
- 默认密码状态落到 `User.defaultPwd`；成员创建/重置密码会重新标记，用户成功修改密码后清除。
- 审批抄送继续使用 Cordys 同源 `approval_task`，通过 `APPROVAL / CC` 任务类型区分；首页“抄送我的”不使用通知表伪造。

源码证据矩阵见 [W3.4.1 首页源码与 API 证据矩阵](./home-source-api-audit.md)。

## 2. 数据库与迁移

新增并已在本地开发 PostgreSQL 成功应用：

- `20260826150000_w341_default_password`：增加 `users.default_pwd`。
- `20260826151000_w341_approval_cc`：增加审批任务类型与审批节点抄送成员数据。

最终 `prisma migrate deploy` 检测到 32 个 migration，两条 W3.4.1 migration 均成功应用；`prisma validate` 通过。

仓库根 `db:migrate` 脚本会因本机系统 pnpm 11.22.0 与项目锁定 pnpm 10.30.3 冲突而被 package-manager 校验拦截，因此验收使用项目固定版本直接执行：

```text
/Users/muyi/.nvmd/bin/corepack pnpm@10.30.3 --filter @micromatrix/api exec prisma migrate deploy
```

未修改仓库或全局 pnpm 配置。

## 3. 自动化验收矩阵

| 验收项                               | 最终结果              |
| ------------------------------------ | --------------------- |
| Prisma validate / generate           | 通过                  |
| Shared / API / Web typecheck         | 通过                  |
| 全仓 ESLint                          | `0 error / 0 warning` |
| Shared / API / Web production build  | 通过                  |
| API 规则与公共底座测试               | `108/108`             |
| W3.4.1 首页真实 PostgreSQL/API Smoke | `17/17`               |
| W3.4.1 首页 Chrome Browser Smoke     | `12/12`               |
| 根关键链路 Smoke                     | `219/219`             |
| W3.2 企业微信组织同步 Smoke          | `23/23`               |
| W3.3 企微统一登录与消息通道 Smoke    | `19/19`               |

W3.4.1 `17/17` 专项 Smoke 使用临时隔离租户和真实 PostgreSQL 数据，覆盖：

- `defaultPwd` 登录返回、修改密码和状态清除。
- `SELF / DEPARTMENT / ALL` Scope。
- 今日统计、上一日环比、组织隔离、未转换线索口径。
- 无模块权限返回 403。
- 商机数量/金额、进行中阶段、赢单阶段与赢单金额。
- 首页统计点击后的真实线索/商机列表 `total` 与统计值一致。
- “抄送我的”与审批任务使用同一真实数据源。

Smoke 会在启动前清理历史 W3.4.1 临时租户，并按外键顺序在结束后删除本轮夹具，不向开发库遗留临时业务数据。

## 4. 浏览器验收

新增 `pnpm smoke:w341-home-browser`，不引入 Playwright/Puppeteer 等第三方运行时依赖，直接使用本机 Headless Chrome 的 DevTools Protocol。验收时使用：

- production API：`127.0.0.1:3100`
- Vite Web：`127.0.0.1:5174`，代理指向 3100
- Headless Chrome：固定 1440×1000 桌面视口，单独临时 profile

每次 Browser Smoke 会先清理当前 origin 的 local/session storage 与 cookies，避免上次登录状态影响结果。最终 `12/12` 覆盖：

1. 桌面登录页真实登录。
2. 登录后进入 `/dashboard` Cordys 普通工作台。
3. 数据概览、快捷入口、我的计划、我的待办、消息通知五个核心区域完整渲染。
4. 统计设置 Popover 可交互并显示负责人/创建人等 Cordys 维度配置。
5. 快捷入口设置展示“至少 1 个、最多 5 个”约束。
6. 当前权限/模块配置下至少存在一个真实快捷入口。
7. 实际快捷入口可打开对应真实新增页面或业务对话框；最终运行验证“新建客户”表单。
8. 审批待办进入真实审批页面。
9. 我的计划“查看更多”进入真实计划页面。
10. 消息通知“查看更多”进入真实通知页面。
11. 整个浏览器运行期间无未捕获 Runtime 异常。

浏览器验收结束后 API、Vite 和 Headless Chrome 临时进程均已关闭。

## 5. 回归与阶段边界

根 Smoke `219/219` 证明 W3.4.1 未破坏已验收的角色/数据范围、客户域、线索转换、池规则、导入导出、交易链、审批、通知、标讯和客户 360 等主链路。

W3.2 `23/23` 与 W3.3 `19/19` 再次通过，证明本轮 User 默认密码字段、审批 CC 模型和首页调用没有回归企微组织同步、统一登录及消息投递链路。

W3.4 总阶段仍保持 `IN_PROGRESS`。W3.4.1 关闭不提前关闭后续数据库条目：DB-016/017 继续等待 W3.4.2/W3.4.3 页面/API 闭环；DB-018 继续等待 W3.4.4 仪表板资源闭环；DB-020 仍按后续业务页面动态字段接入进度维护。

下一独立执行单元：**W3.4.2 线索与线索池**。
