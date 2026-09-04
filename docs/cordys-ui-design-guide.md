## PC 数据列表工具区规范

PC 端表格/看板业务页统一采用 CordysCRM 的两层工具区结构。

第一层是业务动作层：左侧新建、导入、导出全部；右侧搜索、高级筛选、列设置、列表/看板模式、全屏、刷新。右侧工具按钮使用 16px 图标、32px 点击区和 8px 间距；搜索动作集成到输入框后缀，不额外增加“搜索”按钮。

第二层是视图层：左侧系统视图、固定个人视图和“+ 新建视图”，右侧统一视图选择器。列设置不属于视图层；管理视图进入视图选择器的操作区域，不常驻为文字按钮。

产品、价格表等 Cordys 原页面没有 `CrmViewSelect` 的模块，不为了统一形式强制添加视图层。局部页面不得通过 scoped CSS 把 Card 顶部 padding 改为 0；普通业务 Card 继续遵守全局内容留白基线。

# CordysCRM PC / Mobile 设计风格基线

## 1. 文档目的

本文档用于沉淀当前 `micromatrix-crm` 后续 UI 调整的统一视觉与交互基线，参考源为项目内置的 `CordysCRM/` 前端源码，而不是只按单个页面截图进行局部模仿。

本轮先完成设计风格归纳，不直接进入页面代码重构。后续实施时：

- PC 端继续使用当前项目的 Element Plus 技术栈，不为了“像 CordysCRM”而迁移到 Naive UI；需要对齐的是布局、设计 Token、密度、层级、状态和交互节奏。
- Mobile 端以 CordysCRM 的移动信息架构为主要参考，使用 Vant 4 作为基础组件体系重新梳理页面，不把 PC 页面简单缩窄后复用。
- 当前项目继续遵守 UnoCSS + `presetWind4` 的样式约定；可复用视觉参数统一沉淀为 CSS Variables / Design Tokens，避免大量页面级魔法数。

---

## 2. 审计基线

### 2.1 CordysCRM PC 端

主要审计文件：

- `CordysCRM/frontend/packages/web/src/layout/default-layout.vue`
- `CordysCRM/frontend/packages/web/src/layout/components/layout-header.vue`
- `CordysCRM/frontend/packages/web/src/layout/components/layout-sider.vue`
- `CordysCRM/frontend/packages/web/src/layout/page-content.vue`
- `CordysCRM/frontend/packages/web/src/components/business/crm-top-menu/index.vue`
- `CordysCRM/frontend/packages/web/src/components/pure/crm-card/index.vue`
- `CordysCRM/frontend/packages/web/src/components/pure/crm-table/index.vue`
- `CordysCRM/frontend/packages/web/src/assets/style/global.less`
- `CordysCRM/frontend/packages/web/src/assets/style/var.less`
- `CordysCRM/frontend/packages/web/src/utils/theme.ts`
- `CordysCRM/frontend/packages/web/src/utils/themeOverrides.ts`
- `CordysCRM/frontend/packages/lib-shared/assets/style/themeVariables.less`

CordysCRM PC 端基础组件库为 Naive UI，但本项目不会复制其组件库选型，只提取其设计规则。

### 2.2 CordysCRM Mobile 端

主要审计文件：

- `CordysCRM/frontend/packages/mobile/package.json`
- `CordysCRM/frontend/packages/mobile/src/layout/default-layout.vue`
- `CordysCRM/frontend/packages/mobile/src/views/workbench/index.vue`
- `CordysCRM/frontend/packages/mobile/src/views/customer/components/customer.vue`
- `CordysCRM/frontend/packages/mobile/src/components/pure/crm-list-common-item/index.vue`
- `CordysCRM/frontend/packages/mobile/src/assets/style/global.less`
- `CordysCRM/frontend/packages/mobile/src/assets/style/var.less`
- `CordysCRM/frontend/packages/mobile/src/assets/style/theme.less`

CordysCRM Mobile 本身已经采用 Vant 4，参考源码依赖为 `vant ^4.8.2`。

### 2.3 当前项目现状

当前项目并非完全没有 Vant：

- `apps/web/package.json` 已声明 `vant ^4.10.0`。
- 已声明 `@vant/auto-import-resolver ^1.3.0`。
- 已存在 `apps/web/src/views/**/mobile/` 移动页面和 `MobileTabbarLayout.vue`。
- `apps/mobile/` 当前只有空目录骨架，没有形成独立可运行应用。
- 2026-09-04 通过 npm registry 查询，Vant 当前最新稳定版为 **4.10.2**。

因此后续动作应理解为：**将当前移动端正式收口到最新 Vant 4 基线并系统重构，而不是从零引入 Vant。**

---

## 3. CordysCRM 整体设计语言

CordysCRM 的视觉风格不是传统“大字号、大圆角、大留白”的消费类 SaaS，而是典型的高信息密度企业 CRM：

1. **内容优先，装饰克制**：页面重点是表格、字段、业务状态和操作，不依赖大面积渐变、粗阴影或装饰性插画建立层级。
2. **浅灰平台底 + 白色业务层**：平台背景非常浅，核心业务内容落在白色卡片、表格、抽屉或 Popup 中。
3. **品牌色只用于强调**：主色用于选中、主操作、链接、关键状态，不把整个导航栏或内容区大面积染成品牌色。
4. **统一小圆角**：PC 端以 4px / 6px 为主，移动端适当增大到 6px / 9px，但整体仍偏克制。
5. **信息层级主要依靠字号、字重、明度和间距，而不是边框堆叠**。
6. **PC 强调高密度操作效率，Mobile 强调单手触控和单任务流转**。

---

## 4. 统一色彩基线

CordysCRM PC 与 Mobile 共用同一套主题颜色体系。

### 4.1 品牌主色

| Token         | 色值      | 用途                               |
| ------------- | --------- | ---------------------------------- |
| `--primary-8` | `#00A6AB` | 品牌主色、主按钮、选中态、主要链接 |
| `--primary-0` | `#008D91` | Pressed / 深色状态                 |
| `--primary-1` | `#26B3B8` | Hover                              |
| `--primary-4` | `#B2E4E6` | Disabled / 边界弱化                |
| `--primary-6` | `#E5F6F7` | 浅色激活背景                       |
| `--primary-7` | `#F2FBFB` | 选中项、轻量强调背景               |

### 4.2 中性色

| Token        | 色值      | 建议用途               |
| ------------ | --------- | ---------------------- |
| `--text-n1`  | `#323535` | 主文本                 |
| `--text-n2`  | `#646767` | 次级文本               |
| `--text-n4`  | `#969999` | 描述、占位、字段标签   |
| `--text-n6`  | `#C8CBCB` | Disabled               |
| `--text-n7`  | `#D5D8D8` | 边框                   |
| `--text-n8`  | `#EDF0F1` | 分割线、次要按钮背景   |
| `--text-n9`  | `#F9FBFB` | 平台页面背景、轻背景   |
| `--text-n10` | `#FFFFFF` | 卡片、表格、输入区背景 |

### 4.3 业务状态色

| 状态    | 主色      | 浅背景    |
| ------- | --------- | --------- |
| Error   | `#E22E23` | `#FEF5F4` |
| Success | `#00C261` | `#F2FCF7` |
| Warning | `#FFA200` | `#FFFAF2` |
| Info    | `#3370FF` | `#F5F8FF` |

状态色必须承载语义，不应作为普通装饰色随意使用。

---

## 5. PC 端设计风格

## 5.1 页面整体结构

CordysCRM PC 端的默认布局可以概括为：

```text
┌──────────────────────────────────────────────────────────────┐
│ Logo                 顶部业务导航                  工具操作 │ 约 56px
├──────────────┬───────────────────────────────────────────────┤
│              │                                               │
│ 左侧业务菜单 │              页面内容区                       │
│ 180 / 56px   │       浅灰平台背景 + 白色业务卡片             │
│              │                                               │
├──────────────┤                                               │
│ 个人信息     │                                               │
└──────────────┴───────────────────────────────────────────────┘
```

关键尺寸：

- 顶部区域：约 56px。
- 左侧导航展开宽度：**180px**。
- 左侧导航折叠宽度：**56px**。
- 页面内容区外边距：**16px**。
- 页面平台背景：`#F9FBFB`。
- 一级内容容器：白色。

这套结构的核心价值是：导航占用空间小、业务区域最大化、页面视觉重心稳定。

### 当前项目 PC 调整原则

当前 `DefaultLayout.vue` 的侧栏宽度为 220px。后续 PC 样式调整应逐步向 CordysCRM 的 180px / 56px 密度靠拢，但不要求一次性机械复制所有 DOM 结构。

PC 端需要优先统一：

1. 顶部栏高度与内容垂直对齐。
2. 侧栏展开/折叠尺寸。
3. 一级菜单、二级菜单的字体、图标、选中背景和左右缩进。
4. 页面背景与内容卡片之间的层级。
5. 全局 16px 页面边距。

---

## 5.2 字体与信息密度

CordysCRM PC 默认正文：

- 基础字号：**14px**。
- 基础行高：**22px**。
- 页面/卡片标题常用：**16px / 24px**。
- 辅助说明：12px～14px。
- 字体族：`Helvetica Neue`、Arial、`PingFang SC` 等系统无衬线字体。

推荐本项目 PC 层级：

| 层级          | 字号 |    字重 | 用途                     |
| ------------- | ---: | ------: | ------------------------ |
| 页面核心标题  | 16px | 500/600 | 业务模块标题             |
| 卡片/分区标题 | 16px | 400/500 | 卡片标题、抽屉分组       |
| 正文/表格     | 14px |     400 | 默认数据内容             |
| 强调正文      | 14px | 500/600 | 名称、关键值             |
| 辅助信息      | 12px |     400 | 描述、时间、字段辅助信息 |

PC 端不应大范围使用 18px～24px 标题，否则会显著降低 CRM 的单位屏幕信息量。

---

## 5.3 圆角

CordysCRM PC 圆角：

- Mini：2px。
- Small：4px。
- Medium：6px。
- Large：12px。

落地原则：

- 输入框、按钮、菜单选中态：4px 左右。
- 卡片、Dialog、Alert、业务容器：6px 左右。
- 特殊浮层或强调型容器才使用 12px。
- PC 禁止大面积 16px / 20px 圆角卡片化，否则会偏离 CordysCRM 的企业工具气质。

---

## 5.4 阴影

CordysCRM 阴影很轻：

- Base：`0 4px 10px -1px rgba(100, 103, 103, 0.15)`。
- Middle：`0 4px 15px 2px rgba(100, 103, 103, 0.10)`。
- Large：`0 6px 35px 6px rgba(100, 103, 103, 0.10)`。

使用范围：

- 普通页面卡片尽量依赖背景层级或 1px 边界，不默认加明显阴影。
- Dropdown / Popover / Drawer / Floating Entry 使用中层阴影。
- 大型浮层才使用 Large Shadow。

---

## 5.5 控件尺寸

CordysCRM PC 常规控件高度：

- Small：24px。
- Medium：32px。
- Large：40px。

CRM 主工作区应以 **32px** 作为按钮、输入框、Select 的默认高度。

这样可以保证：

- 表格工具栏不会过高。
- 同屏可展示更多筛选条件。
- 按钮与表格行高视觉匹配。

---

## 5.6 顶部导航

CordysCRM 顶部不是大面积背景导航，而是白底的轻量工具栏：

- Logo 左侧固定区域。
- 中间区域允许出现当前业务域的横向二级导航。
- 右侧是搜索、任务、提醒、语言、帮助等工具按钮。
- 工具按钮以纯图标 / Quaternary 风格为主。
- 横向选中菜单高度约 32px，使用 `--primary-7` 浅主色背景表示选中。

重点不是把顶部做“重”，而是减少其视觉重量，把注意力留给业务内容。

### PC 模块级导航规则（强制）

CordysCRM 中 `客户 / 联系人 / 客户公海` 这类关系，本质上不是“同一页面里的多个内容 Tab”，而是**同一个一级业务模块下的多个并列路由页面**。这类并列页面统一使用 Header 顶部横向菜单切换，不允许继续把模块级导航放进业务 Card 内部的 Tabs。

这条规则适用于全部 PC 业务模块，不是客户模块特例：

- 同一个左侧一级模块下存在多个并列子页面时，子页面入口进入 Header 顶部业务导航。
- 左侧菜单负责一级业务域；Header 顶部菜单负责当前业务域内的并列页面切换。
- 详情、编辑、配置等更深层页面继续保持所属一级模块和顶部父页面的激活关系，不新增一套重复导航。
- 页面 Card 内不得使用 Tabs 承担跨路由的模块级导航。

Tabs 仅允许用于**同一路由、同一业务对象或同一数据页面内部的内容分区**，例如：

- 客户详情中的“基本信息 / 跟进记录 / 联系人 / 商机”等内容区域；
- 同一列表页面内部的“全部 / 我的 / 部门 / 协作”等数据视图；
- 同一设置页面内部、不改变一级业务路由语义的配置分区。

模块级顶部菜单视觉基线继续沿用 Cordys：单项高度约 32px、左右内边距约 16px、默认无重边框、选中态使用 `--primary-7` 浅主色背景，不使用大尺寸 Tab 下划线样式承担模块导航。

实现上应优先使用**路由元数据 / 模块配置驱动的通用 Top Menu**，而不是为客户、合同、商机、产品等模块分别复制 `XxxModuleNav.vue`。CordysCRM 的 `meta.isTopMenu` 可作为参考语义。

---

## 5.7 左侧菜单

特征：

- 展开态 180px，折叠态 56px。
- 图标约 18px。
- 一级菜单和二级菜单缩进清晰。
- 选中态使用主色或主色浅背景，不依赖粗重边框。
- 底部固定个人中心入口和菜单折叠入口。

PC 样式整改时，需要避免：

- 菜单宽度过大。
- 一级菜单字号过大。
- 每一项都带明显边框。
- 选中态使用过深品牌色导致视觉过重。

---

## 5.8 页面与卡片

CordysCRM 通用卡片：

- 卡片圆角：6px。
- Header：上下 16px、左右 24px。
- Content：24px。
- 卡片标题：16px / 24px。
- 副标题、描述：14px / 22px，使用次级文本色。

页面常见结构：

```text
页面标题 / 面包屑
    ↓ 8~16px
工具栏：视图 / 搜索 / 筛选 / 新建 / 批量操作
    ↓
白色业务容器
    ├─ 表格 / 看板 / 配置列表
    └─ 分页 / 底部动作
```

应避免每一个小字段都单独套卡片。卡片是业务分区单位，不是视觉装饰单位。

---

## 5.9 表格

CordysCRM PC 是明显的“表格优先”产品：

- 表格承担核心数据浏览，而不是把 PC 列表改成移动式卡片。
- 表头、正文统一 14px 左右。
- 行操作优先使用文字按钮，低频操作进入“更多”。
- 支持固定列、列设置、筛选、排序、批量选择等高密度能力。
- 操作区需要保持同一垂直基线，避免 Button / Dropdown 混排后上下错位。
- 表格空状态、Loading、分页都应在统一组件层处理。

当前项目已经对 Element Plus 表格操作列的 link button / dropdown 基线进行过修正，后续整改应保留这一方向，并继续统一表格高度、Header 色阶、Hover 与选中态。

---

## 5.10 Drawer / Dialog / 固定底部操作

CordysCRM 大量复杂编辑采用 Drawer，而不是在列表页中展开巨型内联表单。

规则：

- 简单确认：Dialog / Popconfirm。
- 中大型配置：Drawer。
- 复杂对象详情：Drawer 或独立 Detail 页面。
- 长表单保存按钮固定在底部操作栏。
- 底部操作栏白底，并用非常轻的顶部阴影与正文区分隔。

这一点应作为 PC 重构的重要交互原则：**浏览不离开上下文，复杂操作以抽屉承载。**

---

## 6. Mobile 端设计风格

## 6.1 Mobile 不是 PC 响应式缩放

CordysCRM Mobile 最大的设计特点，是重新设计信息结构，而不是简单调整断点：

- PC 表格 → Mobile 卡片列表。
- PC Drawer → Mobile 独立页面 / Popup / Bottom Sheet。
- PC 多列筛选 → Mobile 搜索 + 横向筛选胶囊 + Popup 筛选。
- PC 行内多操作 → Mobile 卡片底部动作 / Popover / SwipeCell。
- PC 多栏详情 → Mobile 分组单列信息流。

因此本项目后续移动重构必须允许 PC 与 Mobile 使用不同页面组件，只共享 API、Model、权限、业务逻辑和 Composable。

---

## 6.2 Mobile App Shell

CordysCRM Mobile 默认布局：

- 根容器全高 flex column。
- 页面背景：`--text-n9` / `#F9FBFB`。
- 内容区 `flex: 1`，内部负责滚动。
- 一级模块页面显示底部 Tabbar。
- 进入详情、编辑、审批等二级页面后隐藏一级 Tabbar。
- 支持 `safe-area-inset-bottom`。
- 前进/返回根据路由 depth 使用左右滑动过渡；同级 Tab 切换不播放页面推进动画。

这比当前简单的固定底部导航更完整，后续应把“路由层级 → 是否显示 Tabbar → 转场方向 → KeepAlive”作为移动布局层统一能力。

---

## 6.3 Mobile 顶部区域

CordysCRM Mobile 的顶部区域非常轻：

- 白底。
- 常用 padding：`8px 16px` 左右。
- 搜索框使用圆形 `van-search shape="round"`。
- 左侧可以放新增、返回或头像。
- 右侧放提醒、AI、更多操作等高频图标。

不建议在每个一级页面重复设计不同高度、不同背景的 Header。

---

## 6.4 Mobile 筛选

典型列表结构：

```text
新增按钮 + 搜索框
筛选胶囊按钮组
卡片列表
```

筛选胶囊：

- 小尺寸 Round Button。
- 14px 字号。
- 激活：`--primary-7` 背景 + `--primary-8` 文字。
- 未激活：`--text-n9` 背景 + `--text-n1` 文字。
- 不使用明显边框。

复杂筛选项进入 Popup / Bottom Sheet，避免在手机顶部堆出 PC 式多行查询表单。

---

## 6.5 Mobile 列表卡片

CordysCRM 的业务列表卡片具有很强的统一性。

典型参数：

- 外层页面 padding：16px。
- 卡片纵向间距：16px。
- 卡片内边距：`16px 20px`。
- 卡片圆角：6px。
- 卡片背景：白色。
- 卡片内部间距：8px。

信息结构：

```text
业务名称（14px SemiBold）     状态 Tag

字段 Label  字段 Value       字段 Label  字段 Value
字段 Label  字段 Value

-------------------------------- 0.5px / Divider
操作1          操作2          操作3
```

字段层级：

- 名称：14px、600 左右。
- 字段 Label：12px、`--text-n4`。
- 字段 Value：12px、`--text-n1`。
- 状态使用语义化浅色 Tag。

这种卡片适用于客户、线索、商机、审批、跟进记录等绝大多数业务列表，应优先沉淀成统一移动业务卡片组件。

---

## 6.6 Mobile 首页 / 工作台

CordysCRM 工作台并不是一张大 Dashboard，而是面向手机操作频率重排：

1. 顶部头像 + 搜索 + 通知。
2. 待办 / 审批关键数字卡片。
3. 快捷入口宫格。
4. 跟进记录 / 跟进计划等高频业务区。
5. 必要时提供浮动 AI 入口。

移动首页的目标不是完整复刻 PC 数据看板，而是让销售人员快速完成“查、建、跟、批、看待办”。

---

## 6.7 Mobile 底部 Tabbar

CordysCRM 的底部导航有明显的轻量选中设计：

- 仅一级模块页面展示。
- 支持安全区。
- 整体上下约 8px padding。
- Tab Item 可使用圆形/胶囊选中背景。
- Active 背景：`--primary-7`。
- Active 图标/文字：主色。
- 图标约 18px。
- 文字约 10px。

本项目当前 Tabbar 结构可以保留其权限过滤逻辑，但视觉和路由层级控制应按这一基线调整。

---

## 6.8 Mobile 表单

移动表单应优先使用 Vant 原生交互模型：

- `van-form`
- `van-field`
- `van-cell-group`
- `van-picker`
- `van-date-picker`
- `van-time-picker`
- `van-cascader`
- `van-uploader`
- `van-popup`

原则：

1. 单列布局，不做 PC 的两列/三列表单压缩版。
2. 日期、成员、枚举、地区等字段使用选择器或 Popup，不直接暴露复杂输入控件。
3. Cell 之间使用 Vant 0.5px 边界体系。
4. 长表单底部保留固定主操作，并处理 `safe-area-inset-bottom`。
5. 必填、错误信息和 Disabled 必须通过统一 Token 表达。

---

## 6.9 Mobile 详情页

详情页采用“单列分组信息 + 底部/顶部操作”模式：

- 顶部 NavBar 提供返回、标题、必要的更多操作。
- 主信息优先展示名称、状态、负责人等关键字段。
- 详细字段按业务分组进入 CellGroup / Description Section。
- 跟进、联系人、审批记录等关联数据通过 Tabs 或独立子页面展开。
- 高频动作可以固定到底部；破坏性操作必须二次确认。

详情页不应直接复刻 PC Drawer 的多栏结构。

---

## 6.10 Mobile 圆角和触控

CordysCRM Mobile 圆角基线比 PC 略大：

- Mini：3px。
- Small：6px。
- Medium：9px。
- Large：12px。

同时需要注意触控面积：

- 纯图标可视觉上只有 18～24px，但可点击区域不能同样只有 18px。
- 高频操作尽量保证约 40～44px 的有效触控区域。
- 相邻危险操作和普通操作应有足够间距。

---

## 7. Vant 4 重构基线

## 7.1 版本策略

截至 2026-09-04：

- CordysCRM 参考工程：`vant ^4.8.2`。
- 当前 `micromatrix-crm/apps/web`：`vant ^4.10.0`。
- npm registry 最新稳定版：**4.10.2**。

后续进入移动端重构执行单元时，应把依赖基线升级并锁定到当前最新 Vant 4，小版本更新仍限定在 Vant 4 范围内。

不升级到未来潜在的 Vant 5，不在一次 UI 重构中同时承担大版本组件迁移风险。

---

## 7.2 当前项目的推荐承载方式

经进一步核对 CordysCRM 的实际构建与部署方式，本项目不再采用“一个 Vue 应用内动态切换 PC / Mobile View”的终态方案。CordysCRM 的 PC 与 Mobile 是两个独立前端构建单元，Mobile 生产 base 为 `/mobile/`，PC 入口负责将移动终端导向 `/mobile`。

因此本轮重构终态调整为：

- `apps/web`：PC 独立 Vue 应用，仅保留 Element Plus。
- `apps/mobile`：Mobile 独立 Vue 应用，使用 Vant 4。
- 根地址 `/` 为统一用户入口；移动终端自动进入 `/mobile`。
- `/mobile` 增加反向终端校验，PC 终端访问时回到 `/`。
- API、领域 types、权限规则与无 UI 业务逻辑继续共享。
- 浏览器专属共享能力与前后端通用 `@micromatrix/shared` 分层，避免把 Vue/Pinia/Axios/DOM 依赖带入后端共享包。
- PC / Mobile 页面模板分别维护，不复制后端领域模型。

即：**两个独立 Vue 应用，一套共享业务底座，同域名按终端分流。**

详细架构、验收标准和迁移计划以 [UI-001 PC / Mobile 双应用重构](./specs/frontend-dual-app-refactor/design.md) 为准。

---

## 7.3 Vant 主题映射

建议建立项目级 Mobile Tokens，将 Vant Variables 映射到 CordysCRM 统一色板：

```text
--van-primary-color    -> --primary-8
--van-success-color    -> --success-green
--van-danger-color     -> --error-red
--van-warning-color    -> --warning-yellow
--van-text-color       -> --text-n1
--van-text-color-2     -> --text-n2
--van-text-color-3     -> --text-n4
--van-radius-sm        -> 3px
--van-radius-md        -> 6px
--van-radius-lg        -> 9px
```

主题变量应放到统一 style/token 文件，不允许每个页面重复覆盖 Vant CSS Variables。

---

## 7.4 Vant 组件使用优先级

后续移动页面重构时，优先使用 Vant 已有能力：

| 场景         | 首选组件                    |
| ------------ | --------------------------- |
| 顶部导航     | `NavBar`                    |
| 底部主导航   | `Tabbar`                    |
| 搜索         | `Search`                    |
| 列表加载     | `List` + `PullRefresh`      |
| 字段展示     | `Cell` / `CellGroup`        |
| 表单         | `Form` + `Field`            |
| 枚举选择     | `Picker` / `Popup`          |
| 日期时间     | `DatePicker` / `TimePicker` |
| 筛选         | `Popup` / `DropdownMenu`    |
| 状态         | `Tag` / `Badge`             |
| 确认         | `Dialog`                    |
| 轻提示       | `Toast`                     |
| 图片         | `Image` / `ImagePreview`    |
| 文件         | `Uploader`                  |
| 卡片侧滑操作 | `SwipeCell`                 |
| 更多动作     | `Popover` / `ActionSheet`   |

只有当 Vant 无法承载 CRM 业务语义时，才新增 `MobileCrm*` 业务组件。

---

## 8. PC 与 Mobile 的共享 / 分离边界

### 应共享

- API Client。
- TypeScript Models / DTO。
- Pinia Stores。
- 权限判断。
- 字段元数据转换。
- 分页、筛选参数构造。
- 领域校验。
- 日期、金额、枚举格式化。
- 可复用 Composable。

### 不应强行共享

- PC Table 与 Mobile Card List 的模板。
- PC Drawer 与 Mobile Popup / Page 的布局。
- PC Toolbar 与 Mobile Search Header。
- PC 多列表单与 Mobile 单列表单。
- PC Hover 交互与 Mobile Touch 交互。

共享业务逻辑，不共享错误的 UI 抽象。

---

## 9. PC 样式整改优先级

PC 端后续建议按以下层级实施，避免直接逐页修 CSS：

### P0：Design Tokens

- 品牌色、中性色、状态色。
- 字号与行高。
- 圆角。
- 控件高度。
- 页面间距。
- 阴影。

### P1：全局 Shell

- Header。
- Sidebar。
- Content Background。
- Page Padding。
- Menu Active / Hover。
- Personal Menu。

### P2：基础业务组件

- Button。
- Input / Select。
- Table。
- Card。
- Tabs。
- Tag。
- Drawer / Dialog。
- Empty / Loading。

### P3：页面模式

- 列表页。
- 详情页。
- 系统设置页。
- 审批设计页。
- Dashboard / Workbench。

顺序必须由底向上，否则每个页面都会重复修同一套尺寸和颜色问题。

---

## 10. Mobile 重构优先级

移动端进入开发阶段后建议按以下顺序：

1. Vant 4 版本与自动导入基线。
2. Mobile Tokens / Vant Theme Variables。
3. App Shell、NavBar、Tabbar、Safe Area、Route Transition。
4. Mobile Search Header / Filter Bar。
5. 通用业务卡片 `MobileCrmListItem`。
6. 通用分页列表 `MobileCrmList`。
7. 通用 Detail Section。
8. 通用 Form Field Adapter。
9. 工作台。
10. 客户 / 客户池 / 联系人。
11. 线索 / 线索池。
12. 商机。
13. 审批 / 待办。
14. 我的 / 消息 / 跟进。

这里的“重构”不是更换组件标签，而是重建统一移动页面模式。

---

## 11. 后续页面验收标准

每个 PC 页面调整后至少检查：

- 是否使用统一平台背景与页面 16px 间距。
- 是否符合 14px 主信息密度。
- 控件默认高度是否稳定在 32px 左右。
- 卡片是否控制在 6px 左右圆角。
- 表格操作是否同基线。
- 主色是否只用于关键交互。
- Drawer / Dialog 的使用场景是否正确。
- 是否存在页面独有且无必要的魔法颜色、圆角、阴影。

每个 Mobile 页面重构后至少检查：

- 是否使用 Vant 4 原生交互模型。
- 是否为移动信息结构，而不是 PC 缩放版。
- 一级 / 二级页面是否正确控制 Tabbar。
- 是否处理 iOS Safe Area。
- 搜索、筛选是否适合单手操作。
- 列表是否转换为统一业务卡片。
- 表单是否为单列触控结构。
- Popup / Dialog / ActionSheet 是否合理分工。
- 返回与页面转场是否符合路由层级。
- 触控区域是否足够。
- 业务权限、API、状态模型是否继续与 PC 共用。

---

## 12. 最终设计结论

### PC

目标不是把 Element Plus 做成 Naive UI，而是让当前 PC 端具备 CordysCRM 的同类设计气质：

> **轻导航、浅平台底、白色业务层、高信息密度、小圆角、弱阴影、14px 主字号、32px 控件、语义化状态色。**

### Mobile

目标不是“PC 页面适配手机”，而是建立一套独立但与 PC 共享业务底座的移动 CRM：

> **Vant 4 + 单列信息架构 + 搜索筛选前置 + 卡片列表 + Popup/独立详情 + 底部一级导航 + Safe Area + 触控优先。**

后续所有 PC 样式整改和 Mobile 页面重构，都应以本文档作为视觉和交互基线；若发现 CordysCRM 实际源码与本文档存在差异，应以项目内 `CordysCRM/` 当前源码为最高参考，并同步修订本文档。
