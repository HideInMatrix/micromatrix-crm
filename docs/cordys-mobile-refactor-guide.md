# CordysCRM Mobile 源码对齐与 Vant UI 重构规范

本文以仓库内只读上游 CordysCRM/frontend/packages/mobile 为唯一移动端样式与交互参考。实现时优先复用上游页面结构、Vant 组件组合、尺寸和信息层级，不再根据“类似 Cordys”自行设计新的一级页面骨架。

## 1. 源码证据

本轮对齐直接核对以下上游文件：

| 上游源码 | 约束 |
| --- | --- |
| src/layout/default-layout.vue | 一级 Tabbar、路由层级、转场、安全区 |
| src/assets/style/global.less | top-bar、crm-search、全局表单边界 |
| src/assets/style/theme.less | Vant Theme Token、Tabbar 高度、圆角 |
| src/assets/style/var.less | 3/6/9/12px 圆角、0.5px 边界、轻阴影 |
| src/views/workbench/index.vue | 首页头像 + Search + Notification、快捷入口 |
| src/views/customer/index.vue | 客户 / 联系人 / 公海使用 van-tabs |
| src/views/customer/components/customer.vue | + 按钮 + Search、筛选按钮、客户列表 |
| src/components/business/crm-contact-list/index.vue | 联系人卡片、头像、正常 Tag、电话、删除 |
| src/views/customer/openSea/index.vue | 公海搜索、资源池筛选、卡片 |
| src/views/clue/index.vue | 线索 / 线索池使用 van-tabs |
| src/views/clue/clue/index.vue | 线索搜索、系统视图筛选、卡片动作 |
| src/views/clue/pool/index.vue | 线索池搜索、池筛选 |
| src/views/opportunity/index.vue | 商机一级页面、搜索、筛选、列表 |
| src/components/pure/crm-list-common-item/index.vue | 通用业务卡片精确尺寸和字段层级 |
| crm-form-create/components/basic/pick.vue | 单选必须 Field + Popup + Picker |
| crm-form-create/components/basic/multiplePick.vue | 多选必须 Popup + CheckboxGroup |
| crm-form-create/components/basic/datePicker.vue | 日期时间必须 PickerGroup + DatePicker + TimePicker |
| crm-form-create/components/basic/memberSelect.vue | 成员选择必须移动 Popup / 搜索 / 选择列表 |

## 2. 一级结构

### 2.1 Bottom Tabbar

上游 default-layout.vue 的一级导航顺序是：首页、客户、线索、商机、我的。

MicroMatrix Mobile 按当前产品要求保留：首页、客户、线索、我的四项。审批与商机均不占用一级 Tabbar。

- 仅 depth=1 的一级页面显示。
- depth>1 的详情、编辑、转换、跟进页面隐藏。
- van-tabbar 使用 fixed=false。
- 启用 safe-area-inset-bottom。
- 图标约 18px，文字约 10px。
- Active 不增加背景色，仅使用 --primary-8 主色图标/文字；Inactive 使用 --text-n4。

### 2.2 客户模块

客户一级模块不是自定义 Segment，也不额外添加“客户管理”标题区。

结构：

~~~text
van-tabs: 客户 | 联系人 | 公海
────────────────────────
+ 按钮   圆角 Search
────────────────────────
全部 / 我的 / 部门 / 协作
────────────────────────
卡片列表
~~~

客户 / 联系人 / 公海直接使用 Vant van-tabs，标题约 16px，Active 使用主色和 Vant 下划线。

客户新建 / 编辑参考 Cordys Mobile 的通用 `crm-form-create/index.vue`：

- 新建 URL：`/mobile/customers/create`。
- 编辑 URL：`/mobile/customers/:id/edit`。
- 两个 Route 必须复用同一个 `CustomerFormView.vue`，禁止维护两套页面或 Popup。
- 页面结构固定为：顶部 `van-nav-bar` → 中间可滚动 `van-form` + 动态字段 → 底部固定“取消 / 创建或更新”双按钮。
- 列表“+”、列表“编辑”和详情“编辑”全部进入该页面，不再使用 Bottom Popup 编辑客户。
- 页面状态与保存流程放入 `useCustomerForm.ts`；字段模型与 payload 转换放纯函数 `utils/customer-form.ts`。

### 2.3 线索模块

线索一级模块使用 van-tabs：线索 / 线索池。

普通线索子页：

- 左侧 van-button，plain + plus icon + primary + small。
- 右侧 van-search，shape=round。
- 系统视图筛选：全部 / 我的线索 / 部门线索。

线索池子页：

- round Search。
- 资源池以 van-button round size=small 横向筛选。

### 2.4 商机模块

商机业务能力保留，但不作为 Mobile 一级菜单，也不放在首页快捷入口中。

## 3. 首页

上游工作台头部明确采用：

~~~text
头像 | van-search | 通知图标
~~~

禁止添加上游不存在的“大 Hero”“欢迎标题 + 副标题”“业务概览大卡”等一级结构。

本项目明确移除 Mobile 审批，因此：

- 不展示“我的待办”区块；该区块在 Cordys Mobile 中属于审批/流程语义，MicroMatrix Mobile 当前不启用。
- 不展示待我审批、抄送我的、我发起的、我处理的。
- 保留上游工作台的头像 + Search + Notification 顶部结构。
- 快捷入口保留三项：新建线索、新建客户、新建联系人，不展示商机。
- 快捷入口下方展示“消息通知”，接入真实 notificationApi 数据，不再使用“业务提醒”区块。

## 4. 通用列表卡片

直接以 crm-list-common-item/index.vue 为基线：

- 外层 padding：16px 20px。
- 圆角：6px。
- 背景：白色。
- 内部 gap：8px。
- Title：14px / 600。
- Label：12px / --text-n4。
- Value：12px / --text-n1。
- Header：名称 + 状态 Tag。
- Content：flex wrap。
- Actions 前使用 van-divider。
- Actions 横向 justify-between。

联系人是特殊列表：

- 卡片 padding 16px。
- 左侧圆形头像。
- 名称约 16px。
- 正常状态使用绿色浅色 van-tag。
- 电话使用 tel 链接并提供复制动作。
- 删除使用红色动作。

## 5. 顶部搜索与筛选

上游 top-bar 的固定基线：

~~~css
display: flex;
align-items: center;
gap: 12px;
padding: 8px 16px;
background: white;
~~~

新增操作使用 Vant Button，搜索使用 round Vant Search。

筛选统一使用 van-button round size=small：

- Active：--primary-7 背景 + --primary-8 文本。
- Inactive：--text-n9 背景 + --text-n1 文本。
- 无明显边框。

禁止自行用原生 button 模拟 Vant Button。

## 6. Vant UI 强制规范

移动端表单和选择控件统一使用 Vant UI。只要 Vant 存在对应能力，就不得使用浏览器原生控件替代。

同时强制执行当前项目的 UnoCSS + `presetWind4` 约定：

- 页面和业务组件的普通布局、尺寸、间距、颜色、边框、圆角、滚动行为全部直接写 UnoCSS utility。
- 使用 Tailwind CSS v4 兼容语法；任意值使用 `h-[...]`、`border-[...]`、`bg-[var(...)]` 等形式。
- Vant 内部节点需要覆盖时，优先使用 UnoCSS arbitrary selector，例如 `[&_.van-tab__panel]:h-full`。
- 禁止为普通页面视觉新增 `<style scoped>`。
- 禁止新增 `.top-bar`、`.filter-buttons`、`.crm-xxx-card` 这类页面语义 CSS class 再去 CSS 文件维护样式。
- `apps/mobile/src/styles/index.css` 只保留设计 Token、HTML/Body 基线、确实无法通过页面 utility 表达的 Vant 全局覆写以及 Vue 路由转场规则。

### 6.1 单选 / 下拉

禁止原生 select。

必须使用：

~~~text
van-field readonly is-link
  ↓
van-popup position=bottom
  ↓
van-picker
~~~

### 6.2 多选

禁止 select multiple。

必须使用 van-field + van-popup + van-checkbox-group + van-cell + van-checkbox。

### 6.3 日期时间

禁止 input type=datetime-local。

必须按照上游 datePicker.vue：

~~~text
van-field readonly is-link
van-popup
van-picker-group
  ├── van-date-picker
  └── van-time-picker
~~~

### 6.4 基础字段

- 文本：van-field。
- 数字 / 金额 / 百分比：van-field type=number。
- 长文本：van-field type=textarea。
- Boolean：van-switch。
- Radio：van-radio-group / van-radio。
- Checkbox：van-checkbox-group / van-checkbox。

### 6.5 成员 / 部门 / 数据源

简单枚举可以使用 van-picker。

成员、部门、数据源等数据量较大的选择必须采用 readonly Field + Popup + Search + List/Cell；多选用 Checkbox；取消和确认使用 Vant Button。

## 7. 本项目统一选择组件

为消除原生控件，移动端增加：

- MobileVantPickerField.vue：单选使用 Field + Popup + Picker，多选使用 Field + Popup + CheckboxGroup + Cell。
- MobileVantDateTimeField.vue：Field + Popup + PickerGroup + DatePicker + TimePicker。

这两个组件用于动态表单、跟进计划、跟进记录和评论 @成员。

源码验收要求：

~~~text
apps/mobile/src:
<select          = 0
<input           = 0
datetime-local   = 0
<button          = 0
<style           = 0
class="crm-      = 0
~~~

其中业务按钮统一使用 van-button；Vant 内部 DOM 不计入源码检查。

上述约束已固化为 `tools/check-mobile-ui.mjs`。`apps/mobile` 的 `dev`、`build`、`typecheck`
都会先执行该门禁，发现原生表单/按钮、SFC `<style>` 或重新引入页面语义 CSS class 时直接失败。

## 8. 跟进计划

`/mobile/follow-plans` 对齐 Cordys Mobile 以下源码：

- `views/workbench/follow/followPlanList.vue`
- `components/business/crm-follow-list/followPlan.vue`
- `components/business/crm-follow-list/components/listItem.vue`
- `components/business/crm-follow-list/useFollowApi.ts`

全局跟进计划使用工作台模式：范围筛选使用 Vant 圆角按钮，列表使用时间轴结构；每项依次展示计划日期、跟进方式、状态下拉、负责人、业务对象、内容、编辑/删除/评论动作。对象详情里的计划列表复用相同 Item，但顶部使用 `+` Vant Button + round `van-search`。

MicroMatrix 当前 FollowUpPlan API 只提供全量数据范围与 `mine` 过滤，没有 Cordys `DEPARTMENT` viewId 契约，因此 Mobile 不虚构“部门计划”筛选；保留“全部 / 我的计划”，权限范围继续由后端 DataScope 决定。

实现必须遵守组件化 / 函数化：

- `MobileFollowUpPlanList.vue` 只负责组件组合和跨组件事件。
- `MobileFollowUpPlanToolbar.vue` 只负责范围筛选 / 搜索 / 新建入口。
- `MobileFollowUpPlanItem.vue` 负责单条时间轴卡片与 Vant 状态 Dropdown。
- `MobileFollowUpPlanFormSheet.vue` 负责动态表单 Sheet。
- `useMobileFollowUpPlans.ts` 负责列表、分页、范围筛选、状态、删除与评论计数。
- `useMobileFollowUpPlanForm.ts` 负责 ModuleForm、目标对象/联系人联动和保存流程。
- `utils/follow-up-plan.ts` 只放状态选项与纯格式化函数。

## 9. Mobile 审批移除边界

只移除 Mobile 审批，不影响 PC/API：

- 移除 Mobile Tabbar 审批入口。
- 移除 /mobile/approvals。
- 移除首页审批区域。
- 删除 Mobile Approvals View。
- 删除 Mobile 审批专用附件组件。
- 删除 Mobile approvals API wrapper。

保留 PC Web 审批、API 审批模块和 Shared 层审批能力。

## 10. 验收标准

1. 一级导航顺序为：首页 / 客户 / 线索 / 我的，不包含审批和商机。
2. 客户模块顶部是 Vant Tabs：客户 / 联系人 / 公海。
3. 线索模块顶部是 Vant Tabs：线索 / 线索池。
4. 客户、联系人、线索使用上游同构的“+ + Search + Pills + Cards”。
5. 联系人卡片包含头像、状态、电话、复制和删除动作。
6. 通用卡片尺寸按 16px 20px / 6px / 8px gap 基线。
7. Mobile 不出现任何审批入口。
8. Mobile 源码不出现原生 select、datetime-local input 和业务原生 button。
9. 选择器、日期时间、成员/部门等全部采用 Vant 移动交互。
10. Mobile SFC 不新增页面级 `<style>`，普通视觉全部使用 UnoCSS + presetWind4 utility。
11. 跟进计划按 Cordys 时间轴 Item 结构展示，并保持列表 / 表单 / Item / composable 分层。
12. 二级页面隐藏 Tabbar，路由 depth 转场保持不变。

