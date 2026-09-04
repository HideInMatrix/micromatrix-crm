# UI-001 PC / Mobile 双应用重构设计

## 1. 设计结论

目标结构采用 CordysCRM 的核心模式：**两个独立 Vue 应用，一个共享业务底座，同一域名按终端进入不同静态入口**。

```text
                        同一 CRM 域名
                             │
                 ┌───────────┴───────────┐
                 │                       │
              PC UA                 Mobile UA
                 │                       │
                 ▼                       ▼
           apps/web dist           /mobile
           Element Plus                │
                                       ▼
                                apps/mobile dist
                                     Vant 4
                 │                       │
                 └───────────┬───────────┘
                             ▼
                     frontend shared layer
                             │
                             ▼
                    @micromatrix/shared
                             │
                             ▼
                           /api
```

## 2. 与 CordysCRM 的对应关系

CordysCRM：

```text
frontend/packages/web        -> PC
frontend/packages/mobile     -> Mobile
frontend/packages/lib-shared -> 前端共享
```

MicroMatrix CRM：

```text
apps/web                     -> PC
apps/mobile                  -> Mobile
packages/frontend-shared     -> 浏览器前端共享能力
packages/shared              -> 前后端共享领域能力
```

这里不直接把所有前端共享代码塞入 `packages/shared`，原因是现有 `@micromatrix/shared` 同时被 NestJS API 使用。浏览器侧的 Vue/Pinia/Axios/DOM 依赖必须与前后端共享领域包隔离。

## 3. 终端分流

### 3.1 Web 入口

PC `index.html` 在加载 Vue 应用前执行轻量检测：

```text
isMobileDevice() = true
  -> production: location.replace('/mobile/')
  -> development: location.replace('http://localhost:5174/mobile/')

isMobileDevice() = false
  -> 正常启动 apps/web
```

入口前置检测的价值是避免先下载 PC Vue/Element Plus bundle 再由 Router 跳转。

### 3.2 Mobile 入口

Mobile `index.html` 采用相反校验：

```text
isMobileDevice() = false
  -> location.replace('/')

isMobileDevice() = true
  -> 正常启动 apps/mobile
```

双向校验满足本项目的开发习惯：Chrome DevTools 打开 Device Toolbar 后刷新即进入 Mobile，关闭设备模拟并刷新 Mobile 地址即回到 PC。

开发态目标路径必须带 `/mobile/` 尾斜杠。Vite Mobile 应用声明 `base=/mobile/`，若跳到 `http://localhost:5174/mobile`，Vite 会先返回 public base URL 提示页；该提示页不属于产品交互，终端分流必须直接命中 `/mobile/`。

### 3.3 共享检测实现

为了避免两个 HTML 各写一套正则，构建期/运行期共享同一套检测规则。规则以 UA 为主，不使用纯 viewport width 作为正式入口判断。

判定词至少覆盖：

```text
Mobile
Android
iPhone
iPod
iPad
MicroMessenger
wxwork
DingTalk
Lark
```

## 4. 应用目录

### 4.1 PC

```text
apps/web/
├── index.html
├── package.json
├── vite.config.ts
└── src/
    ├── layouts/
    ├── router/
    ├── views/
    ├── components/
    └── styles/
```

PC 内禁止继续存在：

- `views/**/mobile/`
- `MobileTabbarLayout.vue`
- `styles/mobile.css`
- Vant Resolver
- `isMobileClient()` 动态 View 分支

### 4.2 Mobile

```text
apps/mobile/
├── index.html
├── package.json
├── tsconfig*.json
├── vite.config.ts
└── src/
    ├── main.ts
    ├── App.vue
    ├── router/
    ├── layouts/
    ├── views/
    ├── components/
    └── styles/
```

Mobile Vite：

```text
base: /mobile/
dev port: 5174
/api proxy: API_PROXY_TARGET ?? http://localhost:3000
```

Vue Router 使用 `createWebHistory('/mobile/')`，应用内部路由继续写业务相对路径，例如 `/home`、`/leads`、`/customers`。

## 5. 共享层设计

### 5.1 `@micromatrix/shared`

保留：

- DTO / VO
- enums
- domain rules
- permission helpers
- pure utilities

禁止引入：

- Vue
- Pinia
- Axios
- window/document/localStorage

### 5.2 `@micromatrix/frontend-shared`

承载 PC/Mobile 都需要、但只能运行在浏览器的代码：

- device detection
- token storage
- HTTP client/refresh 基座
- auth/enterprise UI 等可共享 Pinia store
- 与 UI 框架无关的前端 composable

业务页面组件不进入共享层；PC 和 Mobile 应使用各自 UI 框架表达同一业务能力。

## 6. 迁移策略

采用“先建立新单元，再搬业务，最后删除旧分支”的顺序，避免 PC 和 Mobile 同时失去可运行入口。

```text
T1 规格冻结
  ↓
T2 frontend-shared + 终端检测
  ↓
T3 apps/mobile 独立 Vite/Router/Layout
  ↓
T4 迁移现有 mobile views/components
  ↓
T5 apps/web 删除 Vant/Mobile 分支
  ↓
T6 根构建与发布链路接入 mobile dist
  ↓
T7 PC 样式对齐 + Mobile Vant 4 页面重构
```

在 T4 完成前允许存在短期兼容层，但验收终态不允许 `apps/mobile` 通过 alias 直接指向 `apps/web/src`。两个应用必须能从自己的源码入口独立 typecheck/build。

## 7. Router 设计

### PC Router

PC Router 只保留 PC 路由。原 `client` 元数据和 `getClientMode()` 路由守卫在拆分完成后删除。

### Mobile Router

首批迁移现有移动能力：

```text
/login
/home
/leads
/leads/:id/convert
/customers
/customers/detail
/opportunities/detail
/approvals
/follow-plans
/mine
```

一级路由放入 Mobile Tabbar Layout；详情、转换、登录等页面独立于 Tabbar Layout。

## 8. UI 框架边界

### PC

```text
Element Plus + UnoCSS
```

按照 Cordys 视觉 Token 对齐，不替换组件框架。

### PC Header 顶部菜单与动作区

CordysCRM 对带有多个同级业务入口的模块使用 Router `meta.isTopMenu` 驱动 Header 横向菜单，而不是在页面 Card 内放 Tabs。这是 **PC 全局模块级导航规则**，不是客户模块特例。

PC 导航职责固定分层：

```text
左侧 Sidebar
  -> 一级业务模块

Header Top Menu
  -> 当前一级业务模块下的并列路由页面

页面内部 Tabs
  -> 当前路由内部的数据视图 / 内容分区
```

判断原则是“切换是否改变业务路由语义”：

- 改变并列业务路由：必须进入 Header Top Menu。
- 不改变当前业务路由，只切换当前页面内部的数据或内容：可以使用 Tabs。

例如以下结构原则上都进入 Top Menu 治理范围：

```text
客户：客户 / 联系人 / 客户公海
线索：线索 / 线索池
商机：商机 / 报价（若路由与模块配置归属同一一级业务域）
产品：产品 / 价格表（若路由与模块配置归属同一一级业务域）
合同：合同 / 回款计划 / 回款记录 / 发票 / 工商抬头
```

实际是否归入同一 Top Menu 仍以 Router 父子关系、模块配置和权限模型为准，不能只根据页面名称机械合并。

实现终态应参考 CordysCRM `meta.isTopMenu`，把顶部菜单定义收敛到路由元数据或统一模块配置，由 `DefaultLayout` 中的通用 Top Menu 自动渲染。当前客户模块专用 `CustomerModuleNav` 仅视为迁移阶段实现，不应继续复制出 `ContractModuleNav`、`OpportunityModuleNav` 等模块专用导航组件。

顶部菜单视觉基线：高度 32px、左右 padding 16px、4px 圆角、选中态使用浅主色背景。

Header 右侧动作区按照 CordysCRM `layout-header.vue` 收口为：

- 动作间距 8px；
- 图标 16px；
- 单个图标按钮 padding 8px，即约 32px × 32px 点击区；
- 普通动作使用弱背景/无边框 hover，不使用 20px 图标配大间距。

Sidebar 底部用户入口的 `el-dropdown` 必须 `width: 100%`，确保按钮可占满 180/56px 侧栏可用宽度。折叠控制只展示图标，不显示“收起菜单”文字；56px 折叠态品牌容器取消水平 padding。

### PC 列表页两层工具区

PC 数据列表页统一参考 CordysCRM `CrmTable + CrmViewSelect`：

```text
第一层：业务主动作                       搜索 / 筛选 / 列设置 / 模式 / 全屏 / 刷新
第二层：系统/固定视图 + 新建视图                              视图选择器
第三层：Table / Board
```

- 第一层左侧只承载新建、导入、导出全部等业务动作；
- 第一层右侧工具动作使用 16px 图标、32px 点击区、8px 间距；
- 搜索框使用内嵌搜索图标，不额外放置“搜索”文字按钮；
- Advanced Filter、Column Setting、Fullscreen、Refresh 禁止使用常驻文字按钮；
- 商机、合同等列表/看板切换使用图标模式选择；
- 第二层 `SavedViewBar` 必须排在第一层之后；
- `SavedViewBar` 不承担列设置；“管理视图”进入视图选择器操作区；
- 产品/价格表按 Cordys 页面保持无视图行结构。

详细页面审计与迁移矩阵见 `pc-table-toolbar-audit.md`。

### Mobile

```text
Vant 4.10.2 + UnoCSS
```

移动页面以 Vant 组件语义重构，禁止继续引入 Element Plus 类型或组件。

## 9. 发布结构

生产静态资源目标：

```text
web dist    -> /
mobile dist -> /mobile/
```

无论最终由 Nginx 还是现有 Web 容器承载，都必须保证：

- `/assets/*` 对应 PC 资源；
- `/mobile/assets/*` 对应 Mobile 资源；
- `/mobile/*` SPA fallback 到 Mobile `index.html`；
- PC SPA fallback 不能吞掉 `/mobile/*`。

## 10. 回滚边界

双应用拆分期间每个任务单元必须保持可构建。若 Mobile 迁移未完成，不提前删除 Web 中仍被生产路径使用的移动代码；只有独立 Mobile typecheck/build 与关键页面 smoke 通过后，才执行 PC 侧清理。
