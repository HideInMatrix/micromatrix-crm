# FORM-001F1 附件 / LOCATION 源码与实现边界审计

## 1. Cordys LOCATION 事实

源码证据：

- `frontend/packages/lib-shared/enums/formDesignEnum.ts`：字段类型 `LOCATION`。
- `frontend/packages/web/src/components/business/crm-form-create/config.ts`：LOCATION 默认 `scope = ALL`、`locationType = PCD`。
- `frontend/packages/web/src/components/business/crm-form-create/components/advanced/location.vue`：使用地区级联选择；`locationType = detail` 时增加 200 字详细地址。
- `frontend/packages/web/src/components/business/crm-form-design/components/formAttrConfig/fieldAttr.vue`：设计器支持 `scope = CN / ALL` 与 `locationType = C / P / PC / PCD / detail`；CN 范围不提供仅国家 `C`。
- `backend/crm/.../LocationField.java`：字段属性只有 `scope / locationType`。
- `backend/crm/.../LocationScope.java`：`ALL` 与 `CN`，其中 CN 包含港澳台。
- `backend/crm/.../LocationResolver.java`：LOCATION 是普通字符串字段，展示时使用 `RegionUtils.codeToName()` 由编码转换名称，导入时使用 `RegionUtils.mapping()` 将文本映射回编码。

运行时值不是多列地址对象。Cordys Web 的 LOCATION 组件最终保存：

```text
<regionCode>-<detail>
```

非 `detail` 类型 detail 为空；由于详细地址本身可能包含 `-`，解析时只把第一段作为地区编码，其余部分重新 join。

## 2. Cordys ATTACHMENT 事实

源码证据：

- 字段类型为 `ATTACHMENT`。
- 默认字段配置：`onlyOne=false / accept='' / limitSize=''`。
- 运行时最多 10 个附件；`onlyOne=true` 时最多 1 个。
- `accept` 为逗号分隔扩展名；`limitSize` 支持 KB/MB，未配置时前端按 20MB 提示和校验。
- 新建/编辑先调用 `/attachment/upload/temp` 上传临时附件，字段值只保存附件 ID 数组。
- `AttachmentFieldResolver.convertToString()` 将 ID 数组 JSON 化；读取时通过 `attachmentMap[fieldId]` 补充文件名称等元数据。
- `BaseField.canImport/canExport/canDisplay` 明确：附件不进入 Excel 导入、Excel 导出和普通子列表展示。
- Cordys 批量编辑明确排除 ATTACHMENT。

## 3. MicroMatrix 当前可复用能力

已有：

- `Attachment / AttachmentsService / AttachmentUploader`；
- `/attachments/upload` 在不传 `targetType / targetId` 时已经可以创建临时附件；
- `AttachmentsService.removeFromTarget / viewFromTarget` 已支持领域服务在完成业务权限校验后操作目标附件；
- `SysModuleFieldBlob` 可保存字段配置；
- `CustomFormDataFieldBlob` 已保存 textarea/multiselect/checkbox/picture 等复杂值；
- `DynamicForm / DynamicFormItem` 已具备图片、成员、部门等可插拔字段输入组件。

实施前缺口（现已由 FORM-001F1 关闭）：

- `FieldType` 缺少 `location / attachment`；
- `FieldConfig` 缺少 LOCATION / ATTACHMENT 属性；
- DynamicForm 缺少地址级联和附件临时上传组件；
- CustomFormData 缺少附件 ID 合法性、绑定、替换清理和详情 `attachmentMap`；
- `BLOB_FIELD_TYPES`、字段值校验、批量编辑、导入导出字段选择缺少 ATTACHMENT 语义；
- AdvancedFilter 缺少 LOCATION 语义。

## 4. 实施结论

F1 不新建附件表，也不把附件内容/base64 写入 FieldBlob。

### LOCATION

- 新增 `location` FieldType。
- 配置沿用 Cordys 名称：`scope / locationType`。
- 值沿用 Cordys字符串契约 `<regionCode>-<detail>`。
- 地区编码树以当前仓库内 CordysCRM 的 `crm-city-select` 数据为证据源，提取到 MicroMatrix 自有 Form Engine 数据模块，运行时不依赖 `CordysCRM/` 目录。
- Web 负责级联选择和名称展示；共享 location helper 同时提供 code -> path、文本 -> code，供 API Excel 导入/导出使用。

### ATTACHMENT

- 新增 `attachment` FieldType，存入 `CustomFormDataFieldBlob`，值为 JSON string[]。
- 新建时先调用现有 `/attachments/upload` 生成 `targetType/targetId = null` 临时附件。
- CustomFormData 保存前仅接受：当前租户、当前用户上传、尚未绑定的临时附件；编辑时同时接受已经绑定到当前 `customFormData + dataId` 的附件。
- 保存成功后把新增临时附件绑定为 `targetType=customFormData / targetId=dataId`。
- 更新后删除“旧值存在、新值移除”的已绑定附件；删除数据/批量删除时清理该数据全部绑定附件。
- 详情返回 `attachmentMap[fieldKey]`，DynamicForm 用它恢复文件名/大小；字段值仍保持纯 ID 数组。
- ATTACHMENT 不参与 Excel 导入导出、AdvancedFilter、列表列和批量编辑。

## 5. 安全边界

- 前端 `accept / limitSize / onlyOne` 只是体验校验；服务端必须重新检查附件数量、文件大小、扩展名与归属。
- 不能接受其他用户未绑定的临时附件 ID，避免通过猜 ID 抢占附件。
- 已绑定到其它业务目标或其它 CustomFormData 的附件不可复用。
- 绑定/删除附件必须发生在 CustomFormData 写权限检查之后。
- 数据写事务失败时不得先删除旧附件；附件绑定与旧附件物理清理由事务成功后的 finalize 阶段执行。

## 6. 实施与验收结论

截至 2026-09-05，F1 已按上述边界落地并完成真实运行时验收：

- 公共 `FieldType / FieldConfig / Metadata / DynamicForm` 已支持 `location / attachment`；
- LOCATION 复用独立地区数据与共享 helper，值契约保持 `<regionCode>-<detail>`；Web 列表按可读路径展示，高级筛选使用 Cascader；
- Excel LOCATION 文本与 Cordys `RegionUtils.codeToName/textToValue` 对齐，使用 `-` 分隔行政区与详细地址，同时保留既有 `/` 文本兼容解析；
- ATTACHMENT 使用 `CustomFormDataFieldBlob` 保存附件 ID 数组，详情通过 `attachmentMap` 恢复元数据；
- 临时附件 claim、跨用户抢占、业务域通用下载/删除绕过、MANAGE_OWN 读取绕过均有服务端拒绝断言；
- 替换附件、删除数据、删除 ATTACHMENT 字段、删除整个表单都会同步清理对应附件记录与物理文件；
- ATTACHMENT 已从普通列表列、AdvancedFilter、列设置、批量编辑和 Excel 导入导出中排除；LOCATION 保持列表/筛选/xlsx 能力。

验收结果：

- `form001-f1-service-smoke.mjs`：**26/26 PASS**；
- `form001-f1-browser-smoke.mjs`：**16/16 PASS**；
- 原 FORM-001 + E Browser 回归：**31/31 PASS**。
