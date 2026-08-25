# W3.4.0 模块表单与动态字段底座实施记录

> 实施日期：2026-08-25
>
> 对应任务：1.4
>
> 当前结论：公共服务、规则测试和真实 PostgreSQL Smoke 已完成；目标业务 Service 的列表/详情/导出接入仍由 1.7 完成，因此任务 1.4 暂不整体勾选。

## 1. Cordys 源码依据

本轮不是按现有页面反推，直接读取并对照：

- `ModuleFormController` 与 `ModuleFormService`：表单配置、表单 Blob、字段/字段 Blob 保存和排序；
- `ModuleFieldController` 与 `ModuleFieldService`：字段展示、重复值检查和数据源边界；
- `BaseResourceFieldService`：字段必填/类型校验、普通值/Blob 路由、批量写入、批量读取和字段删除；
- `BaseField`：Blob 类型、必填、唯一、选项和可编辑规则。

Cordys 使用 `sys_module_form(_blob)`、`sys_module_field(_blob)` 保存配置，并由每个资源独立的 `*_field/*_field_blob` 保存当前值。MicroMatrix 按该关系实现，不恢复 `field_definitions` 或目标业务 `customData`。

## 2. 已实施能力

- 新建全局 `ModuleFormsModule`，提供 `ModuleFormsService`、稳定 `MetadataService` 输出适配和 `ResourceFieldValueService`。
- `ModuleFormsService` 直接读写四张 `sys_module_*` 表：按组织和 formKey 初始化表单及系统字段，字段扩展属性写 Blob，支持新增、编辑、删除、排序和表单属性保存。
- 删除字段会在同一事务删除 Clue、Customer、CustomerContact 六张普通值/Blob 表中的关联值；系统字段不可删除，字段已有数据时禁止跨普通/Blob 存储类型修改。
- `MetadataService` 不再访问旧 `FieldDefinition`；当前 Web 继续收到稳定 `FieldVO`，图外模块暂时使用 `customData` 时也只把新 ModuleForm 表作为字段定义真相。
- `ResourceFieldValueService` 支持 Clue、Customer、CustomerContact：
  - 必填、数字范围、邮箱、电话、日期、布尔、选项和多选校验；
  - ≤255 字符普通值与大文本/数组 Blob 路由；
  - 组织隔离唯一检查和事务级 advisory lock；
  - 主记录调用方传入同一 `Prisma.TransactionClient`，字段写入不自行开启第二事务；
  - 单资源保存、批改、两次查询批量装配和类型恢复；
  - 将高级筛选编译为组织隔离、表名白名单和参数化值的 PostgreSQL SQL。
- 模块设置删除提示已去除 `customData` 描述，并明确字段值会同步删除；目标三模块的文本/电话/邮箱自定义字段可配置唯一规则。

## 3. 自动验证

### 3.1 规则测试

新增 7 条规则测试，全部通过：

1. 必填、类型、数字范围与选项约束；
2. 普通值/Blob 路由；
3. 唯一值组织隔离与更新排除自身；
4. 批量装配无 N+1 且恢复 number/array 类型；
5. 批改与唯一字段多资源拒绝；
6. 参数化高级筛选编译；
7. 字段值写入失败时由调用方同一事务整体回滚。

全量公共规则测试由 `70/70` 增至 `77/77`，全部通过。

### 3.2 真实 PostgreSQL Smoke

- 新建隔离数据库 `w34_fields_audit`，从零应用全部 30 个 migration 成功。
- `smoke:w34-fields` 完成 12 项断言：表单/系统字段初始化、自定义字段与 Blob、新建主记录和字段值同事务、批量读取、普通/Blob 筛选、唯一冲突回滚、主动异常回滚和字段删除清理。
- Smoke 通过后已删除临时数据库；主开发库没有应用 W3.4 破坏性迁移。

### 3.3 静态验证

- Metadata/ModuleForms/ResourceFieldValue 新代码没有 TypeScript 错误，改动文件 ESLint 通过。
- shared 与 Web typecheck 通过。
- API 全局编译断点由初始 411 个/16 个文件下降到 397 个/15 个文件；`metadata.service.ts` 的 14 个旧 FieldDefinition 错误已全部消除。

## 4. 未完成边界

- Customers、Clues、CustomerContacts 旧 Service 还没有调用 `ResourceFieldValueService`，所以列表、详情、表单、导入导出仍未完成从 `customData` 到直接字段值表的最终切换。
- 这部分与主模型、池、负责人历史和下游关系迁移必须在任务 1.7 同批完成，不能为提前勾选 1.4 增加 DTO 别名或双写。
- 图外 Opportunity/Product/Quote/Contract/Order/FollowUpPlan 继续由 DB-021 跟踪；它们的字段定义已经切到 ModuleForm，但字段值表要在各模块逐页对齐时直接建立。

下一独立公共执行单元为任务 1.5：用户视图直接模型与公共 Service。任务 1.7 完成目标业务调用方切换后，再关闭任务 1.4 的最后一项验收门槛。
