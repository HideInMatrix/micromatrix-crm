# CordysCRM Wave 2 执行计划

> 计划日期：2026-08-21。Wave 1 R1-R7 与公共底座首轮已完成；Wave 2 继续遵循“先读项目内 Cordys 源码、记录事实，再改 MicroMatrix”的执行纪律。

## 1. 当前基线

- 主导航模块配置、左侧菜单排序/启停、组织架构、角色权限和多角色数据范围已完成。
- `NavigationModulesView` 已展示顶部导航名称，但尚未持久化排序，也未驱动实际 Header。
- MicroMatrix 已有可复用的审批中心、通知铃铛、导出任务中心、主题切换与账号菜单。
- 全局搜索、跟进计划、国际化和 Agent 尚未纳入或尚未实现，不得用空壳入口伪造完成。

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

W2.1 验收后启动。该阶段将完整读取 Cordys FollowUpPlan 的页面、API、Controller、Service、Domain、Mapper、提醒任务和转跟进记录语义，并同时补齐顶部 `event` 入口与客户 360 的跟进计划 Tab。具体设计在 W2.1 完成后单独建立 spec，不在本阶段预写实现结论。
