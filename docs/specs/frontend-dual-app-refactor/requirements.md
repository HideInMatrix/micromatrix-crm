# UI-001 PC / Mobile 双应用重构需求

## 1. 目标

将当前 `apps/web` 同时承载 PC 与移动端的单应用结构，重构为与 CordysCRM 一致的“双前端应用 + 共享业务底座”结构：

```text
apps/web     -> PC 独立 Vue 应用，Element Plus
apps/mobile  -> Mobile 独立 Vue 应用，Vant 4
packages/*   -> PC / Mobile 共享类型、领域规则与可复用前端基础能力
```

本执行单元编号固定为 `UI-001`。本批优先完成应用边界、终端路由、构建链路与现有移动页面迁移，在此基础上继续执行 CordysCRM PC 视觉对齐和 Vant 4 移动端页面重构。

视觉与交互基线统一引用 [CordysCRM PC / Mobile UI 设计基线](../../cordys-ui-design-guide.md)。

## 2. 现状问题

- `apps/mobile/` 仅有空目录骨架，没有独立 `package.json`、Vite、Router、入口和构建产物。
- 真实移动端页面位于 `apps/web/src/views/**/mobile/`，移动端 Layout、Vant 依赖、移动 CSS 也在 `apps/web`。
- `apps/web` 同时依赖 Element Plus 与 Vant，PC 构建单元承担了不属于 PC 的移动组件和运行分支。
- Router 依赖 `matchMedia('(max-width: 768px)')` 在同一应用内动态选择 PC / Mobile View，应用边界不清晰。
- 当前根构建脚本只构建 `shared -> api -> web`，移动端没有独立 typecheck/build 契约。

## 3. 功能需求

### R1 双应用边界

- `apps/web` 只负责 PC 页面、PC Layout、PC Router 和 Element Plus 依赖。
- `apps/mobile` 必须成为完整独立 Vue/Vite 应用，拥有自己的 `package.json`、`index.html`、`main.ts`、Router、Layout、样式和 Vant 4 依赖。
- Mobile 生产构建 base 固定为 `/mobile/`，部署后通过同一域名的 `/mobile` 入口访问。
- PC 与 Mobile 使用同一后端 `/api`，不得复制后端业务实现。

### R2 同域名终端分流

- 用户访问根地址 `/`：移动终端自动进入 `/mobile`，PC 保持根入口。
- 用户访问 `/mobile`：PC 终端自动回到 `/`，移动终端保持 `/mobile`。
- 终端识别规则必须由 PC/Mobile 共用同一实现，避免判断规则不一致造成重定向循环。
- Chrome DevTools 开启移动设备模拟后，刷新根地址必须进入 Mobile；关闭设备模拟并刷新 `/mobile` 必须回到 PC。
- 自动跳转优先使用 `location.replace`，避免在浏览器历史栈中制造无意义的 PC/Mobile 跳转记录。
- 开发环境从 Web Vite `5173` 跳往 Mobile Vite `5174` 时必须直接进入 `/mobile/`，不得先落到 Vite 的 public base URL 提示页再要求用户手工点击 `/mobile/`。

### R3 终端识别规则

- 识别至少覆盖 `Mobile`、`Android`、`iPhone`、`iPod`、`iPad`、`MicroMessenger`、`wxwork`、`DingTalk`、`Lark` 等常见移动/企业应用 UA。
- 不能只使用 viewport 宽度决定应用入口；窗口缩窄不是切换应用的正式契约。
- DevTools 的设备模拟通过其 UA/设备环境触发移动端识别。

### R4 移动端 Vant 4

- `apps/mobile` 使用 Vant 4 当前项目冻结版本 `4.10.2`。
- Vant 自动按需注册，移动端不得依赖 Element Plus。
- 移动端继续遵守 safe-area、单列信息架构、卡片列表、Popup/独立详情、一级 Tabbar 等设计基线。
- `@vant/touch-emulator` 仅允许作为开发辅助，不进入 PC 应用依赖。

### R5 PC 依赖收口

- 当现有移动页面完成迁移后，从 `apps/web` 移除 Vant、Vant Resolver、Touch Emulator、Mobile Layout、Mobile Router 分支与移动专属 CSS。
- PC Router 不再包含 `client: mobile` 路由，不再通过 `isMobileClient()` 动态 import 移动页面。
- PC 继续使用 Element Plus，不因 CordysCRM 原版使用 Naive UI 而替换组件框架。

### R6 共享业务边界

- `@micromatrix/shared` 继续保持可被 API 与前端共同消费的纯 TypeScript 领域包，不引入 Vue、Pinia、Axios、DOM 等浏览器依赖。
- 前端跨应用复用的浏览器基础能力应进入独立前端共享层，避免把浏览器运行时依赖塞进 `@micromatrix/shared`。
- API DTO、领域类型、枚举、权限规则等继续复用 `@micromatrix/shared`。
- PC/Mobile 不应长期维护两份语义相同的终端识别、Token、HTTP 协议与业务 DTO。

### R7 登录、主题与权限

- PC 与 Mobile 继续使用相同 Token key，确保同域名下登录态可共享。
- 移动端登录请求必须继续标识正确的移动平台语义；现有鉴权、refresh token、权限校验不得回退。
- 企业主题色、平台标题、登录品牌配置应继续由现有企业设置能力提供，拆应用后不得硬编码破坏动态主题。

### R8 构建与开发

- 根 `pnpm build` 同时构建 `@micromatrix/web` 与 `@micromatrix/mobile`。
- 根 `pnpm typecheck` 同时覆盖两个前端应用。
- `apps/web` 与 `apps/mobile` 使用不同 Vite dev 端口，均代理 `/api` 到本地 API。
- 生产发布链路最终必须同时包含 PC `dist` 和 Mobile `dist`。

### R9 PC 模块级顶部导航

- PC 端凡同一左侧一级业务模块下存在多个并列路由页面，必须使用 Header 顶部业务菜单切换，不得在业务 Card 内继续使用 Tabs 承担模块级页面导航。
- 该规则适用于所有业务模块，不以客户模块为特例；线索、商机、产品、合同、订单、系统等模块均应按路由层级判断是否需要顶部菜单。
- 左侧菜单只表达一级业务域，Header Top Menu 表达当前业务域内的并列页面；详情/编辑等深层页面继续保持所属顶部父页面的激活态。
- Tabs 仅保留给同一路由内部的数据视图、详情内容区或配置分区，不得用于跨路由模块切换。
- 顶部菜单应由通用路由元数据/模块配置驱动，禁止长期为每个模块维护一套 `XxxModuleNav` 专用导航组件。
- 视觉基线：32px 高、约 16px 水平内边距、浅主色选中背景、无重边框或大尺寸下划线 Tab 风格。

## 4. 验收标准

### A. 架构验收

- [ ] `apps/mobile/package.json` 存在且 workspace 可识别 `@micromatrix/mobile`。
- [ ] Mobile 可以独立 `pnpm --filter @micromatrix/mobile typecheck`。
- [ ] Mobile 可以独立 `pnpm --filter @micromatrix/mobile build`，产物资源路径基于 `/mobile/`。
- [ ] Web 可以独立 typecheck/build。
- [ ] 最终 Web package 不再依赖 Vant；Mobile package 不依赖 Element Plus。

### B. 分流验收

- [ ] PC 浏览器访问 `/` 留在 PC。
- [ ] 手机浏览器访问 `/` 自动 replace 到 `/mobile`。
- [ ] 手机浏览器访问 `/mobile` 保持 Mobile。
- [ ] PC 浏览器访问 `/mobile` 自动 replace 到 `/`。
- [ ] Chrome DevTools 选择 iPhone/Android 后刷新根地址进入 Mobile。
- [ ] 关闭设备模拟后刷新 `/mobile` 回到 PC。
- [ ] 不出现 `/` 与 `/mobile` 之间的重定向死循环。

### C. 业务回归验收

- [ ] PC 登录、首页、线索、客户、审批等既有页面可继续访问。
- [ ] Mobile 登录、工作台、线索、客户、审批、跟进计划、我的等既有能力迁移后可访问。
- [ ] Token refresh、退出登录和无权限跳转正常。
- [ ] 企业主题、平台标题、品牌配置在双应用下继续生效。

### D. UI 验收

- [ ] PC 按 CordysCRM 基线执行 14px 主字号、32px 默认控件、180/56 侧栏、16px 页面间距、浅平台底和白色业务层。
- [ ] PC 所有“同一一级模块下的并列路由页面”均按 CordysCRM `isTopMenu` 语义使用 Header Top Menu，不再在业务 Card 内使用模块级 Tabs。
- [ ] PC Tabs 仅用于同一路由内部的内容/数据视图分区，模块级导航与页面内部 Tabs 的职责边界清晰。
- [ ] PC Header 右侧动作遵循 CordysCRM 32px 点击区、16px 图标、8px 动作间距。
- [ ] PC Sidebar 用户 `el-dropdown` 宽度占满侧栏；折叠按钮只保留图标；品牌区在 56px 折叠态取消水平 padding，避免 Logo/首字母被挤压。
- [ ] PC 数据列表页遵循 Cordys 两层工具区：第一层业务动作 + 搜索/筛选/表格图标工具，第二层视图操作；视图行不得位于新建/导入之前。
- [ ] Advanced Filter / Column Setting / Fullscreen / Refresh 等工具使用 16px 图标 + 32px 点击区，不以常驻文字按钮挤占工具区。
- [ ] `SavedViewBar` 不再承载列设置；管理视图进入视图选择器操作区；新增视图入口文案统一为“+ 新建视图”。
- [ ] `/products` 与 `/products/prices` 不得存在顶部 0 padding 特例，Card 内容留白与 PC 设计基线一致。
- [ ] Mobile 使用 Vant 4，列表以卡片为主，不把 PC Table 简单压缩到窄屏。
- [ ] Mobile 一级页面展示底部 Tabbar，详情/编辑页隐藏 Tabbar。
- [ ] iOS safe-area 与 Android 常见视口下无底部操作遮挡。

### E. 工程质量验收

- [ ] 根 `pnpm typecheck` PASS。
- [ ] 根 `pnpm build` PASS。
- [ ] `pnpm lint` 无 error。
- [ ] Prettier PASS。
- [ ] `git diff --check` PASS。

## 5. 本批明确不做

- 不替换 PC 的 Element Plus 为 Naive UI。
- 不通过 CSS media query 把一套 DOM 强行兼容两个终端。
- 不改变后端 API URL 与业务模型。
- 不在拆分应用的同时重写全部业务功能。
- 不为了目录拆分复制一套后端领域类型或权限规则。
