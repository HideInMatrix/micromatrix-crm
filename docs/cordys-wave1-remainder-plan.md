# CordysCRM Wave 1 剩余复刻执行计划

> 创建日期：2026-08-17
> 前置状态：`cordys-wave1-execution-plan.md` 的 W1.1 - W1.7 已通过 Prisma / build / typecheck / lint / 7 条规则单测 / 71 条 smoke 验收。
> 本文负责当前尚未完成的 CordysCRM Wave 1 对齐部分；仍采用“先读 Cordys 源码并记录事实，再改 MicroMatrix 代码”的执行纪律。

## 1. 执行原则

每个阶段严格使用下面的顺序：

1. 阅读 `CordysCRM/` 对应 Controller / Service / DTO / Mapper / 前端交互。
2. 把新发现的业务规则、权限、数据副作用先更新到本文。
3. 对照 MicroMatrix 当前实现，明确复用点与缺口。
4. 先补共享 DTO / Prisma / 公共 Service，再接 API。
5. 再实现 Web 交互，不复制 Spring/MyBatis 技术结构。
6. 增加 smoke / 单测。
7. 实际运行 `pnpm build && pnpm typecheck && pnpm lint && pnpm smoke`。
8. 验收通过后同步 `parity / baseline / api / 当前执行计划` 文档状态。
9. 每个阶段验收和文档同步完成后立即创建一次本地 Git 提交，提交只包含该阶段及其必要前置依赖，禁止混入无关改动。

`CordysCRM/` 始终只读；商业标讯 API、Cordys 产品授权机制、DataEase、AI/MCP 商业扩展仍明确排除。

前端复刻规则：

- 页面结构、信息层级、按钮位置、弹窗/抽屉流程、筛选与批量操作交互尽量与 `CordysCRM/` 当前源码保持一致。
- 不复制 CordysCRM 的专有图标、图片、iconfont 或其它静态资源。
- 图标优先使用项目现有 Element Plus Icons / 开源通用图标中的近似图标；没有合适图标时先使用纯文字按钮或文字标签，后续允许人工逐个替换。
- 样式实现继续使用 MicroMatrix 当前 Vue 3 + Element Plus + UnoCSS 技术栈，不搬运 Cordys 前端框架实现。

## 2. 剩余阶段顺序

### R1 批量字段修改与批量删除

覆盖：Lead、Customer；联系人批量字段修改放到 R3 一并收口。

目标：

- 支持按当前选中 ID 批量修改一个字段。
- `fieldId` 同时兼容元数据字段 ID 与字段 key。
- 固定字段与 `customData` 字段走同一元数据校验入口。
- 负责人字段不允许绕过已有容量、部门同步、负责人历史、通知逻辑。
- 批量删除按资源权限逐条校验，不能越过数据范围。
- Web 列表批量菜单补“修改字段 / 删除”。
- 池/公海场景使用对应池权限，不把普通列表权限直接套到池管理员语义。

#### R1 Cordys 源码事实（2026-08-17 已确认）

来源：

- `system/dto/request/ResourceBatchEditRequest.java`
- `clue/controller/ClueController.java`
- `clue/service/ClueService.java`
- `clue/service/PoolClueService.java`
- `customer/controller/CustomerController.java`
- `customer/service/CustomerService.java`
- `customer/service/PoolCustomerService.java`
- `ClueControllerTests / CustomerControllerTests / Pool*ControllerTests`

已确认规则：

1. `ResourceBatchEditRequest` 只有三个核心参数：
   - `ids`：非空资源 ID 集合；
   - `fieldId`：字段 ID **或字段 key**；
   - `fieldValue`：目标字段值。
2. 普通线索接口：
   - `POST /lead/batch/update` 使用线索更新权限 + 批量资源权限；
   - `POST /lead/batch/delete` 使用线索删除权限 + 批量资源权限。
3. 普通客户接口对应 `batch/update` 与 `batch/delete`，同样先做资源级批量权限校验。
4. 负责人字段是特殊字段：
   - Clue `batchUpdate(owner)` 转到 `batchTransfer()`；
   - Customer `batchUpdate(owner)` 转到 `batchTransfer()`；
   - 因此容量校验、负责人历史、通知等副作用必须保留，不能直接 SQL update owner。
5. 线索的产品字段批改在 Cordys 会先做产品列表合法性校验；MicroMatrix 当前 Lead 尚无同构产品字段，因此本阶段不虚构该字段，待后续关系模型出现后接入同一扩展点。
6. 普通字段由模块 FieldService 统一执行字段合法性检查、值处理、批量更新与日志。
7. 线索批量删除会同时清理：动态字段、负责人历史、跟进记录、跟进计划，并发送删除通知。
8. 客户批量删除 **不是无条件级联**：如果客户仍被联系人或商机引用，Cordys 会拒绝删除；通过检查后再清理客户字段、协作人、负责人历史、客户关系、跟进记录/计划并记录日志与通知。
9. 池/公海也有独立 `batch-update / batch-delete`，先确认记录所属池并检查池成员/对应池权限；负责人批改仍走池的批量分配逻辑。
10. 继续读取 `PermissionConstants + PoolClueController/Service + PoolCustomerController/Service` 后确认池权限是两层叠加：
    - 功能层：线索池分别要求 `CLUE_MANAGEMENT_POOL:UPDATE / DELETE`，客户公海分别要求 `CUSTOMER_MANAGEMENT_POOL:UPDATE / DELETE`，不复用普通线索/客户 UPDATE/DELETE 权限；
    - 资源层：`checkPoolMember()` 会展开池 `scopeIds` 与管理员 `ownerIds`，当前用户命中任意一组即可；Cordys 内部管理员额外放行。
11. 因此“池管理员”不是唯一允许批改/删除的人；普通 Scope 成员只要同时拥有相应池功能权限也可操作。MicroMatrix 必须保留这两层判断，不能把 `managerIds` 当作功能权限替代品。
12. Cordys 批量池操作先由第一条记录解析 poolId，再做成员检查；MicroMatrix 为避免跨池混批造成语义不清，将采用更严格但兼容的约束：**整批 ID 必须属于同一个明确 poolId**，否则 400 拒绝。

#### R1 MicroMatrix 落地决策

- 新建通用 `ResourceBatchEditDto`，API 统一接收 `ids / fieldId / fieldValue`。
- 元数据服务增加“按 ID 或 key 解析可编辑字段”的公共入口，避免 Lead/Customer 重复实现。
- Lead / Customer Service 各自负责固定字段映射和业务特殊字段；自定义字段复用现有 metadata validator。
- owner 修改复用现有 `batchAssignOwner` / `assignOwner`，不直接 `updateMany ownerId`。
- Customer 删除先检查 Contact / Opportunity 引用；有引用时整个请求拒绝，不做部分删除，保持 Cordys 主列表语义。
- 普通批量更新/删除保持“所有选中资源必须有权操作”；与已有池领取的“局部成功”不是同一语义。
- 写入 `BusinessChangeLogService` 或现有 operation log，至少保留每条资源变更可追溯性。
- 权限码映射采用现有 `<resource>:<action>` 约定：
  - `leadPool:update / leadPool:delete`
  - `customerPool:update / customerPool:delete`
  这些码只映射 Cordys 的池 UPDATE/DELETE 功能权限，池成员关系仍由 ResourcePool Scope 单独校验。

验收：

- [x] Lead 固定字段批改
- [x] Lead 自定义字段批改
- [x] Lead owner 批改复用转移/容量/历史
- [x] Lead 批量删除
- [x] Customer 固定字段批改
- [x] Customer 自定义字段批改
- [x] Customer owner 批改复用转移/容量/历史
- [x] Customer 有 Contact / Opportunity 引用时批量删除拒绝
- [x] Customer 无引用时批量删除成功
- [x] Lead/Customer Web 批量菜单
- [x] LeadPool/CustomerPool 独立批量修改/删除权限 + 同池成员校验
- [x] smoke 覆盖权限、字段更新、owner 副作用、引用保护

2026-08-17 R1 验收结果：

- 新增 `ResourceBatchEditDto / PoolResourceBatchEditDto / PoolBatchIdsDto`。
- Metadata 支持字段 ID/key 双解析；formula/hidden 字段禁止批改。
- 普通 Lead/Customer 与 Pool/Sea 各有独立批改/批删接口。
- Pool 功能权限新增 `leadPool:update/delete`、`customerPool:update/delete`，并叠加 ResourcePool Scope/manager 成员校验。
- owner 批改不走裸 `updateMany`，保留库容、归属部门、负责人历史、通知、离池/离公海语义。
- Customer 单条删除与批量删除统一执行 Contact/Opportunity/Quote/Contract 引用保护和关联清理。
- Web 新增可复用 `BatchFieldEditDialog`；普通列表与池/公海按各自权限显示多选批量操作。
- `pnpm build`：通过；`pnpm typecheck`：通过；`pnpm lint`：通过；`test:rules`：7/7 通过；`pnpm smoke`：**90/90 通过**。

状态：`✅ COMPLETE / 2026-08-17 已通过完整门槛验收`

### R2 完整导入导出

目标：

- 补齐普通列表与池/公海的“全部导出 / 选中导出”。
- 对齐 Cordys 字段选择、权限和当前筛选条件语义。
- 从现有 CSV 基础升级到 xlsx 新建/更新；大任务接口先抽象，BullMQ 放 Wave 6。
- 导入错误返回行级原因，不允许静默丢行。

开始编码前必须继续阅读 Cordys `ImportRequest / ExportSelectRequest / ExportTaskCenterService / ClueExportService / CustomerExportService / Pool* import/export`。

#### R2 Cordys 源码事实（2026-08-17 已确认）

后端来源：

- `clue/controller/ClueController.java`
- `clue/controller/PoolClueController.java`
- `customer/controller/CustomerController.java`
- `customer/controller/PoolCustomerController.java`
- `system/dto/request/ImportRequest.java`
- `clue/dto/request/CluePoolImportRequest.java`
- `customer/dto/request/CustomerPoolImportRequest.java`
- `common/dto/ExportSelectRequest.java`
- `system/dto/response/ImportResponse.java`
- `system/excel/listener/CustomFieldCheckEventListener.java`
- `system/excel/listener/CustomFieldImportEventListener.java`
- `common/service/BaseExportService.java`
- `system/service/ExportTaskCenterService.java`

前端来源：

- `components/business/crm-import-button/**`
- `components/business/crm-table-export-modal/index.vue`
- `views/clueManagement/clue/components/clueTable.vue`
- `views/clueManagement/cluePool/components/cluePoolTable.vue`
- `views/customer/components/customerTable.vue`
- `views/customer/components/openSeaTable.vue`

已确认规则：

1. 导入是两阶段接口，不是前端直接解析后提交 JSON：
   - 下载 Excel 模板；
   - `import/pre-check` 上传文件做完整校验；
   - 用户查看成功/失败条数和错误详情；
   - `import` 再上传同一文件执行正式导入。
2. 导入类型只有 `ADD / UPDATE`：
   - `ADD` = 导入新建；唯一字段命中已有数据时该行失败；
   - `UPDATE` = 导入更新；Excel 必须包含 `唯一ID` 列，且每条被更新数据必须提供有效资源 ID；不可编辑字段不会被更新。
3. Cordys 导入结果统一返回：`successCount / failCount / errorMessages[]`；错误项包含 `rowNum / errMsg`，前端可查看错误详情，也允许“忽略错误继续导入”，正式导入仅处理合法行。
4. 前端上传框只接受 Excel，提示仅支持 `xls/xlsx`，源码默认最大文件 100MB。
5. 普通线索/客户导入分别使用普通 IMPORT 权限；池/公海使用独立 POOL IMPORT 权限，并在功能权限之后继续执行 `checkPoolMember()`。
6. 池/公海导入请求在 `importType` 外增加 `poolId`。
7. 池/公海导入模板和校验会移除负责人字段；正式导入会强制写入 `inPool/inSea=true + poolId`，不允许通过 Excel 给池内记录指定负责人。
8. 导出分“导出全部”和“导出选中”：
   - 全部导出请求携带当前查询条件/保存视图/数据范围及 `headList`；
   - 选中导出请求至少包含 `fileName + headList + ids`，普通列表还需做批量资源权限校验；
   - 池/公海导出使用独立 POOL EXPORT 权限并校验池成员。
9. `headList` 不是固定后端列：用户可选择导出字段并调整顺序，系统字段、自定义字段、展示字段分组显示。
10. Cordys 导出前端使用约 800px 抽屉：顶部文件名输入框并固定 `.xlsx` 后缀；左侧字段分组勾选，右侧展示“已选字段（数量）”，支持清空和拖拽排序。
11. 导出全部按钮位于列表顶部动作区；“导出选中”位于勾选数据后的批量操作区。导入按钮同样位于列表顶部，与新增按钮并列。
12. Cordys 导出 API 返回导出任务 ID，不直接同步返回文件。`ExportTaskCenterService` 只允许创建者查看/取消/下载自己的任务，并以 1 天作为列表/清理边界。
13. MicroMatrix R2 采用同一 UI/接口语义，但第一阶段不引入 BullMQ：先建立 `ExportTask` 持久化任务契约，任务在 API 进程内立即生成 xlsx 并进入 SUCCESS/FAILED；Wave 6 再把执行器替换为 BullMQ，不改变前端任务 API。

#### R2 MicroMatrix 落地决策

- 引入公共 `SpreadsheetService + ExportTasksService`，Lead/Customer/Pool 只提供资源查询、行转换与业务写入 adapter，不重复写 xlsx 解析器。
- xlsx 模板使用“字段 label 作为表头”；更新模板首列增加 `唯一ID`。系统字段和 `cf_*` 自定义字段都来自 Metadata。
- 导入预校验与正式导入复用同一解析/校验函数，正式导入只执行预校验后仍合法的行；响应保持 `successCount/failCount/errorMessages`。
- ADD 复用现有 `create()`，UPDATE 复用现有 `update()`；池/公海 ADD/UPDATE 使用池专用写入路径，强制保持池归属并禁止 owner 字段。
- 新增普通列表和池/公海“导出全部 / 导出选中”，headList 只允许当前 Metadata 中可导出的字段，服务端再次净化，不能由前端注入任意属性。
- 新增 `ExportTask` 模型与 `/export-tasks` 列表/下载/删除（取消）契约；文件存储先使用现有本地 uploads 根目录下的 export 子目录。
- Web 新建公共 `CrmImportDialog` / `CrmExportDrawer` 风格组件；结构和交互对齐 Cordys，图标仅使用 Element Plus 近似图标或文字。
- Lead/Customer 页面顶部按钮顺序、池选择器、批量导出入口按 Cordys 布局调整，但继续保留 MicroMatrix 已有 SavedView/高级筛选能力。
- 普通导入/导出权限按 Cordys 拆分为 `lead:import / lead:export`、`customer:import / customer:export`；池/公海使用 `leadPool:* / customerPool:*` 独立权限。
- 当前 xlsx 解析基于 ExcelJS，因此 R2 只接受 `.xlsx`，不兼容 Cordys 仍支持的旧 `.xls` 格式。
- Cordys 的 ADD 导入“唯一字段”来自字段规则 `rules.unique`；MicroMatrix 当前 Metadata 尚无同构 unique 规则。Customer 继续执行现有名称/电话业务查重；Lead 不擅自把名称设为唯一。字段级 unique 规则需在后续元数据能力对齐时统一覆盖 CRUD + import，不能只在导入链临时实现。

验收：

- [x] Lead ADD/UPDATE xlsx 模板、预检、正式导入
- [x] Customer ADD/UPDATE xlsx 模板、预检、正式导入
- [x] LeadPool/CustomerPool xlsx 导入且强制池归属、禁止 owner
- [x] 普通列表导出全部继承当前筛选/view/data scope
- [x] 普通列表导出选中严格按 ids
- [x] 池/公海导出全部与选中使用独立权限 + PoolMember 校验
- [x] 导出字段选择、顺序、文件名与 xlsx 内容一致
- [x] ExportTask 仅创建者可下载/取消
- [x] Web 导入两阶段交互与 Cordys 结构一致
- [x] Web 导出字段抽屉与 Cordys 结构一致
- [x] build/typecheck/lint/smoke 全绿
- [x] R2 独立本地 Git 提交

2026-08-17 R2 验收结果：

- 新增 `ExportTask` Prisma 模型与 `20260817133000_r2_export_tasks` migration，已实际应用，当前数据库共 15 个 migration。
- 新增公共 `SpreadsheetService`，统一负责 xlsx 模板、解析、字段类型转换和导出工作簿生成。
- 新增 `ExportTasksService / ExportTasksController`；任务仅创建者可见、下载、清理，24 小时自动过期；当前 API 进程同步生成文件，保留后续 BullMQ 执行器替换契约。
- Lead/Customer 普通列表与 Pool/Sea 均实现模板、预检、正式导入、导出全部、导出选中。
- Web 使用 `CrmImportDialog / CrmExportDrawer / ExportTaskButton`；导入采用 Cordys 两阶段流程，导出采用约 800px 双栏字段选择抽屉，未复制 Cordys 图标资源。
- `scripts/smoke.mjs` 使用真实 xlsx 文件验证 ADD/UPDATE、唯一ID、池归属、owner 排除、筛选导出、字段顺序、任务隔离与池权限；当前 **109/109 通过**。
- 最终门槛：`pnpm build` 通过；`pnpm typecheck` 通过；`pnpm lint` 通过；`pnpm --filter @micromatrix/api test:rules` **7/7**；`pnpm smoke` **109/109**。

状态：`✅ COMPLETE / 2026-08-17 已通过完整门槛验收`

### R3 联系人完整能力

目标：

- 联系人独立列表/分页/详情/新增/编辑/删除。
- SavedView / 高级筛选 / 批量更新 / 导入导出。
- owner、部门、协作客户访问规则继续沿 W1.2 已确认语义。
- 重复校验、商机关联检查、客户 360 联动。

开始编码前必须阅读 `CustomerContactController / Service / Mapper / frontend contact views`，并确认 Cordys 联系人唯一字段配置语义。

状态：`⏳ PLANNED`

### R4 线索转客户 / 联系人 / 商机关系补齐

目标：

- 对齐首次转化、重新关联已有客户、批量重新关联的 Cordys 行为。
- 明确线索 `transitionType / transitionId` 等等价关系在 MicroMatrix 中如何建模。
- 补跟进记录/计划迁移或关联语义；FollowUpPlan 对象本身仍在 Wave 2 时，先预留兼容接口，不伪造完整计划功能。
- 转化后联系人、商机、客户关系不能重复创建或留下孤立引用。

状态：`⏳ PLANNED`

### R5 客户 360 完整 Tab

目标：

- 在现有联系人 / 商机 / 合同 / 跟进 / 团队 / 关系 / 历史基础上补齐 Cordys 360 页面仍缺的资源与计数。
- 所有 Tab 继续使用 W1.2 `CustomerAccessService`，防止 360 聚合接口成为权限旁路。
- 大列表使用独立分页接口，不无限塞进详情响应。

状态：`⏳ PLANNED`

### R6 组织、角色与数据范围收口

目标：

- 部门主管语义。
- `CUSTOM` 自定义部门数据范围完整管理 UI/API。
- 角色权限树与菜单/动作权限同步。
- 资源级权限剩余扩展点。
- 字段/对象级特殊权限只建立可扩展契约；完整字段脱敏仍归 Wave 5。

状态：`⏳ PLANNED`

## 3. Wave 1 最终完成门槛

只有 R1 - R6 全部完成并满足以下门槛，当前 Wave 1 对齐阶段才允许标记完成：

```text
R1 - R6 功能与 UI 完成
+ Prisma schema/migration 一致
+ pnpm build
+ pnpm typecheck
+ pnpm lint
+ pnpm smoke
+ 新增针对性单测/集成测试通过
+ api / parity / baseline / 当前执行计划文档同步
+ 本地 Git 阶段提交完成
```
