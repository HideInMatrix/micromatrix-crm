# FORM-001F3 SUB_TABLE / SUB_PRODUCT 源码审计

## 1. Cordys 字段模型

Cordys 没有单独暴露名为 `SUB_TABLE` 的字段枚举，实际高级字段使用：

- `SUB_PRODUCT`：产品/通用子表格。
- `SUB_PRICE`：报价/价格业务专用子表格。

两者后端都继承 `SubField`，公共属性为：

- `subFields`：子列字段定义。
- `sumColumns`：汇总列 ID。
- `fixedColumn`：固定列数量。

自定义表单设计器只开放 `SUB_PRODUCT`，明确不开放 `SUB_PRICE`。因此 MicroMatrix F3 对外只实现 `SUB_PRODUCT`；内部把值存储与运行时抽象为通用 sub-table row model，为业务模块后续复用保留空间。

## 2. 子列能力

Cordys 自定义表单子表允许加入：

- 文本。
- 数值。
- 单选、多选。
- DATA_SOURCE。
- 公式。
- 图片。
- 日期时间。
- 成员/多成员。
- 部门/多部门。

F3 不允许子表继续嵌套 `SUB_PRODUCT / SUB_PRICE`。ATTACHMENT、LOCATION 等 Cordys 当前子表字段菜单未开放的类型不在 F3 擅自增加。

`subFields` 是父字段 prop 的嵌套配置，不额外创建顶层 ModuleField。读取完整表单配置时，Cordys 会把子列临时 flatten，并给子字段补 `subTableFieldId = parentFieldId`，用于筛选、日志、数据源展示字段等运行时场景。

## 3. 行值存储

Cordys 没有把整张子表直接序列化成一个 Blob。普通字段值表和 Blob 值表都扩展了三类行维度：

- `refSubId`：父子表字段 ID。
- `rowId`：当前父字段内的 1-based 行序号。
- `bizId`：稳定的行唯一 ID。

提交值契约是：

```ts
Array<{
  id?: string
  [subFieldIdOrKey: string]: unknown
}>
```

保存时：

1. 每行存在 `id` 时沿用为 `bizId`，新行生成新 ID。
2. 每个单元格继续调用对应字段 resolver 校验和编码。
3. Blob 子列进入 Blob 值表，普通子列进入普通值表。
4. 每个单元格同时写入 `resourceId + refSubId + rowId + bizId + fieldId`。

读取时按 `resourceId + refSubId + rowId` 聚合回行数组，并把 `bizId` 作为行 `id` 返回。

这种模型使文本、选项、DATA_SOURCE、公式等既有字段语义可以在子表内继续复用，而不需要维护第二套字段值协议。

## 4. 运行时边界

- `SUB_PRODUCT` 本身不作为普通列表列展示。
- 父子表字段不进入通用批量修改。
- 通用 AdvancedFilter 不直接筛选整张子表；Cordys 在审批条件等特殊场景使用 `parentFieldId.subFieldId` 定位子列。该能力留给 F4 联动/条件引擎，不在 F3 扩大高级筛选语义。
- 子表内 DATA_SOURCE 仍应执行 F2 已建立的数据源校验与名称解析。
- 子表内公式只能引用当前行的子字段，不能在 F3 引入跨行/跨父表聚合公式。

## 5. Excel

Cordys 发现存在子表字段后启用双层表头。父字段作为一级合并表头，`subFields` 作为二级列；一条主记录可以对应多条子表行。

F3 应保持：

- 导出使用父字段 + 子字段双层表头。
- 多行子表重复主记录字段或按现有 SpreadsheetService 的 grouped row 语义展开。
- 导入按父/子表头定位子字段，重建行数组。
- 子列继续复用各自的选项、成员、部门、DATA_SOURCE 等可读值解析。

如果当前公共 SpreadsheetService 无法安全表达双层子表头，F3 必须先扩展公共工作簿结构，再由 CustomForm 使用，不能在 CustomFormsService 内硬编码一套私有 Excel 解析器。

## 6. MicroMatrix F3 冻结边界

F3 必须完成：

- `sub_product` Metadata 类型与嵌套 `subFields` 配置。
- `fixedColumn / sumColumns` 配置。
- CustomFormData 普通/Blob 值表增加通用行维度。
- 行数组创建、编辑、读取、删除与稳定 `rowBizId`。
- 子表 DynamicForm 表格编辑器。
- 子列文本/数字/选项/DATA_SOURCE/公式/图片/日期/成员/部门基础能力。
- 子表不进入普通列表列、顶层 AdvancedFilter 和批量修改。
- Excel 双层表头基础往返。

F3 不包含：

- `SUB_PRICE` 业务专用产品/价格联动。
- DATA_SOURCE `showFields/refFields` 派生列。
- `combineSearch/linkFields/childLinkFields`。
- 跨行公式、子表与主表之间的自动字段联动。

以上继续归 FORM-001F4 或对应业务模块。
