# UI-001 T12 PC 列表工具区 / 视图操作全仓审计

## 1. 审计目标

本轮不再只对齐颜色和间距，而是统一 PC 端数据列表页的信息架构。

CordysCRM 的典型业务列表页采用两层工具区：

```text
第一层：业务动作 + 检索/表格工具
┌─────────────────────────────────────────────────────────────┐
│ 新建 / 导入 / 导出全部              搜索  筛选  列设置  全屏  刷新 │
└─────────────────────────────────────────────────────────────┘

第二层：视图操作
┌─────────────────────────────────────────────────────────────┐
│ 系统/固定视图 + 新建视图                         视图选择器  [图表] │
└─────────────────────────────────────────────────────────────┘
```

页面内部不应把视图操作放在新建/导入之前，也不应把“列设置、管理视图、高级筛选、刷新、全屏”等工具长期以文字按钮横向铺开。

## 2. Cordys 源码基线

### 2.1 `CrmTable`

参考：

- `CordysCRM/frontend/packages/web/src/components/pure/crm-table/index.vue`

职责：

- `actionLeft`：新建、导入、导出全部等业务主动作；
- `actionRight`：搜索/高级筛选，以及表格工具；
- `ColumnSetting`：16px 设置图标，外层 32px 按钮；
- Fullscreen：16px 图标，32px 按钮；
- Refresh：16px 图标，32px 按钮；
- 右侧工具间距统一 8px；
- `view` slot 位于第一层工具区之后。

### 2.2 `CrmAdvanceFilter`

参考：

- `CordysCRM/frontend/packages/web/src/components/pure/crm-advance-filter/index.vue`

职责：

- 搜索输入框默认约 240px；
- 搜索动作放在输入框后缀图标中，不额外占一个“搜索”文字按钮；
- 高级筛选使用 16px Filter 图标按钮；
- 高级筛选激活时使用 Primary 状态，并允许清空。

### 2.3 `CrmViewSelect`

参考：

- `CordysCRM/frontend/packages/web/src/components/business/crm-view-select/index.vue`

职责：

- 左侧展示系统视图 / 固定个人视图；
- 左侧提供 `+ 新建视图`；
- 右侧为统一视图选择器；
- Cordys 原组件的 Select header/action 中提供“新增 / 管理视图”，options 也带系统视图/个人视图分组；
- 部分业务模块额外提供视图数据分析图标；合同、报价、订单等 Cordys 页面不展示该数据分析图标。

### 2.4 Cordys 页面差异

#### 线索 / 客户 / 联系人 / 客户公海 / 商机

均使用两层工具区：

1. 新建 / 导入 / 导出全部 + 搜索/筛选/列设置/全屏/刷新；
2. `CrmViewSelect`。

商机的“列表 / 看板”不是文字 Radio，而是第一层右侧的图标型模式切换。

#### 产品 / 价格表

Cordys 产品、价格表不使用 `CrmViewSelect`：

- 只保留第一层业务动作和表格工具；
- 价格表页面内容容器明确存在 `px-[16px] pt-[16px]`，不存在顶部 0 padding。

#### 合同 / 报价 / 发票 / 订单

继续使用视图选择能力，但 Cordys `CrmViewSelect` 不展示视图数据分析图标。

## 3. MicroMatrix 当前问题

### 3.1 产品 / 价格表顶部 padding

`apps/web/src/views/products/ProductsView.vue` 当前存在：

```css
.product-page-card :deep(.el-card__body) {
  padding: 0 16px 16px;
}
```

它覆盖了项目统一 `el-card__body { padding: 24px; }`，导致 `/products` 与 `/products/prices` 第一行操作紧贴 Card 顶边。

结论：删除产品页面的顶部 0 padding 特例，恢复项目 PC Card 的统一内容留白。

### 3.2 `SavedViewBar` 职责混乱

当前 `SavedViewBar.vue` 同时承担：

- 系统/固定视图；
- `+ 保存当前筛选`；
- 个人视图选择；
- “列设置”文字按钮；
- “管理视图”文字按钮。

问题：

1. 多数页面把 `SavedViewBar` 放在新建/导入操作之前；
2. 列设置属于表格第一层工具，不属于视图行；
3. 当前项目确认采用简化下拉：选择器只承载真实视图选项，不再承载新增/管理/分组蓝色文案；
4. `+ 保存当前筛选` 与 Cordys `+ 新建视图` 语义/文案不一致；
5. 文字工具按钮过多，导致右侧功能区宽度不足。

## 4. 页面审计矩阵

| 页面                             | 当前问题                                                                            | Cordys 对照            | T12 处理                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------- |
| 线索 `/leads`                    | `SavedViewBar` 在新建/导入之前；状态下拉 + 高级筛选文字按钮；缺列设置图标/全屏/刷新 | `clueTable.vue`        | 两层工具区；移除常驻状态下拉；筛选/列设置/全屏/刷新图标化              |
| 线索池 `/leads/pool`             | 同线索；池选择与表格工具混排                                                        | `cluePoolTable.vue`    | 池选择保留为业务上下文；视图行下移；工具图标化                         |
| 客户 `/customers`                | 视图在业务动作之前；搜索在左、业务动作在右；有独立“搜索”按钮                        | `customerTable.vue`    | 第一层左动作右搜索；删除独立搜索按钮；第二层视图                       |
| 联系人 `/contacts`               | 第一层已在前，但额外 scope 按钮与 `SavedViewBar` 分成两行；工具仍文字化             | `contactTable.vue`     | scope 视图并入统一视图语义；第一层工具图标化                           |
| 客户公海 `/customers/open-sea`   | 视图在操作之前；搜索文字按钮；业务动作位于右侧                                      | `openSeaTable.vue`     | 两层工具区；公海选择保留；工具图标化                                   |
| 商机 `/opportunities`            | 视图在第一层之前；列表/看板使用文字 Radio；新建在右侧                               | `opportunityTable.vue` | 新建移左；搜索/筛选 + 列表/看板图标 + 列设置/全屏/刷新在右；视图第二层 |
| 报价 `/quotes`                   | 视图在第一层之前；新建在右侧；缺通用表格工具                                        | `quotationTable.vue`   | 两层工具区；报价不展示视图数据分析图标                                 |
| 合同 `/contracts`                | 视图在第一层之前；列表/看板为文字 Segmented；新建在右侧                             | `contractTable.vue`    | 两层工具区；模式切换图标化；合同不展示视图数据分析图标                 |
| 发票 `/contract/contractInvoice` | 使用 `SavedViewBar`，工具职责同样混合                                               | `invoiceTable.vue`     | 两层工具区；不展示视图数据分析图标                                     |
| 订单 `/order/index`              | 使用 `SavedViewBar`，工具职责同样混合                                               | `orderTable.vue`       | 两层工具区；不展示视图数据分析图标                                     |
| 产品 `/products`                 | 无视图行；顶部 padding=0；右侧状态/搜索为普通控件                                   | `product/index.vue`    | 修复 padding；只保留第一层工具区，不新增视图行                         |
| 价格表 `/products/prices`        | 同产品；顶部 padding=0                                                              | `product/price.vue`    | 修复 padding；只保留第一层工具区，不新增视图行                         |

## 5. T12 统一设计

### 5.1 第一层：`CrmTableToolbar`

统一布局：

```text
left  : 主动作，gap 12px
right : Search / Filter / Column / ViewMode / Fullscreen / Refresh，gap 8px
```

规格：

- 默认控件高度 32px；
- 图标 16px；
- 图标按钮 32 × 32px；
- 搜索输入框默认 240px；
- 主动作继续允许文字按钮；
- 工具动作必须使用 icon + tooltip/aria-label，禁止常驻“高级筛选 / 列设置 / 刷新 / 全屏”等文字按钮；
- 批量动作只在选中数据时出现，不挤占未选中状态的主工具区。

### 5.2 第二层：`SavedViewBar`

统一布局：

```text
left  : 系统/固定视图 + “+ 新建视图”
right : 纯视图选择器 + 可选数据分析动作
```

规则：

- 必须位于第一层业务动作之后；
- `+ 保存当前筛选` 改为 `+ 新建视图`，创建时仍允许携带当前筛选条件；
- 视图选择器左侧不显示额外“视图”前缀，下拉菜单只保留真实视图项；
- 不在下拉菜单中重复展示“+ 新建视图 / 系统视图 / 个人视图 / 管理视图”等蓝色辅助文案；
- “列设置”从 `SavedViewBar` 移出；
- 视图标签继续使用 24px/小尺寸轻量标签语义；
- 不伪造 Cordys 数据分析能力：当前项目未实现 view chart backend/runtime 时，不显示无效图标；后续能力实现后按模块白名单接入。

### 5.3 页面 padding

- 普通 PC `el-card` 页面使用统一内容 padding；
- 页面不得以局部 scoped CSS 把顶部 padding 改成 0，除非设计文档明确该页面是 edge-to-edge 容器；
- 产品/价格表删除当前 `padding: 0 16px 16px` 特例。

## 6. 验收标准

- `/products`、`/products/prices` 第一层工具区与其他 Card 页面顶部留白一致；
- 线索、客户、联系人、客户公海、商机、报价、合同、发票、订单的第一层业务动作位于视图行之前；
- Advanced Filter / Column Setting / Fullscreen / Refresh 使用 16px 图标 + 32px 点击区；
- 搜索不再需要独立“搜索”文字按钮；
- 商机/合同列表-看板切换改为图标模式切换；
- `SavedViewBar` 不再显示“列设置”文字按钮和独立“管理视图”文字按钮；
- `SavedViewBar` 左侧显示 `+ 新建视图`；
- 右侧选择器无“视图”前缀且下拉只显示真实视图项；列偏好仍可保存；
- 页面权限、搜索、筛选、导入导出、批量动作不回退；
- Browser Smoke 检查布局顺序、32px 工具按钮、视图行位置及核心功能；
- root typecheck / Web build / lint / `git diff --check` 通过。
