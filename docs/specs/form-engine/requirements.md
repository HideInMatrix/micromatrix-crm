# Form Engine 与自定义表单需求

## 1. 定位

Form Engine 是当前招生 CRM 的公共元数据能力，负责模块表单、动态字段、字段值、联动、数据源、附件和子表等通用语义。Customer、Lead、Follow-up、自定义表单等能力必须复用这一套协议，不再各自创建字段引擎。

自定义表单作为 Form Engine 的独立数据承载能力继续保留，但是否展示为产品入口由当前模块/导航配置决定；运行时与数据模型本身仍属于现存能力。

## 2. ModuleForm / Field

- 表单定义使用 `SysModuleForm / SysModuleField` 及对应 Blob 保存布局和扩展属性。
- 系统字段由各业务模块模板负责，业务代码不得通过字段同名猜测系统语义。
- 动态字段 key、类型、required、列表展示、Mobile 可见性、字段宽度、唯一性和高级配置由统一 Metadata 服务校验。
- 表单属性与字段属性分别存储；字段配置不得把整个业务模块状态塞进一个无结构 JSON。

## 3. 字段值

- 固定业务列继续保存 tenant、owner、pool、stage、status、索引和资源关联。
- 普通动态值进入 Field 表；大字段、数组和复杂值进入 FieldBlob。
- Formula 不保存最终值，按当前字段定义和运行时上下文计算。
- 动态值读写必须同时校验 tenant、resource、form 与 field 归属。

## 4. 当前字段能力

当前公共运行时至少支持普通文本/数值/日期、select/multiselect/checkbox、member、department、picture、attachment、location、formula、data_source/data_source_multiple 和 `sub_product` 子表。

- `location` 保存规范化地区 code + detail，并支持列表/筛选/Excel 可读转换。
- `attachment` 保存附件 ID 集合，严格执行临时附件 claim、目标绑定和移除清理。
- Picture 与 Attachment 使用不同生命周期，不互相代替。
- `sub_product` 的子字段保存在父字段配置中，禁止无限递归子表。

## 5. Data Source

- 内置 source registry 当前只包含 `CUSTOMER / CONTACT / CLUE`。
- 自定义表单 source 直接使用目标 `customFormId`，不扩张固定枚举。
- 候选加载、resolve 和 record snapshot 必须复用目标业务对象的数据权限，Form Engine 不直接绕过 DataScope 查询数据库。
- 单选保存资源 ID；多选保存 ID 数组。
- 已持久化的数据源字段不允许无约束切换 source type。

## 6. 显隐与联动

- `showControlRules` 控制字段可见性；隐藏字段不参与 required，服务端保存时也必须丢弃伪造值。
- `linkProp` 负责普通选择字段 AUTO/HIDDEN 联动。
- DATA_SOURCE 支持 `combineSearch / showFields / linkFields / childLinkFields`。
- 联动配置保存时必须校验字段存在、类型兼容、父/子表关系和循环引用。
- Web 与 API 使用同一纯运行时规则，不能只在前端执行联动。

## 7. 跨表单复制

跨资源字段复制只能依赖显式 `formLink`；禁止按字段同名、`cf_` 前缀或运行时猜测自动复制。

当前 Lead → Customer、Plan → Record 等业务转换都必须通过已声明的 link 关系处理。

## 8. 自定义表单

- `CustomForm` 与对应 `SysModuleForm` 使用同一 ID。
- 默认系统字段至少包含名称和负责人。
- 自定义数据使用 `CustomFormData + Field/FieldBlob`，不为每张自定义表单创建物理业务表。
- 表单级访问分为 `MANAGE_ALL / MANAGE_OWN / VIEW_ALL`；表单管理员独立于三档成员角色。
- 停用表单对普通成员不可用，管理员仍可进入维护。
- 支持 AdvancedFilter、SavedView、列设置、批量编辑/删除、xlsx 导入和 BullMQ 异步导出。

## 9. 安全与验收

- 所有字段写入都必须在服务端再次执行类型、required、唯一性、source、联动、附件和 tenant 校验。
- transaction 内读取字段定义时不得命中 Redis 派生缓存，避免读到事务外旧状态。
- 跨租户 formId、resourceId、fieldId、附件 ID 和 source ID 必须 fail-closed。
- Form Engine 改动必须覆盖 shared runtime、API rules、真实 PostgreSQL、PC/Mobile 动态表单和 `git diff --check`。
