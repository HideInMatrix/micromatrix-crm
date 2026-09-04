# UI-001 T11 PC 模块级 Top Menu 全仓审计

## 1. 审计规则

PC 端导航按三层职责划分：

```text
Sidebar
  -> 一级业务模块

Header Top Menu
  -> 同一一级业务模块下的并列业务路由

页面内部 Tabs / Segmented / Filter
  -> 当前路由内部的数据视图、详情分区或设置分区
```

核心判定标准：**切换后是否改变业务路由语义**。

- 改变业务路由语义：必须进入 Header Top Menu。
- 仅改变同一路由内部的数据集、详情分区、配置面板：继续保留页面内部 Tabs。

## 2. 必须改造为 Header Top Menu 的模块

| 模块 | 当前实现                                                       | 当前路由                                                                    | Cordys 对照                                       | 结论                                    |
| ---- | -------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------- |
| 线索 | `LeadModuleNav.vue` 在业务 Card 内使用 `el-tabs`               | `/leads`、`/leads/pool`                                                     | `clue.ts` 两个 child 均 `meta.isTopMenu=true`     | 必须迁移                                |
| 客户 | T10 已上移 Header，但仍由 `CustomerModuleNav.vue` 专用组件驱动 | `/customers`、`/contacts`、`/customers/open-sea`                            | `customer.ts` 三个 child 均 `meta.isTopMenu=true` | 改为通用 Top Menu                       |
| 商机 | 商机和报价是两个独立业务路由，当前 Header 没有统一同级导航     | `/opportunities`、`/quotes`                                                 | Cordys 商机/报价均为 `isTopMenu`                  | 必须补齐                                |
| 产品 | `ProductsView.vue` 用页面内 `el-tabs` 在“产品/价格表”之间切换  | 当前仅 `/products`                                                          | Cordys `product.ts` 的产品/价格表均为 `isTopMenu` | 拆分路由语义并迁移                      |
| 合同 | Sidebar 当前直接展开“合同/发票/工商抬头”子菜单                 | `/contracts`、`/contract/contractInvoice`、`/contract/contractBusinessName` | Cordys 合同子业务使用 Header Top Menu             | Sidebar 收口为单入口，子路由上移 Header |

### 2.1 当前未实现的 Cordys 合同子页

Cordys 合同模块还包含回款计划、回款记录等 Top Menu。当前项目没有对应 PC View/Router 时，不为了视觉对齐新增空页面；后续业务页面真实实现后再按本规范加入同一 `contract` Top Menu group。

## 3. 保留页面内部 Tabs 的位置

以下扫描结果属于**同一路由内部视图**，不迁移到 Header：

| 文件                                   | Tabs 语义                               | 处理 |
| -------------------------------------- | --------------------------------------- | ---- |
| `CustomerDetailDrawer.vue`             | 客户详情内部联系人等内容分区            | 保留 |
| `CustomerOverviewContent.vue`          | Customer 360 内部跟进/协作/资源 Tabs    | 保留 |
| `LeadOverviewDrawer.vue`               | 线索详情内部跟进等内容分区              | 保留 |
| `OpportunityDetailDrawer.vue`          | 商机详情内部详情/关联数据分区           | 保留 |
| `ContractDetailDrawer.vue`             | 合同详情内部合同明细等分区              | 保留 |
| `PersonalCenterDrawer.vue`             | 个人中心 Drawer 内个人信息/计划/API Key | 保留 |
| `DashboardView.vue`                    | 工作台设置 Dialog 内统计配置分区        | 保留 |
| `ApprovalsView.vue`                    | 同一审批中心路由的待办/已办等数据视图   | 保留 |
| `LogsView.vue`                         | 同一日志页面的操作日志/登录日志等数据集 | 保留 |
| `RolesView.vue`                        | 角色编辑区域内部权限/成员等分区         | 保留 |
| `enterprise-settings/SettingsView.vue` | 企业设置同一路由下配置面板导航          | 保留 |
| `GlobalTaskSettingsPanel.vue`          | 同一设置面板内任务视图                  | 保留 |

## 3.1 无需新增 Top Menu 的现有 PC 路由

| 范围                                               | 审计结论                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 订单 `/order/index`                                | 当前只有一个订单主业务路由，没有并列 sibling，不渲染单项 Top Menu。                                       |
| 系统 `/system/*`                                   | 组织、角色、模块配置、消息、流程、企业设置、日志属于不同设置域，继续由 Sidebar 二级菜单承担一级信息架构。 |
| `/system/modules/fields`、`/system/sales-settings` | 属于模块配置的下钻/动作页，不是并列一级业务子页；继续用 `activeMenu` 回指系统模块入口。                   |
| 首页 `/dashboard` 与仪表板 `/reports`              | 当前模块配置中分别属于 `home` 与 `dashboard` 两个 NavigationModule，不合并为同一 Top Menu group。         |
| 标讯、自定义表单                                   | 当前各只有一个主路由，不需要 Top Menu。                                                                   |
| 跟进计划、消息中心                                 | 属于 Header 工具动作进入的独立工作页面，不作为某个 Sidebar 业务模块的 sibling。                           |

第二轮扫描同时检查了 `el-segmented`、`el-radio-group`：合同“列表/看板”、商机“列表/看板”、审批条件、日志策略、系统设置等均只改变当前路由内部状态，不属于跨路由导航。

## 4. 通用化设计

禁止继续增加 `CustomerModuleNav.vue`、`LeadModuleNav.vue`、`ContractModuleNav.vue` 等模块专用导航组件。

Router Meta 统一提供 Top Menu 信息：

```ts
interface RouteMeta {
  topMenuGroup?: string
  topMenuLabel?: string
  topMenuOrder?: number
  topMenuActivePath?: string
}
```

- `topMenuGroup`：同一 Header 顶部导航组。
- `topMenuLabel`：存在该字段的路由才渲染为可点击 Top Menu item。
- `topMenuOrder`：组内顺序。
- `topMenuActivePath`：详情页等非菜单项路由指定应高亮的父业务路由。

`DefaultLayout` 只挂载一个通用 `PcTopMenu`，组件从 Router records + 当前 Route Meta + 权限计算菜单，不再硬编码客户、线索、合同等模块名称。

## 5. 本轮实施顺序

1. 建立通用 Route Meta 与 `PcTopMenu`。
2. 迁移客户，删除 `CustomerModuleNav.vue`。
3. 迁移线索，删除 `LeadModuleNav.vue`。
4. 迁移商机/报价。
5. 将产品/价格表改成两个路由语义并移除页面内模块 Tabs。
6. 合同 Sidebar 收口为单一级入口，合同/发票/工商抬头上移 Header。
7. 更新 Browser Smoke，验证 Header 位置、权限过滤、路由高亮和 Sidebar 高亮。

## 6. 最终实施结果

| 模块 | 最终结构                                                                         | 状态 |
| ---- | -------------------------------------------------------------------------------- | ---- |
| 线索 | Sidebar `线索`；Header `线索 / 线索池`                                           | 完成 |
| 客户 | Sidebar `客户`；Header `客户 / 联系人 / 客户公海`                                | 完成 |
| 商机 | Sidebar `商机`；Header `商机 / 报价`                                             | 完成 |
| 产品 | Sidebar `产品`；Header `产品 / 价格表`；路由拆为 `/products`、`/products/prices` | 完成 |
| 合同 | Sidebar 单一 `合同`；Header `合同 / 发票 / 工商抬头`                             | 完成 |

通用实现已落到 `apps/web/src/components/PcTopMenu.vue`。Router Meta 使用 `topMenuGroup / topMenuLabel / topMenuOrder / topMenuActivePath` 描述模块关系，`DefaultLayout` 仅挂载这一套 Header Top Menu。`CustomerModuleNav.vue`、`LeadModuleNav.vue` 及其自动生成声明已经删除，`apps/web/src` 中不再存在 `ModuleNav` 残留。

产品页同步完成请求边界收口：`/products` 只初始化产品字段和产品列表，不再预加载价格表列表；切换 `/products/prices` 后再初始化价格表字段、价格表列表和产品 options。独立 CDP Network 抓包已验证 `/api/price/page` 只在价格表路由按需发出。

第二轮最终扫描剩余 12 处 `el-tabs`，全部属于详情 Drawer、同路由数据视图或设置分区，符合本规范的“页面内部 Tabs”语义，没有发现新的跨路由模块导航遗漏。

所有相关模块开启后的专项验收 `pnpm smoke:ui001-pc-top-menu` 为 **40/40 PASS**。验收覆盖五组 Header Top Menu、模块配置启用态、一级 Sidebar 稳定态显示与高亮、并列子路由切换后高亮保持、产品页面模块 Tabs 移除、合同 Sidebar 去 SubMenu。

T11 状态：**VERIFIED**。
