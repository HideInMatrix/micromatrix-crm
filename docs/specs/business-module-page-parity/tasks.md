# W3.4 图中业务模块逐页对齐实施任务清单

> 状态：已确认，执行中
>
> 前置条件：`requirements.md` 与 `design.md` 已确认。
>
> 执行规则：本清单确认前不实施业务代码；实施时完成一个可验收单元即更新勾选状态、验证证据和缺口台账。

## 0. 全程执行约束

- [ ] 0.1 为每个子阶段建立 Cordys 源码证据矩阵
  - 按“页面 → 前端 API → Controller → Service → Domain/DTO/Mapper → DDL”记录真实调用链。
  - 任何新增字段、接口、权限或页面操作必须能追溯到源码位置；截图只用于页面验收，不作为业务需求来源。
  - 每阶段发现但不在当前范围内的能力先登记 `docs/cordys-deferred-backlog.md`。
  - _需求：R1、R12_

- [ ] 0.2 建立分阶段验证和提交纪律
  - 每阶段依次完成规则测试、真实数据库 Smoke、类型检查、Lint、生产构建和桌面浏览器验收。
  - W3.4.0～W3.4.5 分别形成独立本地提交；不得把未通过门槛的阶段标为完成。
  - 保留用户已有无关改动，不混入阶段提交。
  - _需求：R12_

## 1. W3.4.0 公共依赖与直接数据模型

- [x] 1.1 完成现有模型与调用方影响审计
  - 列出 `Lead/Contact/CustomerTeamMember/FieldDefinition/SavedView/ResourcePool/PoolRule/ResourceOwnerHistory` 的全部 Prisma relation、Service、测试、Seed 和 Web 调用方。
  - 列出旧 Dashboard 统计模块与 `/reports` 固定报表的全部入口。
  - 输出删除清单、替换清单和不可保留的兼容路径。
  - 审计证据：[W3.4.0 直接模型与调用方影响审计](./model-impact-audit.md)。
  - _需求：R1、R2、R10_

- [x] 1.2 一次性建立 Cordys 直接 Prisma 模型
  - 新建 `SysModuleForm/Blob`、`SysModuleField/Blob`、`SysUserView/Condition`。
  - 新建 Clue、Customer、CustomerContact 对应 Field/Blob、Owner、Pool、HiddenField、Pick/Recycle Rule、Capacity 模型。
  - 新建 `CustomerCollaboration`、直接 `CustomerRelation`、`DashboardModule/Dashboard/DashboardCollection`。
  - 全部目标业务表只保留 `organizationId` 组织字段，并更新现有商机、合同、订单等关系。
  - 实施证据：[W3.4.0 直接模型与破坏性迁移审计](./schema-migration-audit.md)。
  - _需求：R1、R2、R5～R10_

- [x] 1.3 生成并审计破坏性迁移
  - 显式删除旧通用池、旧 JSON 字段、旧 SavedView、旧字段定义、旧 Lead/Contact/协作表和旧 Dashboard 统计真相。
  - 创建目标表、外键、唯一约束和查询索引；不写兼容视图、回填脚本、双写触发器或旧字段别名。
  - 校验 PostgreSQL 类型、时间、Decimal、Blob 和删除级联符合设计及 Cordys DDL。
  - 空库复放全部 30 个 migration 成功；目标表 32、旧表 0，主开发库尚未应用本次破坏性迁移。
  - 实施证据：[W3.4.0 直接模型与破坏性迁移审计](./schema-migration-audit.md)。
  - _需求：R1、R12_

- [x] 1.4 实现模块表单与动态字段底座
  - [x] 建立 `ModuleFormsModule`、Metadata 输出适配和 `ResourceFieldValueService`。
  - [x] 完成字段必填、类型、唯一性、选项、普通值/Blob 路由、批量装配和筛选编译。
  - [x] 主记录与字段值使用同一事务；列表、详情、表单、导出不再读取 `customData`。公共事务接口、真实库回滚和目标业务调用方均已验证。
  - [x] 添加普通值、Blob、唯一、批改、筛选和事务回滚规则测试。
  - 实施证据：[W3.4.0 模块表单与动态字段底座实施记录](./field-foundation-audit.md)。
  - _需求：R1、R2、R5、R7、R8_

- [x] 1.5 实现用户视图直接模型与公共 Service
  - [x] 完成新增、编辑、删除、固定、启停、拖拽排序和条件树序列化。
  - [x] 按用户、组织和 `resourceType` 隔离；系统视图保持代码事实，不写入用户视图表。
  - [x] 将现有线索、客户、联系人及两类池列表调用切换到新 Service，删除 SavedView 数据库访问。
  - 实施证据：[W3.4.0 用户视图直接模型实施记录](./user-view-foundation-audit.md)。
  - _需求：R2、R5～R9_

- [x] 1.6 拆分线索池、客户公海和负责人历史 Repository
  - [x] Clue 与 Customer 使用独立 Pool/Rule/Capacity/Owner 表与 Repository。
  - [x] 共用无状态规则计算器，不共用数据库模型；领取/分配建立当前负责人周期，转移、退池和回收结束周期并写分域历史。
  - [x] 完成每日领取上限、前负责人冷却、新数据保护、库容、排除条件和并发锁规则测试。
  - 实施证据：[W3.4.0 分域池、容量与负责人历史 Repository 实施记录](./pool-repository-foundation-audit.md)。
  - _需求：R5～R9、R11_

- [x] 1.7 迁移既有业务调用方并删除旧代码
  - 同批修改线索转换、跟进、客户 360、联系人、协作、关系、合并、商机联系人和通知调用方。
  - 删除旧 Prisma 模型、旧 Repository、旧 DTO、旧 Controller 路径和所有兼容分支。
  - 用代码搜索证明生产代码不再引用被删除模型和旧 API。
  - 实施证据：[W3.4.0 业务调用方直接模型迁移审计](./business-caller-migration-audit.md)。
  - _需求：R1、R5～R9、R11_

- [x] 1.8 重写 Seed 并执行空库迁移验收
  - [x] Seed 直接创建组织、角色、表单字段、用户视图、多线索池、多客户公海、业务样例和仪表板样例。
  - [x] 使用审计修正后的最终代码清空本地开发数据库，从零应用全部 30 个 migration 后执行最终 Seed。
  - [x] 验证 14 张旧表不存在、32 张目标表及索引存在；API/Web 生产构建、启动与 HTTP 200 探测通过。
  - 实施证据：[W3.4.0 Seed 与空库启动验收记录](./seed-empty-db-audit.md)。
  - _需求：R1、R12_

- [x] 1.9 完成 W3.4.0 公共底座专项验收并本地提交
  - [x] Prisma validate/generate、`97/97` 规则测试、W3.4 数据库 Smoke、shared/API/Web typecheck、Lint 和生产构建通过。
  - [x] 根关键链路 Smoke `219/219`、W3.2 `23/23`、W3.3 `19/19` 通过；回归中发现的直接模型契约遗漏已收口。
  - [x] DB-016～DB-020、parity、alignment log、总计划和规格索引已更新；DB-016/017/018/020 仍等待对应页面闭环，未提前标记 VERIFIED。
  - 实施证据：[W3.4.0 公共底座最终专项验收记录](./foundation-validation-audit.md)。
  - _需求：R12_

## 2. W3.4.1 首页

- [x] 2.1 固化首页源码与 API 证据矩阵
  - 读取 Cordys 工作台、数据概览、快捷入口和 Home Statistic 全调用链。
  - 明确普通工作台在当前无 License 场景下的组件、配置项、权限与跳转参数。
  - 实施证据：[W3.4.1 首页源码与 API 证据矩阵](./home-source-api-audit.md)。
  - _需求：R1、R3、R4_

- [x] 2.2 建立 Home 统计后端
  - 实现权限裁剪部门树和 TODAY/THIS_WEEK/THIS_MONTH/THIS_YEAR 周期服务。
  - 实现线索、商机、进行中商机、赢单四组接口及本人/部门/全部 Scope、统计字段和环比。
  - 每个接口分别执行目标模块权限与数据范围，不复用宽泛 Dashboard Scope。
  - _需求：R3、R11_

- [x] 2.3 对齐首页跨页筛选
  - 统一 `HomeFilterPayload`，统计点击带周期、部门、字段和状态进入真实线索/商机列表。
  - 目标页面验证并一次性消费筛选；无权限或非法字段由前后端共同拒绝。
  - _需求：R3、R11_

- [x] 2.4 重建 Cordys 普通工作台页面
  - 删除现有欢迎语、客户查重、漏斗、排行榜和自定义公告布局。
  - 实现默认密码提醒、数据概览、设置 Popover、刷新、快捷入口、我的计划、四类审批待办和消息通知。
  - 快捷入口限制为 1～5 个并按新增权限过滤，打开真实表单且保存后刷新首页。
  - _需求：R3、R4_

- [x] 2.5 完成首页专项验收并本地提交
  - 测试周期边界、环比、部门 Scope、权限拒绝、租户隔离和跳转筛选一致性。
  - 浏览器验证首页布局、设置、跳转、快捷入口、计划、审批和消息，无静态伪数据。
  - `108/108` 规则测试、W3.4.1 API/数据库 Smoke `17/17`、Browser Smoke `12/12`、根 Smoke `219/219`、W3.2 `23/23`、W3.3 `19/19` 全绿。
  - Shared/API/Web typecheck、ESLint、三端 production build、Prisma validate/migrate deploy 与 diff/格式检查通过。
  - 实施证据：[W3.4.1 首页最终专项验收记录](./home-validation-audit.md)。
  - _需求：R3、R4、R11、R12_

## 3. W3.4.2 线索与线索池

> 2026-08-27 在进入 W3.4.3 前复核发现模块设置中的“线索池设置 / 线索库容设置 / 移入线索池原因设置”仍为占位，因此曾暂停 W3.4.3 并重新打开补漏 task **3.7**。3.7 现已完成并通过专项/全量验收，W3.4.2 再次关闭。2026-08-28 客户域 task **4.1** 源码证据矩阵与 task **4.2** 客户 API/360 均已完成，当前执行指针进入 **W3.4.3 task 4.3**。线索补漏基线见 [线索模块设置补漏源码与实施审计](./clue-module-settings-audit.md)。

- [x] 3.1 固化线索与线索池源码证据矩阵
  - 完成普通线索、详情、转换、批量操作、池页面、Owner History、User View、Follow、Pool Rule 全调用链。
  - 对每个按钮记录权限、DTO、事务副作用和字段可见规则。
  - 审计记录：[W3.4.2 线索与线索池源码与 API 证据矩阵](./clue-source-api-audit.md)。
  - _需求：R1、R5、R6_

- [x] 3.2 重建普通线索 API
  - [x] 切换到 Cordys `/lead` 路径，完成表单、分页、详情、新增、编辑、`NEW/FOLLOWING/INTERESTED/SUCCESS/FAIL` 状态、删除、批量转移/批改/批删/移池、导入导出和图表。
  - [x] 普通列表强制 `inSharedPool=false`；读取、编辑、删除、转移和移池继续在后端执行目标权限与 DataScope，动态字段继续使用 `clue_field/blob` 直接模型。
  - [x] 删除旧 `LeadsController` 与旧 `lead.dto.ts`；Web/Mobile API 调用切换到 `/lead/*`，旧 `/api/leads` 已由专项 Smoke 验证返回 404。
  - [x] 普通批量转移改为单事务：容量检查、`clue_owner` 历史与 Owner/collectionTime 更新原子完成；移池维护 pool/reason/Owner History。
  - [x] 验证：普通线索 API Smoke `18/18`、W3.4.1 回归 Smoke `17/17`、shared/API/Web typecheck、本批 ESLint、API/Web production build 全通过。
  - _需求：R2、R5、R11_

- [x] 3.3 对齐三条线索转换链路
  - [x] 保持 `/lead/transform`、`/lead/transition/account`、`/lead/re-transition/account` 三条路径独立；其中新建客户并关联严格按 Cordys 不复制 Follow、不创建 Collaboration，其余两条按源码复制 Follow 并执行协作规则。
  - [x] 消除“先创建客户、失败后手工 delete”的补偿式事务；Customer/Contact/Collaboration/Opportunity/`transitionType + transitionId`/Follow 副作用改为同一 Prisma transaction，公海客户领取也可加入同一事务。
  - [x] 补齐 FollowUpPlan 复制：保留 `customData`、原记录/计划，映射新 Contact 与 `convertedRecordId`；当前模型无独立 opportunityId 列，不伪造字段。
  - [x] 对齐同名客户 selector、联系人唯一规则、重复协作幂等、无效负责人跳过、客户 follower/followTime 刷新和商机 lastFollowedAt；通知继续在事务提交后发送。
  - [x] 验证：三条转换 Smoke `21/21`、普通线索 API 回归 `18/18`、W3.4.1 首页回归 `17/17`、规则测试 `114/114`、API typecheck/production build 通过。
  - _需求：R5、R11_

- [x] 3.4 重建多线索池 API 与规则执行
  - [x] 完成 `/pool/lead` 池选项、分页、详情、领取/批量领取、分配/批量分配、批改、删除/批删、导入导出和图表；所有批量写/选中导出在后端强制同一授权池，Pool assign 不再退化为普通线索 transfer。
  - [x] 新增 `/lead-pool` 设置与 `/lead-capacity` 库容 Controller/Service；Pool + PickRule + RecycleRule + HiddenFields 使用直接模型事务写入，`quick-update` 仅池管理员可用，模块设置 CRUD 使用 `system:module:update`。
  - [x] `/pool/lead/options` 返回当前用户可访问启用池的 `editable + fieldConfigs`，按 Scope/ownerId 隔离并应用 Hidden Field；Web 线索调用迁移到分域 API，客户公海兼容分支不在本阶段改动。
  - [x] 对齐领取上限、新数据保护、前负责人冷却、库容以及 PICK/ASSIGN 差异；自动回收按 Cordys 扫描 `inSharedPool=false + transitionId=null`，不再伪限 `FOLLOWING`，并保持 Owner History、system reason、通知和重复执行幂等。
  - [x] 验证：多线索池专项 Smoke `32/32`、普通线索 API `18/18`、三条转换 `21/21`、首页 `17/17`、规则测试 `114/114`；API/Web typecheck、API/Web production build、本批 ESLint、`git diff --check` 全通过。
  - _需求：R2、R6、R11_

- [x] 3.5 重建线索与线索池 Vue 页面
  - 实施前页面矩阵固化到 `clue-source-api-audit.md` 第 28 节；PC 以 `/leads` 与 `/leads/pool` 两个固定上下文路由复刻 Cordys，不再由一个页面内部 mine/pool 状态切资源。
  - 使用公共动态表单、用户视图、详情抽屉和高级筛选；普通/池工具栏、批量操作与行操作按 Cordys 顺序和独立权限渲染。
  - 池选择器支持管理员 quick setting，Hidden Field 同时约束表格、筛选、批改和详情；普通与池 Overview Drawer 保持不同 Tab 和操作边界。
  - 不展示 Cordys 主列表不存在的额外按钮；Mobile 既有线索链路保持可用。
  - [x] 修复路由切换重复请求：`SavedViewBar` 模块初始化与父页面 route watcher 不再同时触发 `/pool/lead/page`；页面上下文 ready 后统一请求，并增加同参数 in-flight 合并与陈旧响应保护。
  - [x] Browser Smoke `13/13`：验证独立导航、普通工具栏、Overview Drawer、首次进入线索池和“切回再进入”时 `/api/pool/lead/page` 均严格为 `1` 次，页面无 Runtime 异常。
  - [x] 回归：普通线索 API `18/18`、三条转换 `21/21`、多线索池 `32/32`、首页 `17/17`、规则测试 `114/114`；Web typecheck/build、本批 ESLint 通过。
  - _需求：R2、R5、R6_

- [x] 3.6 完成线索域专项验收并本地提交
  - 实施前最终验收矩阵：[W3.4.2 线索与线索池最终专项验收记录](./clue-validation-audit.md)。
  - 新增连续生命周期 Smoke，要求同一线索贯穿新增→跟进→User View→退池→领取→再退池→分配→Owner History，并与导入导出专项证据共同闭环。
  - 扩展 Browser Smoke 到普通/池 Overview、转换入口、批量态和实际切池；`/api/pool/lead/page` 首次进入、再次进入及切池均保留单请求硬断言。
  - Smoke 覆盖新增→跟进→退池→领取→分配→三类转换、多池 Scope、隐藏字段、库容、用户视图、导入导出和事务回滚。
  - 浏览器验收普通/池页面、抽屉、转换、批量和切池；验证旧 `/api/leads` 返回 404。
  - [x] 最终结果：连续生命周期 `17/17`、普通 API `18/18`、三条转换 `21/21`、多 Pool `32/32`、Browser `20/20`、首页 `17/17`、根 Smoke `219/219`、规则测试 `114/114`。
  - [x] Shared/API/Web typecheck、全仓 ESLint、三端 production build、Prisma validate/generate、`git diff --check` 全通过；根 Smoke 已同步到 `/lead/*`、`/pool/lead/*` 当前契约，不恢复旧 `/api/leads`。
  - _需求：R5、R6、R11、R12_

- [x] 3.7 补齐模块设置中的线索池、库容与移池原因
  - [x] 3.7.0 读取 Cordys 模块设置 `configCard.vue`、`cluePoolDrawer.vue`、`addOrEditPoolDrawer.vue`、`capacitySetDrawer.vue`、Reason Drawer，以及对应 Controller/Service/DDL，形成 [源码与实施审计](./clue-module-settings-audit.md)。
  - [x] 3.7.1 建立 `sys_dict/sys_dict_config` 直接模型与 `/dict/*` 原因配置 API，并接入线索退池原因强校验和 Owner History 原因名；自动回收 `system` 只保留在当前资源，原因配置关闭时历史按 Cordys 隐藏原因。
  - [x] 3.7.2 在模块设置线索卡片内直接实现线索池设置 Drawer：列表、新增、编辑、启停、删除前 no-pick 与池内数据保护；Scope 同时支持用户、部门和角色。
  - [x] 3.7.3 实现线索库容 Drawer：新增、编辑、删除、角色/部门/成员 Scope 实际成员重叠校验，并保持 `null=不限制、0=真实零库容`。
  - [x] 3.7.4 实现移入线索池原因 Drawer：开关、最多 50 条、增删改、拖拽排序、最后一条删除保护；普通/批量退池同时接入真实原因选择。
  - [x] 3.7.5 新增模块设置 API Smoke `22/22`（含原因改名）与真实入口 Browser Smoke `17/17`；复跑连续生命周期 `17/17`、普通 API `18/18`、三条转换 `21/21`、多 Pool `32/32`、线索 Browser `20/20`、首页 `17/17`、rules `114/114`、根 Smoke `219/219` 全绿。Browser 验收额外发现并修复 Pool Drawer 异步引用数据加载完成后整表 `reset()` 覆盖用户输入的真实 race。
  - [x] 3.7.6 Shared/API/Web typecheck、全仓 ESLint、三端 production build、Prisma validate/generate、`git diff --check` 全通过；新增 migration 后本地 migration 总数为 35。最终回归同时修复 demo Seed 已存在用户未恢复默认密码的幂等缺口，使 Seed 输出与 `admin123 / demo123` 真实状态一致；回写 DB-022 / 对齐总表并恢复 W3.4.3 task 4.1 执行指针。
  - _需求：R2、R6、R11、R12_

## 4. W3.4.3 客户、联系人和客户公海

- [x] 4.1 固化客户域源码证据矩阵
  - [x] 完成客户、联系人、公海、360、协作、关系、合并、Owner History、User View、Pool Rule 全调用链。
  - [x] 明确普通客户、协作、只读协作和公海的资源访问边界。
  - [x] 锁定 `/account`、`/account/contact`、`/pool/account`、`/account-pool`、`/account-capacity` 与 `CUSTOMER_POOL_RS` 分域契约，不保留旧 `/customers`、`/contacts` 或权限别名兼容。
  - [x] 确认当前直接模型覆盖 Cordys 最终 DDL；联系人 `customerId` 应可空，公海进入时间以 `Customer.updateTime` 为准，本任务不新增 migration。
  - [x] 实施证据：[W3.4.3 客户、联系人和客户公海源码与 API 证据矩阵](./customer-source-api-audit.md)。
  - _需求：R1、R7～R9_

- [x] 4.2 重建客户 API 与客户 360
  - [x] 切换到 Cordys `/account` 路径，完成表单、分页、详情、CRUD、转移、批量、入公海、导入导出、图表以及关系/合并主入口；深层关系与合并规则继续由 task 4.4 收口。
  - [x] 360 提供 Cordys 客户详情真实使用的商机、合同、回款计划、回款记录、发票和订单列表/统计，并在 CustomerAccess 后继续叠加关联模块 DataScope。
  - [x] 普通客户列表强制排除公海客户；负责人变更把客户、联系人、Owner History 与动态字段纳入同一事务；删除同步清理动态字段、Blob、协作、关系、Owner History、跟进记录和跟进计划。
  - [x] 专项验收：`node scripts/w343-customer-api-smoke.mjs`，22 passed / 0 failed；API rules 114/114；Shared/API/Web typecheck 与受影响文件 lint 通过。
  - _需求：R2、R7、R11_

- [ ] 4.3 重建联系人 API
  - 完成独立页面和客户 360 内嵌入口、动态字段、唯一性、启停原因、批量编辑、导入导出。
  - 删除前检查商机关联；不新增 Cordys 不存在的批量删除。
  - 分别执行 Contact 数据范围和 Customer 子资源访问规则。
  - _需求：R2、R8、R11_

- [ ] 4.4 对齐客户协作、关系和合并
  - 保持 `COLLABORATION/READ_ONLY` 不同读写边界。
  - 实现集团/子公司唯一、数量、单集团、防循环约束。
  - 合并保留预览、二次确认、负责人约束和关联资源处理，并保证事务回滚。
  - _需求：R7、R11_

- [ ] 4.5 重建多客户公海 API 与规则执行
  - 完成公海选项、分页、详情、领取/分配、批量、编辑、删除、导入导出和图表。
  - 执行公海 Scope、隐藏字段、独立权限、领取限制、冷却、库容/排除、回收、通知和审计。
  - 后端限制公海 360 只能读取信息、跟进和负责人历史。
  - _需求：R2、R9、R11_

- [ ] 4.6 重建客户域 Vue 页面
  - 对齐客户、联系人、客户公海三入口及公共列表底座。
  - 对齐客户 360、联系人启停、协作、关系、合并和公海详情/批量操作。
  - Mobile 既有客户链路保持可用，页面不出现静态空壳。
  - _需求：R2、R7～R9_

- [ ] 4.7 完成客户域专项验收并本地提交
  - Smoke 覆盖客户→联系人→协作→关系→公海→领取→合并、公海越权、联系人引用拒删、租户隔离和事务回滚。
  - 浏览器验收三个入口与所有关键抽屉/弹窗/边界。
  - _需求：R7～R9、R11、R12_

## 5. W3.4.4 仪表板资源管理

- [ ] 5.1 固化仪表板源码证据矩阵
  - 完成 Cordys Dashboard 页面、API、Controller、Service、Sort Service、Domain 和 DDL 调用链。
  - 明确 DataEase 配置、token、嵌入、Scope 和错误状态边界。
  - _需求：R1、R10_

- [ ] 5.2 释放 Dashboard API 命名空间
  - 将旧首页统计 Service 迁入 Home 模块并删除旧 summary/funnel/ranking/trend/conversion 路径。
  - `/api/dashboard` 只承载 Cordys 仪表板资源，不保留旧统计兼容入口。
  - _需求：R1、R10_

- [ ] 5.3 实现 DashboardModule 与 Dashboard Service
  - 完成目录新增、改名、删除、移动、树和计数，以及资源新增、详情、编辑、改名、删除、分页和排序。
  - 防止目录循环/孤儿、自身后代移动和同级重名；事务内维护稀疏排序并按需重排。
  - 全部读写执行组织隔离、权限、Scope 和操作审计。
  - _需求：R10、R11_

- [ ] 5.4 实现收藏与安全嵌入适配
  - 完成收藏、取消收藏、我的收藏和幂等约束。
  - URL 仅允许 HTTPS；开发环境仅显式允许 localhost HTTP。
  - 实现 DataEase 配置/token 边界、origin allowlist、CSP/iframe 校验和可诊断失败状态；不实现 License 或 DataEase 服务端。
  - _需求：R10、R11_

- [ ] 5.5 替换 `/reports` Vue 页面
  - 删除固定 ECharts 报表，重建左树右内容、目录列表、资源表单、成员范围、收藏、iframe、全屏和新窗口。
  - 加载、缺配置、URL 拒绝和 provider 失败分别展示真实错误状态。
  - _需求：R10_

- [ ] 5.6 完成仪表板专项验收并本地提交
  - 测试目录防循环、重名、Scope、收藏幂等、排序、URL allowlist、组织隔离和旧接口 404。
  - Smoke 与浏览器走通目录→资源→范围→收藏→移动→嵌入→删除。
  - _需求：R10～R12_

## 6. W3.4.5 全图验收

- [ ] 6.1 对齐菜单和跨页导航
  - 验证首页、线索/池、客户/联系人/公海、仪表板的 Cordys 菜单层级与页面内导航。
  - 验证首页统计、消息、审批、计划、线索转换和客户 360 的筛选、资源 ID 与返回路径。
  - _需求：R3、R4、R5、R7、R11_

- [ ] 6.2 完成权限组合、数据范围和组织隔离矩阵
  - 覆盖管理员、主管、普通成员、协作、只读协作、多角色权限并集及无权限用户。
  - 覆盖列表、详情、统计、导出、池、公海、收藏和跨页手工请求。
  - _需求：R11、R12_

- [ ] 6.3 执行全量自动化与空库验收
  - 空库应用全部 migration、Seed、启动 API/Web，运行规则测试、专项 Smoke、全量 Smoke、typecheck、Lint 和生产构建。
  - 验证旧表不存在、旧 API 为 404、目标模型/索引/API 全部存在。
  - _需求：R1、R12_

- [ ] 6.4 执行桌面与既有 Mobile 浏览器回归
  - 逐页完成核心正常路径、拒绝路径、刷新保持、跨页返回和错误状态。
  - 验证无 console error/warn、无失败网络请求、无静态伪数据和待开发按钮。
  - _需求：R2～R12_

- [ ] 6.5 收口文档、缺口与本地提交
  - 更新 API、数据模型、parity、alignment log、总计划、规格索引和缺口台账。
  - 仅当 R1～R12 全部有证据时将 W3.4 标记 `VERIFIED`；未实现项保持明确状态和后续阶段。
  - 形成 W3.4.5 本地提交并记录各阶段提交哈希。
  - _需求：R12_

## 7. 确认后的首个执行单元

任务清单确认后只先执行 **1.1 现有模型与调用方影响审计**，交付以下文档证据后再进入破坏性 Schema 修改：

1. Cordys 目标模型/DDL 与当前 Prisma 模型逐表差异表；
2. 被删除模型的后端、前端、Seed、测试调用方清单；
3. 一次性替换顺序与编译断点清单；
4. DB-016～DB-020 新发现缺口更新。

1.1 通过审阅后进入 1.2～1.3；这样不改变已确认的“一次性直接迁移”设计，但避免在调用方未清点完整时破坏 Schema。
