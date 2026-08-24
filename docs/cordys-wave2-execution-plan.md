# CordysCRM Wave 2 执行计划

> 计划日期：2026-08-21。Wave 1 R1-R7 与公共底座首轮已完成；Wave 2 继续遵循“先读项目内 Cordys 源码、记录事实，再改 MicroMatrix”的执行纪律。

## 1. 当前基线

- 主导航模块配置、左侧菜单排序/启停、组织架构、角色权限和多角色数据范围已完成。
- `NavigationModulesView` 的顶部导航排序与 Header 驱动已在 W2.1 完成。
- MicroMatrix 已有可复用的审批中心、通知铃铛、导出任务中心、主题切换与账号菜单。
- 跟进计划已在 W2.2 完成，消息设置底座已在 W2.3 完成；全局搜索、国际化和 Agent 仍未纳入或未实现，不得用空壳入口伪造完成。

## 2. W2.1 顶部导航配置闭环

### Cordys 源码范围

- `frontend/packages/web/src/views/system/module/index.vue`
- `frontend/packages/web/src/layout/components/layout-header.vue`
- `frontend/packages/web/src/config/system.ts`
- `frontend/packages/web/src/store/modules/app/index.ts`
- `frontend/packages/lib-shared/api/modules/system/module.ts`
- `backend/crm/src/main/java/cn/cordys/crm/system/controller/NavigationController.java`
- `backend/crm/src/main/java/cn/cordys/crm/system/service/NavigationService.java`
- `backend/crm/src/main/java/cn/cordys/crm/system/domain/Navigation.java`
- `backend/crm/src/main/java/cn/cordys/crm/system/mapper/ExtNavigationMapper.xml`
- `backend/crm/src/main/resources/migration/1.2.1`、`1.2.3`、`1.7.1` 的导航迁移

### 已确认事实

1. 顶部导航最终包含 `search / task / event / agent / notify / about / language / help` 八项。
2. 配置页允许拖拽排序；Header 从同一配置列表按顺序渲染。
3. 后端只暴露列表与排序接口。数据表虽有 `enable`，当前源码没有开关 Controller/UI。
4. 排序要求模块设置更新权限，并记录系统模块操作日志。
5. 搜索和记录/计划入口另有各自表单设置；本阶段不因此扩大为对应业务模块迁移。

### MicroMatrix 落地范围

- 独立租户级顶部导航表、默认补种、列表和完整排序 API。
- 配置页真实拖拽、刷新保持顺序、无权限只读。
- Header 按配置顺序渲染已经存在的审批、通知、关于和帮助能力。
- 待迁移与排除入口只在配置页标明状态，不生成空壳业务页面。

### 验收门槛

- [x] 旧租户无数据时自动得到八个默认项，重复读取不产生重复记录。
- [x] 缺项、重复、未知 key 的排序载荷均被服务端拒绝。
- [x] 管理员排序后配置页与 Header 刷新顺序一致。
- [x] 非管理员无法提交排序。
- [x] 审批入口遵守 `menu:approval`，通知复用现有实时通知能力。
- [x] Prisma generate、typecheck、lint、build、规则测试、smoke 全绿。
- [x] parity、alignment log、README 和文档索引同步。

状态：`✅ COMPLETE（2026-08-21）`

### 验收结果

- 新增租户级 `top_navigation_configs`、默认补种、完整排序 API 与 `system:module:update` 权限门槛。
- 配置页使用真实拖拽列表；Header 仅渲染当前已具备的待办、通知、关于、帮助能力，待迁移/排除项不生成空壳入口。
- 自动化结果：Prisma generate、typecheck、ESLint、API/Web build 全绿；规则与公共底座单测 `14/14`；全链路 smoke `190/190`。
- 浏览器往返验证了八项顺序与状态、排序持久化及 Header 同步；恢复默认顺序后最终 Header 为 `task / notify / about / help`，最终刷新未新增控制台错误。

### 复验命令

```bash
pnpm prisma:generate
pnpm typecheck
pnpm lint
pnpm build
pnpm --filter @micromatrix/api test:rules
pnpm smoke
```

执行 smoke 前需先应用迁移、完成 seed，并启动 PostgreSQL、Redis 与 API。测试会临时调整顶部导航顺序，结束前恢复默认顺序。

## 3. W2.2 跟进计划

状态：`✅ COMPLETE（2026-08-22）`

### 已完成源码核对

- 已读取 Cordys FollowUpPlan 的 Web、Mobile、API、Controller、Service、Domain、Mapper、migration、提醒任务和转跟进记录交互。
- 已确认四种状态、新建默认值、线索/客户/商机目标表达、负责人写权限、客户协作权限、列表排序与“我的计划”语义。
- 已确认 Cordys 当前转记录采用两次前端请求，提醒查询还附带 `owner = create_user` 限制；MicroMatrix 分别采用事务式转换和支持代建计划提醒的加固设计。
- 已建立 `specs/follow-up-plan-parity/` 下的 requirements、design、tasks。

### 本阶段落地范围

- 跟进计划 Prisma 模型、迁移、共享契约和完整 API。
- CRUD、状态流转、租户/数据范围、客户协作权限、原子转跟进记录和到期提醒。
- PC 与移动端计划页面、顶部 `event` 真实入口、客户 360 跟进计划 Tab。
- 规则测试、全链路 smoke、浏览器往返和文档同步。

评论/评论计数、动态表单设计器不在本阶段范围内。

### 验收结果

- 新增 `follow_up_plans`、四态状态机、完整 CRUD、全局/指定目标/我的计划列表和租户隔离。
- 线索/客户/商机读取与写入复用现有数据范围、资源池和客户协作裁决；编辑、删除、状态和转换限制为负责人或管理员。
- 转跟进记录改为单事务抢占、建记录、刷新最近跟进时间、回写记录 ID；重复转换和已转换状态变更均返回 `409`。
- 每天 09:00 扫描当天到期计划，通知负责人；支持他人代建计划并以 `dueNotifiedAt` 去重。
- PC、Mobile、客户 360 与顶部 `event` 已接入真实页面，新增图标统一使用 `lucide-vue-next`。
- Prisma generate、typecheck、ESLint、API/Web build 全绿；规则与公共底座单测 `17/17`；全链路 smoke `199/199`。
- 浏览器验证 PC 列表/表单、Header `event`、客户 360 Tab 和 390×844 Mobile 列表/表单；修复了 Mobile 可选 Boolean prop 缺省为 false 导致全局新建按钮隐藏的问题，最终复验通过。

### 复验命令

```bash
pnpm prisma:generate
pnpm typecheck
pnpm lint
pnpm build
pnpm --filter @micromatrix/api test:rules
pnpm db:migrate
pnpm smoke
```

## 4. W2.3 消息设置底座

状态：`✅ COMPLETE（2026-08-24）`

### 已完成源码核对

- 已读取 Cordys `views/system/message` 页面、shared API/Model、`MessageTaskController`、`MessageNotificationService`、Domain/DTO/Mapper、DDL/DML、`message_task.json`、模板工具和通知发送链路。
- 已确认页面固定展示客户、线索、商机、订单、合同五组 35 个事件；默认邮件关闭、系统消息开启。
- 已确认仅 8 个报价/合同事件带范围配置，且只有 3 个 `EXPIRING` 事件带提前时间；模板由后端资源提供，页面不编辑模板。
- 公告、SMTP 与企微/钉钉/飞书是独立能力，不并入 W2.3。

### 本阶段落地范围

- 新增 shared 固定事件目录、`message_task_settings` 租户覆盖表、完整读取、单项保存、批量开关和范围配置 API。
- 新增 `system:message / system:message:update` 独立权限与操作日志；页面不再借用企业设置权限。
- `NotificationsService` 支持可选事件编码并在落库/SSE 前读取系统消息开关；跟进计划到期提醒已绑定客户/线索/商机三个 Cordys 事件。
- PC 页面使用五组合并表格、系统消息总开关、禁用邮件说明和到期配置抽屉；未接邮件发送器前不开放假开关。

### 验收结果

- Prisma generate、迁移、shared/API/Web typecheck、ESLint、API/Web build 全绿。
- 规则与公共底座单测 `21/21`；全链路 smoke `207/207`。
- 浏览器从登录页进入 `/system/messages`，验证五组 35 事件、邮件禁用说明、关闭确认与恢复、3/7 天配置保存后重开持久化并恢复 3 天默认；刷新及相邻 `/system/modules` 均无 console error/warn。

### 后续边界

- 下一步业务模块对齐时逐个把现有通知触发点绑定到准确事件；W2.3 不臆造尚未存在的触发点。
- 邮件、第三方平台发送器和公告分别独立排期；模板编辑器不属于当前 Cordys 页面能力。
