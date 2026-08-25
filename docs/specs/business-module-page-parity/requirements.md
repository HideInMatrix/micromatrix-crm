# W3.4 图中业务模块逐页对齐需求

## 1. 目标

W3.4 以 `CordysCRM/` 源码为第一事实来源，完成用户功能图中的首页、线索、线索池、客户、联系人、客户公海和仪表板。每个页面必须按“页面源码 → API 封装 → Controller → Service → Domain/DTO/Mapper → 数据库 → NestJS API → Vue 页面 → 自动化与浏览器验收”的顺序形成闭环。

现有 MicroMatrix 页面或接口只能作为待核对实现，不能作为需求来源。凡现有实现与 Cordys 冲突，直接改为 Cordys 语义，不保留旧字段、旧接口、旧页面或双写兼容层。

## 2. Cordys 源码基线

### 2.1 首页

- 页面：`frontend/packages/web/src/views/workbench/index.vue`
- 数据概览：`views/workbench/components/dataOverviewIndex.vue`、`overview.vue`
- 快捷入口：`views/workbench/components/quickAccess.vue`、`config/workbench.ts`
- 前端 API：`frontend/packages/lib-shared/api/modules/home.ts`、`api/requrls/home.ts`
- 后端：`HomeStatisticController`、`HomeStatisticService`、Home Statistic DTO、`ExtClueMapper`、`ExtOpportunityMapper`

### 2.2 线索与线索池

- 页面：`views/clueManagement/clue/index.vue`、`clueTable.vue`、`clueOverviewDrawer.vue`
- 线索池：`views/clueManagement/cluePool/index.vue`、`cluePoolTable.vue`、`cluePoolOverviewDrawer.vue`
- 前端 API：`frontend/packages/lib-shared/api/modules/clue.ts`、`api/requrls/clue/index.ts`
- 后端：`ClueController`、`PoolClueController`、`ClueService`、`PoolClueService`、`CluePoolService`、Owner History/User View/Follow 相关 Controller 与 Service
- 数据模型：`Clue`、`ClueOwner`、`ClueField`、`ClueFieldBlob`、`CluePool`、`CluePoolHiddenField`、`CluePoolPickRule`、`CluePoolRecycleRule`、`ClueCapacity`

### 2.3 客户、联系人和客户公海

- 页面：`views/customer/customer.vue`、`contact.vue`、`openSea.vue`
- 列表和详情：`customerTable.vue`、`openSeaTable.vue`、`customerOverviewDrawer.vue`、`openSeaOverviewDrawer.vue`
- 关联能力：`collaborator.vue`、`customerRelation.vue`、`mergeAccountModal.vue`
- 前端 API：`frontend/packages/lib-shared/api/modules/customer.ts`、`api/requrls/customer/index.ts`
- 后端：`CustomerController`、`CustomerContactController`、`PoolCustomerController`、`CustomerService`、`CustomerContactService`、`PoolCustomerService`、Customer Pool/Owner History/User View/Collaboration/Relation 相关实现
- 数据模型：`Customer`、`CustomerOwner`、`CustomerField`、`CustomerFieldBlob`、`CustomerContact`、`CustomerContactField`、`CustomerContactFieldBlob`、`CustomerPool`、`CustomerPoolHiddenField`、Pick/Recycle Rule、`CustomerCapacity`、`CustomerCollaboration`、`CustomerRelation`

### 2.4 仪表板

- 页面：`views/dashboard/index.vue`、`module.vue`、`link.vue`、`fullPage.vue`
- 组件：`components/tree.vue`、`table.vue`、`addDashboardModal.vue`、`dashboard.vue`
- 前端 API：`frontend/packages/lib-shared/api/modules/dashboard.ts`、`api/requrls/dashboard.ts`
- 后端：`DashboardController`、`DashboardModuleController`、`DashboardService`、`DashboardModuleService`、`DashboardSortService`
- 数据模型：`Dashboard`、`DashboardModule`、`DashboardCollection`

## 3. 实施分段

W3.4 按以下顺序实施，每段通过自身迁移、API、权限、页面和专项测试后才能进入下一段：

1. **W3.4.0 公共依赖与数据模型审计**：直接模型、权限码、数据范围、动态字段、用户视图、导入导出、负责人历史、池规则和通用表格能力。
2. **W3.4.1 首页**：数据概览、快捷入口、我的计划、审批待办、消息通知。
3. **W3.4.2 线索与线索池**：普通线索、转换链路、详情、批量操作、多线索池。
4. **W3.4.3 客户域**：客户、联系人、客户公海、客户 360、协作、关系和合并。
5. **W3.4.4 仪表板**：目录、资源、范围、收藏、排序和嵌入/跳转。
6. **W3.4.5 全图验收**：菜单、跨页跳转、权限组合、租户隔离、浏览器和全量回归。

## 4. 验收需求

### R1：源码驱动与直接模型约束

1. 当开始任一页面时，系统必须先完成该页真实调用的 API 和后端实现清单，不得根据截图、菜单名称或当前 MicroMatrix 页面推断功能。
2. 当页面依赖公共能力时，系统必须先核对并补齐公共能力，再开发该业务页；不得在多个页面内各写一套近似实现。
3. 当触及线索、客户、联系人、池或仪表板数据库时，表、模型、字段关系和状态语义必须以 Cordys Domain 与迁移为准；NestJS 技术栈只替代实现框架，不改变业务模型。
4. 当现有通用 `ResourcePool/ResourceOwnerHistory/PoolRule`、`customData` 或旧 Dashboard 统计模型不能一一表达 Cordys 表关系时，系统必须迁移到 Cordys 对应的分域模型并删除旧模型；不得双写、保留兼容字段或同时维护两个真相。
5. 数据迁移允许清空并重建本地开发数据，但迁移完成后全部 Seed、测试和页面必须正常工作。

### R2：公共列表与页面底座

1. 线索、线索池、客户、联系人和客户公海必须复用同一套已对齐的动态列、关键词、高级筛选、系统视图、个人视图、分页、排序和列偏好能力。
2. 个人视图必须支持新增、编辑、删除、固定、启停和拖拽排序，并按用户、组织和业务模块隔离。
3. 列表行和批量操作必须同时受功能权限与资源数据范围约束；隐藏按钮不得替代后端鉴权。
4. 新增/编辑抽屉、详情概览、批量编辑、导入、导出和图表必须读取真实 Metadata、真实 API 和真实业务数据，不得使用静态字段或伪数据。
5. 池列表隐藏字段必须按当前池配置生效，但后端资源读取和导出仍必须执行对应权限与字段规则。

### R3：首页数据概览

1. 首页必须提供 Cordys 的今天、本周、本月、本年四个统计周期，分别展示新增线索、商机数/金额、进行中商机数/金额和赢单数/金额。
2. 首页必须支持“本人 / 有权部门 / 全部”的组织范围选择；可选部门树必须经过当前用户角色数据范围裁剪。
3. 线索统计必须支持按创建人或负责人切换；商机统计必须支持创建时间或预计结束时间；赢单统计必须支持预计或实际结束时间以及是否计算环比。
4. 点击统计项必须带着周期、部门范围、统计字段和状态条件进入对应真实业务列表，不得只跳到无筛选页面。
5. 用户没有相应模块读取权限时，首页必须隐藏或禁用对应统计与跳转，后端仍必须拒绝越权统计。

### R4：首页工作区

1. 首页必须按 Cordys 提供最多 5 个、最少 1 个的个性化快捷入口，并按新增权限过滤客户、联系人、线索、商机、合同、发票、跟进记录、跟进计划和订单入口。
2. 快捷入口必须打开真实新增表单并在保存后刷新相关首页数据；不可用模块不得显示空壳入口。
3. 首页必须展示当前用户的真实跟进计划，并能进入“我的计划”完整列表。
4. 首页必须展示待我审批、我处理的、我发起的和抄送我的审批入口；计数和列表必须使用同一审批数据源。
5. 首页必须展示真实消息通知并能进入消息列表；默认密码提醒和修改密码入口不得因页面重构丢失。

### R5：线索页面

1. 线索页必须支持新增、查看、编辑、删除、状态变更、负责人历史、跟进记录、跟进计划、导入、导出、批量转移、批量编辑、批量删除和移入线索池。
2. 线索列表必须保留 Cordys 的普通数据视图和“已转客户”语义；已转换关系必须由 `transitionType + transitionId` 决定，不得只依赖展示状态。
3. 三条转换路径必须继续独立可用：自动转换、新建客户并关联、关联已有客户；转换的联系人、协作、跟进和商机副作用必须保持既有已验收规则。
4. 线索详情和转换界面必须使用真实动态字段、表单规则和权限；当前阶段发现但尚未具备的跨表单联动字段必须登记，不得静态伪造。
5. 普通线索列表不得返回池中线索；进入池、转移、转换和删除必须在事务中维护负责人历史、池原因和关联状态。

### R6：线索池页面

1. 线索池页必须按当前用户 Scope 展示可访问的多个命名池，并支持切换、池级隐藏字段和池配置入口。
2. 领取、批量领取、分配、批量分配、编辑、批量编辑、删除、批量删除、导入、导出和图表必须使用独立池权限。
3. 领取必须执行每日领取上限、前归属人冷却、新数据冷却和线索库容规则；分配与自动回收必须维护 Cordys 对应负责人历史和池原因。
4. 池详情必须只展示 Cordys 允许的字段、跟进记录和负责人历史，不得借用普通线索权限绕过池权限。
5. 自动回收必须按每个池的启用状态和条件组执行，并具备幂等、通知、审计与失败可诊断性。

### R7：客户页面与客户 360

1. 客户页必须支持 Cordys 系统视图、个人视图、新增、详情、编辑、删除、转移、批量操作、移入公海、导入、导出、图表、客户关系和客户合并。
2. 客户 360 必须继续提供客户信息、跟进记录、跟进计划、联系人、负责人历史、客户关系、商机、协作人、合同、回款计划、回款记录、发票和订单，并按对应模块权限裁剪。
3. 普通客户、协作客户和只读协作客户必须保持不同的读取与写入边界；协作关系不得提升客户主体管理权限。
4. 客户关系必须保持集团/子公司唯一、数量、单集团和防循环约束；客户合并必须保留预览、二次确认、负责人约束和关联资源处理。
5. 普通客户列表不得混入公海客户；移入公海、转移、删除和合并必须在事务中维护负责人历史、协作关系和关联资源。

### R8：联系人页面

1. 联系人必须保持独立一级页面和客户 360 内嵌列表两种入口，二者分别执行 Contact 数据范围和 Customer 子资源访问规则。
2. 独立页面必须支持系统/个人视图、新增、详情、编辑、启用、停用原因、删除、批量编辑、导入和导出；不得新增 Cordys 不存在的批量删除操作。
3. 联系人删除前必须检查商机关联；被引用的联系人必须由服务端拒绝删除并返回明确原因。
4. 联系人动态字段、字段唯一性和启停状态必须由同一数据模型与 Metadata 规则驱动，不得在独立页和客户详情中分叉。
5. `READ_ONLY` 协作用户不得写联系人；`COLLABORATION` 用户只能在 Cordys 允许的客户子域内管理其有权负责的联系人。

### R9：客户公海页面

1. 客户公海必须按当前用户 Scope 展示多个命名公海，并支持切换、池级隐藏字段和池配置入口。
2. 领取、批量领取、分配、批量分配、编辑、批量编辑、删除、批量删除、导入、导出和图表必须使用独立公海权限。
3. 领取必须执行每日领取上限、前归属人冷却、新数据冷却和客户库容/排除条件；分配与自动回收必须维护负责人历史和公海原因。
4. 公海客户详情只允许客户信息、跟进记录和负责人历史；普通客户 360 资源必须由后端拒绝，不能依靠前端隐藏。
5. 公海数据不得通过普通客户 API、协作关系或手工构造请求绕过池范围和操作权限。

### R10：仪表板

1. 现有 `/reports` ECharts 报表页不是 Cordys 仪表板，必须替换为 Cordys 的仪表板目录与资源管理，不保留旧报表兼容入口。
2. 仪表板必须支持多级文件夹树、文件夹新增/改名/删除/移动、仪表板新增/编辑/改名/删除/排序和按目录分页查询。
3. 仪表板资源必须保存名称、资源 URL、目录、成员范围、描述、组织、排序和创建/更新审计；只有 Scope 命中的成员可读取。
4. 用户必须可以收藏/取消收藏仪表板并查看“我的收藏”；收藏、目录计数和列表必须来自真实数据库。
5. 仪表板必须支持站内嵌入和全屏/新窗口打开；外部 URL 必须经过协议与安全校验，禁止脚本协议和任意凭据拼接。
6. Cordys 的 DataEase 属外部部署依赖。W3.4 必须实现配置、token/嵌入适配边界和失败状态，但不复制 Cordys License 系统，也不捆绑 DataEase 服务端；自动验收使用可控测试资源验证管理与嵌入闭环。

### R11：权限、日志与跨页一致性

1. 首页统计、线索、线索池、客户、联系人、公海和仪表板必须使用与 Cordys 对应的读取、新增、更新、删除、转移、领取、分配、导入和导出权限粒度。
2. 菜单可见、页签可见、按钮状态和后端 Guard 必须使用同一权限事实；多角色权限并集与按权限码解析的数据范围不得回退。
3. 新增、编辑、删除、状态变更、转移、池操作、转换、合并、目录操作和仪表板收藏等关键动作必须进入真实操作日志或业务日志。
4. 从首页统计、消息、审批、跟进计划、线索转换和客户 360 进入业务页面时，筛选、资源 ID 和返回路径必须保持一致。
5. 所有接口必须执行组织隔离；任何列表、详情、统计、导出、收藏或跨页跳转不得读取其他组织数据。

### R12：验证与文档

1. 每个 W3.4 子阶段必须有规则测试和真实数据库 Smoke，覆盖正常路径、权限拒绝、数据范围、组织隔离、状态/规则边界和事务回滚。
2. 每个页面必须完成桌面浏览器往返验收；涉及 Mobile 的既有线索/客户能力还必须保证 Mobile 回归通过。
3. W3.4 必须通过 Prisma 校验/生成、从零迁移、Seed、shared/API/Web typecheck、Lint、生产构建、专项 Smoke 和全量回归。
4. 每个阶段结束前必须更新 API、数据模型、parity、alignment log、执行计划和规格索引。
5. 发现但本阶段未实施的 Cordys 表、字段、状态、接口或页面能力必须先登记到 `docs/cordys-deferred-backlog.md`，不得只留在聊天或提交说明中。

## 5. 非目标与边界

- 不复刻 Cordys License/CE/EE 授权体系。
- 不捆绑或替代 DataEase 服务端；只实现 Cordys 仪表板管理和第三方嵌入所需的客户端/服务端适配边界。
- 不把 Agent/AI 智能工作台作为首页完成条件；当前无 License 时 Cordys 实际进入普通工作台。
- 不在 W3.4 顺带扩展图外的商机、产品、合同、订单完整复刻；但首页、客户 360 或快捷入口依赖的既有能力必须保持可运行。
- 不以现有页面“能打开”作为完成标准；只有源码、模型、API、页面、权限、日志、自动化和浏览器均通过才可标记 `VERIFIED`。

## 6. 需求确认点

本需求采用以下明确决策进入技术设计：

1. 先完成 W3.4.0 数据模型与公共底座审计，再改首页和各业务页。
2. 触及的旧数据库模型直接迁移/删除，不做兼容和双写。
3. `/dashboard` 继续代表首页；`/reports` 改为 Cordys 仪表板资源管理。
4. 仪表板实现 Cordys 管理、范围、收藏和嵌入能力，但不实现 Cordys License，也不内置 DataEase 服务端。

需求确认后，下一步编写 `design.md`，给出逐表迁移、NestJS 模块边界、API 映射、Vue 页面结构、删除清单和分阶段回滚/验证方案；在设计再次确认前不开始代码实施。
