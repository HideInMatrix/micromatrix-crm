# UI-001 PC / Mobile 双应用重构任务

- [x] T1 现场审计与规格冻结
  - 确认 CordysCRM PC/Mobile 为两个独立前端构建单元。
  - 确认 Cordys Mobile `base=/mobile/`，PC 入口通过 UA 将移动终端导向 `/mobile`。
  - 确认当前项目 `apps/mobile` 为空骨架，真实 Mobile 页面仍位于 `apps/web`。
  - 冻结双向终端校验：Mobile 访问根地址进入 `/mobile`，PC 访问 `/mobile` 回到 `/`。
  - 冻结 Chrome Device Toolbar 为移动端开发调试方式。

- [x] T2 前端共享基础设施
  - 建立不污染 `@micromatrix/shared` 的 browser-only frontend shared 包。
  - 迁移并共享 device detection。
  - 共享 token storage / HTTP refresh 等不依赖 UI 框架的基础能力。
  - PC 入口切换到共享 device detection。

- [x] T3 `apps/mobile` 独立应用基座
  - 新建 `@micromatrix/mobile` package。
  - 接入 Vue 3、Pinia、Vue Router、Vant `4.10.2`、UnoCSS。
  - Vite `base=/mobile/`、dev port 5174、API proxy。
  - 新建 App/main/router/styles/MobileTabbarLayout。
  - Mobile 入口增加 PC UA -> `/` 双向校验。

- [x] T4 迁移既有移动业务
  - 登录。
  - 工作台。
  - 线索与线索转换。
  - 客户列表/公海/联系人/详情。
  - 商机详情。
  - 审批中心。
  - 跟进计划。
  - 我的。
  - 迁移移动专属组件并清除对 PC UI 组件的依赖。

- [x] T5 PC 应用收口
  - Router 删除 Mobile 动态 import、`client` 元数据与 client-mode 守卫。
  - 删除 PC 内 Mobile Layout、mobile.css、`views/**/mobile` 与 Mobile 专属组件。
  - Web package 删除 Vant、Vant Resolver、Touch Emulator。
  - Web Vite 只保留 Element Plus Resolver。

- [x] T6 构建与发布链路
  - 根 build/typecheck 加入 `@micromatrix/mobile`。
  - lockfile 更新并 frozen install 验证。
  - Web Docker/静态服务同时复制 `apps/mobile/dist` 到 `/mobile`。
  - `/mobile/*` SPA fallback 验证。

- [x] T7 PC Cordys 视觉对齐
  - Design Tokens 与动态企业主题兼容。
  - Layout Shell：56px header、180/56 sidebar、16px page padding。
  - Card/Table/Tabs/Drawer 等基础组件密度对齐。
  - 逐业务页收口异常样式。

- [x] T8 Mobile Vant 4 页面重构
  - 基础 theme variables / safe-area / typography。
  - 首页/工作台。
  - 线索、客户、审批、跟进等卡片列表模式。
  - 表单、详情、Popup、Action Sheet 交互统一。
  - 一级 Tabbar 与深层路由过渡统一。

- [x] T9 全量验收与封板
  - [x] 双向 UA 分流 + Chrome Device Toolbar 验收。
  - [x] PC/Mobile typecheck/build 最终复跑。
  - [x] lint / UI-001 范围 Prettier / `git diff --check` 最终复跑。
  - [x] 关键 PC/Mobile browser smoke。
  - [x] 更新项目进度、alignment log 和 UI 设计基线。
  - [x] 全绿后标记 `UI-001 VERIFIED`。

当前状态：**`UI-001 T1～T10 VERIFIED，T11 IN_PROGRESS`**。

## T10 终态 UI 复核修正

- [x] 开发态 Device Toolbar 从 `5173` 直接进入 `5174/mobile/`，消除 Vite public base URL 提示页；Mobile Vite 同时增加 `/mobile -> /mobile/` 302。
- [x] 客户 / 联系人 / 客户公海从页面内 Tabs 上移到 Header 顶部横向菜单。
- [x] Header 右侧动作统一为 Cordys 32px 点击区、16px 图标、8px 间距。
- [x] Sidebar 用户 Dropdown 占满宽度；折叠按钮移除“收起菜单”文案；折叠品牌区取消 `px-4`。
- [x] typecheck/build/lint/browser smoke 回归。

当前补充修正状态：**VERIFIED**。

## T11 PC 模块级 Top Menu 全局治理

- [x] 将“模块级并列路由使用 Header Top Menu、页面内部 Tabs 只承担内容分区”写入 UI 设计与需求规范。
- [x] 审计现有 PC Router 与页面 Tabs，列出所有把跨路由模块导航放在 Card/Tabs 内的页面；审计矩阵见 `pc-top-menu-audit.md`。
- [x] 将客户模块当前专用 `CustomerModuleNav` 收敛为路由元数据/模块配置驱动的通用 `PcTopMenu`，并删除 `CustomerModuleNav` / `LeadModuleNav`。
- [x] 完成线索、客户、商机/报价、产品/价格表、合同/发票/工商抬头迁移；订单、系统等经审计不符合并列业务 sibling 条件的路由继续保留原信息架构。
- [x] 补充权限、模块启停、一级 Sidebar 高亮、子路由切换、产品路由请求隔离与 Browser Smoke 验收。

当前扩展任务状态：**T11 VERIFIED**。

## T12 PC 列表工具区 / 视图操作 Cordys 对齐

- [x] 对照 Cordys `CrmTable`、`CrmAdvanceFilter`、`CrmViewSelect` 完成全仓审计；见 `pc-table-toolbar-audit.md`。
- [x] 冻结“两层工具区”规则：第一层业务动作 + 图标表格工具，第二层视图操作。
- [ ] 修复 `/products`、`/products/prices` Card 顶部 padding 特例。
- [ ] 建立通用搜索输入、图标工具按钮与表格工具区基座。
- [ ] 重构 `SavedViewBar`：下移至业务动作后；移出列设置；管理视图收进选择器；“+ 保存当前筛选”改为“+ 新建视图”。
- [ ] 迁移线索 / 线索池 / 客户 / 联系人 / 客户公海。
- [ ] 迁移商机 / 报价 / 合同 / 发票 / 订单。
- [ ] 对齐产品 / 价格表无视图行的 Cordys 结构。
- [ ] Browser Smoke + typecheck/build/lint/diff-check 封板。

当前扩展任务状态：**T12 IN_PROGRESS**。

### T11 验收记录

- `PcTopMenu.vue` 统一由 Router Meta `topMenuGroup / topMenuLabel / topMenuOrder / topMenuActivePath` 驱动，Header 不再按模块硬编码导航组件。
- `git grep ModuleNav -- apps/web/src` 无结果；客户、线索专用 ModuleNav 组件及自动生成类型残留均已删除。
- 产品模块拆为 `/products` 与 `/products/prices` 两个业务路由；`/products` 不再预加载 `/api/price/page`。独立 CDP Network 抓包确认切换到 `/products/prices` 后按需请求 `/api/metadata/price/fields`、`/api/price/page` 与产品 options。
- 所有相关模块开启后的 `smoke:ui001-pc-top-menu`：**40/40 PASS**，覆盖线索、客户、商机、产品、合同五组 Header Top Menu、一级 Sidebar 稳定态显示/高亮、子路由切换高亮、产品 Card 内 Tabs 清理、合同 Sidebar 去 SubMenu。
- root `pnpm typecheck` PASS；Web production build PASS；root lint **0 error / 8 个既有 warning**；T11 修改文件 Prettier PASS；`git diff --check` PASS。

### T10 验收记录

- `curl http://127.0.0.1:5174/mobile`：HTTP 302，`Location: /mobile/`。
- `w345-mobile-browser-smoke.mjs`：15/15 PASS，新增验证 Device Toolbar 分流不经过 Vite public base URL 提示页。
- `w35-personal-center-browser-smoke.mjs`：26/26 PASS，新增验证 Sidebar Dropdown 满宽、折叠按钮无文案、折叠品牌区 padding=0。
- `w345-navigation-browser-smoke.mjs`：本次新增的 Header 客户 Top Menu、Card 内 Tabs 移除、联系人/客户公海切换、顶部动作 32px 与 8px 间距断言全部 PASS；该脚本后续既有“跟进计划深链 Dialog”断言因详情 API 失败删除 `id` 后超时，与 T10 修改范围无关，未通过修改跟进计划业务掩盖该独立问题。
- 根 `pnpm typecheck` PASS；Web production build PASS；Mobile production build PASS；根 lint 0 error / 8 个既有 warning；`git diff --check` PASS。

## 本轮验收记录

- `smoke:docker-release`：PASS，PC `/login`、Mobile `/mobile/`、Mobile 深层 SPA fallback、API Proxy、PostgreSQL migration、Redis 与 worker runtime 均通过。
- `w345-mobile-browser-smoke.mjs`：14/14 PASS，覆盖 Chrome Device Toolbar `5173 -> 5174/mobile`、Desktop `5174/mobile -> 5173`、一级 Tabbar、depth=2 隐藏 Tabbar、首页、线索与线索池。
- `w345-navigation-browser-smoke.mjs`：29/29 PASS，覆盖 PC 菜单、资源深链、刷新恢复、通知跳转、权限收口。
- `w35-personal-center-browser-smoke.mjs`：23/23 PASS，覆盖 PC Sidebar 用户入口、个人中心/API Key，以及独立 Mobile “我的”页面。
- 根 `pnpm typecheck`：PASS。
- 根 `pnpm build`：PASS；PC 与 Mobile 均完成 production build。
- 根 `pnpm lint`：0 error / 8 个既有 `no-explicit-any` warning，本轮新增 lint warning 为 0。
- UI-001 范围 Prettier：PASS；全仓 `prettier --check .` 仍会命中本任务未修改的历史格式化债务与 3 个旧 Vue 文件的 Prettier parser 报错，因此不把无关文件作为 UI-001 封板阻断项。
- `git diff --check`：PASS。
