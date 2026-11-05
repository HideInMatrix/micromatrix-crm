# 线索与客户快捷搜索设计

## 1. 定位与范围

快捷搜索是 Lead / Customer 列表共用的搜索配置能力，配置入口位于系统模块配置中的线索、客户搜索设置。配置保存在对应 `ModuleFormProp.quickSearch`，复用现有表单元数据，不新增独立业务表或搜索设置模块。

PC 管理端负责维护配置；PC 与企业微信 H5 移动端共同消费 `items` 和同一套查询条件转换规则。覆盖线索列表、线索池、客户列表和客户公海。服务端仍按原模块权限、DataScope、池成员关系执行数据范围限制，快捷搜索不能扩大可见范围。

## 2. 配置结构

```ts
interface ModuleQuickSearchConfig {
  enabled: boolean
  showAdvancedFilter: boolean
  showSavedViews: boolean
  items: QuickSearchItem[]
}

interface QuickSearchItem {
  id: string
  kind: 'field' | 'preset_select'
  label: string
  fieldKey?: string
  fieldKeys?: string[]
  operator?: 'contains' | 'eq' | 'gte' | 'lte'
  placeholder?: string
  options?: QuickSearchPresetOption[]
}

interface QuickSearchPresetOption {
  id: string
  label: string
  searchMode: 'AND' | 'OR'
  conditions: FilterCondition[]
}
```

- 默认配置：`enabled=false`、`showAdvancedFilter=true`、`showSavedViews=true`、`items=[]`。未启用快捷搜索时保留原有列表搜索方式。
- 每个模块最多配置 12 个快捷搜索项。
- `field` 表示直接关联表单字段，支持文本、多行文本、手机号、邮箱、数值、金额、百分比、日期、日期时间、单选和单选按钮字段。
- 文本类 `field` 可额外配置最多 7 个 `fieldKeys`，与主字段使用同一关键字匹配；主字段或任一额外字段命中即可。
- 直接关联的单选/单选按钮字段显示为字段选项下拉；日期和日期时间字段使用日期选择控件；其他字段按类型显示输入控件。
- `preset_select` 表示自定义条件下拉。每个选项配置一组 1～8 条高级筛选条件，并指定组内 AND / OR；每个自定义条件下拉最多 30 个选项。
- PC 设置入口分别为「添加字段搜索」「添加关联字段下拉」「添加自定义条件下拉」。控件可排序、编辑和删除。

## 3. 查询语义

- 不同快捷搜索项之间采用 AND。
- 一个文本搜索项配置了额外 `fieldKeys` 时，主字段与额外字段之间采用 OR；所有字段使用同一个输入值和该项操作符。
- `preset_select` 选中某个选项后，按该选项配置的 AND / OR 执行条件组；未选择时不增加条件。
- 直接字段项按字段类型生成条件：文本类使用包含/等于，日期类使用不早于/不晚于，数值和枚举类使用等于。
- 多个快捷条件组之间采用 AND。快捷条件与原有关键词、普通高级筛选和已选视图条件按列表现有逻辑取交集，不替代原有筛选和数据权限。
- 数值、金额、百分比输入转换为数字；空输入不生成条件。前后端共用 `packages/frontend-shared` 中的 `buildQuickSearchPayload`，避免 PC / H5 语义分叉。

## 4. PC 与移动端行为

### PC

- `enabled=true` 时显示快捷搜索区域，并隐藏旧关键词搜索控件；关闭时不应用快捷搜索草稿，恢复原有关键词搜索。
- `showAdvancedFilter` 控制高级筛选入口；`showSavedViews` 控制保存视图入口。隐藏入口时不得继续应用不可见的旧筛选条件或视图条件。
- 搜索设置只管理 Lead / Customer，不影响其他模块；列表、线索池和客户公海继续使用各自原有权限及范围规则。

### 企业微信 H5

- 使用相同的 `items` 和 `buildQuickSearchPayload`；按字段类型显示输入、日期、直接字段下拉或自定义条件下拉。
- 文本输入确认后执行搜索，选择下拉项或确认日期后执行搜索；清除选项时移除对应条件。
- `showAdvancedFilter` 是 PC 高级筛选入口开关，不在 H5 额外生成 PC 高级筛选面板。
- `showSavedViews` 关闭时，移动端不应用或显示相应的视图选择；开启时按当前页面已实现的视图能力展示。

## 5. 服务端校验与安全

- 仅 `lead`、`customer` 支持该配置；保存时校验配置结构、项 ID、控件数量、字段存在性、字段可见性、字段类型、操作符及条件组。
- 快捷搜索条件组最多 12 组；每组必须包含 1～8 条合法条件。字段必须属于当前租户对应模块且未隐藏，操作符必须由该字段类型支持。
- 字段被删除或隐藏后，前端不渲染失效字段；保存配置时服务端拒绝引用不存在或隐藏字段的配置。
- 线索已退出的系统 `stage / status / lastStage` 字段不属于可搜索字段；旧快捷搜索配置中的这些引用按兼容清理规则移除。
- 所有查询仍由 Lead / Customer 原业务 Service 执行，继续应用 tenant、RBAC、DataScope、池访问和资源状态校验。前端配置不能改变服务端可见范围。
