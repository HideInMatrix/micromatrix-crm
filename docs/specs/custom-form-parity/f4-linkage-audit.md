# FORM-001F4 显隐规则 / 表单联动 / 字段联动源码审计

## 1. 审计范围

F4 继续以 Cordys 表单设计与运行时为准，重点审计：

- `showControlRules` 字段显隐控制；
- `linkProp` 普通选择字段联动；
- DATA_SOURCE `combineSearch / showFields / linkFields / childLinkFields`；
- 表单级 `formLink` 场景配置。

F4 不把这些能力合并成一个“万能规则引擎”。Cordys 本身就是分层配置、分层执行，MicroMatrix 也保持相同边界。

## 2. 字段显隐规则

Cordys 把显隐规则配置在控制字段上：

```ts
interface FormCreateFieldShowControlRule {
  value?: string | number
  fieldIds: string[]
}
```

运行时建立 `targetFieldId -> controlFieldId -> allowedValues[]` 映射。目标字段只要任意控制规则命中就显示，因此跨控制字段是 OR 语义；控制值不命中时隐藏目标字段。

显隐只影响 UI 展示，不代表服务端可以信任客户端省略校验。服务端仍应按最终可见字段集合决定必填和可写边界：隐藏字段不能因为原始 `required=true` 阻断保存，也不能接受客户端借隐藏字段写入绕过当前规则。

DATA_SOURCE 派生显示字段跟随父 DATA_SOURCE 一起显隐。

## 3. 普通选择字段联动

Cordys `linkProp` 只开放在 SELECT / SELECT_MULTIPLE 一类选择字段上：

```ts
interface FieldLinkOption {
  current: string | string[]
  method: 'AUTO' | 'HIDDEN'
  target: string | string[]
}

interface FieldLinkProp {
  targetField: string
  linkOptions: FieldLinkOption[]
}
```

- Cordys SELECT 的 `current` 为标量，SELECT_MULTIPLE 为数组；运行时按完整值/完整集合精确命中，不把多选子集误判为命中。
- `AUTO`：当前值命中后直接给目标字段赋值。
- `HIDDEN`：不是隐藏目标字段，而是限制目标字段的可选范围，Cordys 运行时写入 `linkRange`。

当前值不再命中时，限制范围需要解除。F4 不能把 `HIDDEN` 误实现为 `visible=false`。

## 4. DATA_SOURCE 候选过滤

`combineSearch` 是 DATA_SOURCE 自身候选列表的动态过滤条件，不是表单 AdvancedFilter：

- `searchMode` 为 AND / OR；
- 每条条件引用目标数据源字段 `leftFieldId`；
- 右值既可以是固定值，也可以来自当前表单字段 `rightFieldId`；
- 当前表单字段为空时，该动态条件不进入请求。

CustomForm 数据源必须继续复用 F2 的目标表单 AccessState，不能因为 F4 动态过滤而扩大数据权限。

## 5. DATA_SOURCE 显示字段

`showFields` 指 DATA_SOURCE 选中后，把源记录的其它字段作为只读派生字段展示。Cordys 会把这些字段临时 flatten 到表单字段列表，并通过 `resourceFieldId` 关联父 DATA_SOURCE。

MicroMatrix 不创建真实 `SysModuleField` 存储这些派生字段；运行时通过 source resolve 结果临时构造只读展示字段，避免把派生列误写入当前表单数据。

## 6. DATA_SOURCE 字段填充

`linkFields` 契约：

```ts
interface DataSourceLinkField {
  current: string
  link: string
  method: 'fill'
  enable: boolean
}
```

其中 `current` 是当前表单目标字段，`link` 是数据源字段。单选 DATA_SOURCE 选中源记录后，把源字段值填入当前表单字段；`enable=false` 的规则跳过。

字段类型需要保持兼容，尤其 DATA_SOURCE 单/多选、成员、LOCATION 等不能跨类型盲填。

## 7. DATA_SOURCE 子表填充

`childLinkFields` 在 `linkFields` 基础上增加 `childLinks`，用于把源记录字段填入当前表单 SUB_PRODUCT 的子字段。F4 只处理选中一个 DATA_SOURCE 后填充当前目标字段，不实现跨行聚合。

子表填充后仍走 F3 的子字段校验、DATA_SOURCE 校验、公式重算和稳定 `bizId` 行模型。

## 8. 表单级联动

Cordys 另有 `formLink` 场景配置，用于不同业务表单之间的字段映射。它与单字段 `linkProp`、DATA_SOURCE `linkFields` 不同。

FORM-001F4 首批只对齐自定义表单运行时能实际触发的字段级联动。若 MicroMatrix 当前自定义表单没有 Cordys 对应的跨业务表单创建场景，则表单级 `formLink` 只冻结模型与边界，不擅自增加新的业务入口。

## 9. MicroMatrix F4 实施边界

F4 必须完成：

- `showControlRules` 配置、运行时显隐与服务端必填/写入边界；
- SELECT / MULTISELECT `linkProp` 的 AUTO 与范围限制；
- DATA_SOURCE `combineSearch` 动态候选过滤；
- DATA_SOURCE `showFields` 只读派生展示；
- DATA_SOURCE `linkFields` 当前表字段填充；
- `childLinkFields` SUB_PRODUCT 子字段填充；
- 设计器、DynamicForm、API/Browser Smoke 与回归门槛。

F4 不包含任意脚本表达式、跨记录聚合联动，也不会用客户端规则替代后端权限或为尚不存在的业务入口虚构 formLink 场景。
