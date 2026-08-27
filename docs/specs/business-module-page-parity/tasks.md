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

> 当前执行指针（2026-08-27）：**3.1 固化线索与线索池源码证据矩阵**。先按 Cordys 页面 → API 封装 → Controller → Service → Domain/Mapper/DDL 建立事实矩阵，并与当前 MicroMatrix API/Prisma/Vue 一一对照；3.1 未完成前不直接进入 3.2 API 重写，避免基于现有实现反推 Cordys 行为。

- [ ] 3.1 固化线索与线索池源码证据矩阵
  - 完成普通线索、详情、转换、批量操作、池页面、Owner History、User View、Follow、Pool Rule 全调用链。
  - 对每个按钮记录权限、DTO、事务副作用和字段可见规则。
  - _需求：R1、R5、R6_

- [ ] 3.2 重建普通线索 API
  - 切换到 Cordys `/lead` 路径，完成表单、分页、详情、新增、编辑、状态、删除、批量、导入导出、图表和移池。
  - 普通列表排除池中线索；数据范围和字段权限在后端执行。
  - 删除旧 `/api/leads` Controller 和 DTO。
  - _需求：R2、R5、R11_

- [ ] 3.3 对齐三条线索转换链路
  - 保持自动转换、新建客户并关联、关联已有客户三条路径独立。
  - 以 `transitionType + transitionId` 维护已转客户事实，并在事务内完成联系人、协作、跟进记录、跟进计划和商机副作用。
  - 按 Cordys `ClueService.batchCopyCluePlanAndRecord` 同时复制 FollowUpRecord 与 FollowUpPlan（含字段值），保留原线索侧记录/计划，不得继续沿用 R4 只复制记录的历史缺口。
  - 回归已验收的通知、计划和权限规则。
  - _需求：R5、R11_

- [ ] 3.4 重建多线索池 API 与规则执行
  - 完成池选项、池分页、详情、领取/批量领取、分配/批量分配、编辑/批改、删除/批删、导入导出和图表。
  - 执行池 Scope、隐藏字段、独立权限、领取上限、冷却、库容、回收幂等、通知与审计。
  - _需求：R2、R6、R11_

- [ ] 3.5 重建线索与线索池 Vue 页面
  - 使用公共 ResourceTable、动态表单、用户视图、详情抽屉和高级筛选。
  - 对齐页面内导航、工具栏顺序、批量状态、转换界面、池切换和池设置入口。
  - 不展示未实现按钮；Mobile 既有线索链路保持可用。
  - _需求：R2、R5、R6_

- [ ] 3.6 完成线索域专项验收并本地提交
  - Smoke 覆盖新增→跟进→退池→领取→分配→三类转换、多池 Scope、隐藏字段、库容、用户视图、导入导出和事务回滚。
  - 浏览器验收普通/池页面、抽屉、转换、批量和切池；验证旧 `/api/leads` 返回 404。
  - _需求：R5、R6、R11、R12_

## 4. W3.4.3 客户、联系人和客户公海

- [ ] 4.1 固化客户域源码证据矩阵
  - 完成客户、联系人、公海、360、协作、关系、合并、Owner History、User View、Pool Rule 全调用链。
  - 明确普通客户、协作、只读协作和公海的资源访问边界。
  - _需求：R1、R7～R9_

- [ ] 4.2 重建客户 API 与客户 360
  - 切换到 Cordys `/account` 路径，完成表单、分页、详情、CRUD、转移、批量、入公海、导入导出、图表、关系和合并。
  - 360 提供设计列出的全部真实资源，并按各模块权限和 CustomerAccess 裁剪。
  - 普通客户列表排除公海客户；关键写操作维护负责人历史、协作和关联资源。
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
