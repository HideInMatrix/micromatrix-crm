# 跟进计划对齐设计

## Cordys 源码事实（2026-08-22）

- 后端领域：`FollowUpPlan` 保存客户/商机/线索目标、内容、组织、负责人、联系人、计划时间、方式、状态、converted 和 commentCount。
- 状态：`PREPARED / UNDERWAY / COMPLETED / CANCELLED`；新建写入 `PREPARED`、`converted=false`、`commentCount=0`。
- 目标：类型枚举只有 `CUSTOMER / CLUE`；商机计划通过 `type=CUSTOMER + opportunityId + customerId` 表达。
- API：全局 `/follow/plan` 与线索、客户、商机详情均支持增删改查和状态更新；全局列表合并各资源的数据权限。
- 写权限：负责人或管理员可编辑、删除、变更状态；客户协作关系区分只读和可协作写。
- 列表：默认按计划时间、创建时间倒序；支持状态、关键字、数据视图和高级筛选。
- 转记录：Web 在计划完成后打开预填的跟进记录表单，保存记录成功后再回写 `converted=true`，不是单一原子接口。
- 提醒：`FollowUpPlanRemindListener` 每日查询当天计划并通知负责人；当前 Mapper 同时要求负责人等于创建人，MicroMatrix 将其视为实现限制而非业务需求。
- Web 全局 `event` 抽屉包含跟进记录和计划，计划表支持表格/时间线；移动端提供实体计划列表和工作台“我的计划”。

## 数据模型

新增 `FollowUpPlan`：

- `tenantId / targetType / targetId`：沿用 MicroMatrix `FollowUpRecord` 的多态目标模式，目标类型为 `lead / customer / opportunity`。
- `contactId / content / method / estimatedAt / ownerId / deptId / createdById / customData`：计划主体及权限快照。
- `status`：Prisma enum `FollowUpPlanStatus`，默认 `PREPARED`。
- `converted / convertedRecordId`：转换结果和幂等依据。
- `dueNotifiedAt`：同一天到期提醒的去重依据；计划时间变化时清空。
- `createdAt / updatedAt`：审计时间。

不复制 `commentCount`；评论能力留给独立阶段。

## API 与服务

Controller 根路径为 `/follow-up-plans`：

- `GET /`：全局或指定目标分页列表；支持 `status / keyword / mine / targetType / targetId`。
- `GET /:id`：详情。
- `POST /`：创建。
- `PATCH /:id`：编辑。
- `POST /:id/status`：状态流转。
- `POST /:id/convert`：原子转换为跟进记录。
- `DELETE /:id`：删除。

服务先解析目标并校验租户、资源权限与联系人归属，再写入计划。目标名称与负责人名称批量补全为 VO，避免前端自行拼接。

## 权限和数据范围

- 线索、商机使用现有 `DataScopeService` 与相应菜单/更新权限。
- 客户复用 `CustomerAccessService`，包含数据范围、公海/资源池与团队协作语义。
- 指定目标列表先校验目标可读，再查询该目标计划；全局列表按用户拥有的目标模块权限和计划负责人/部门范围合并。
- 编辑、删除、状态和转换额外要求当前用户是计划负责人；拥有 `*` 的管理员可代管。
- Controller 使用现有 `@OperationLog` 和全局拦截器记录关键写操作。

## 状态、转换与提醒

- 允许负责人在四种状态间切换，但 `COMPLETED + converted=true` 后锁定状态。
- 转换要求 `COMPLETED && !converted`；事务内创建 `FollowUpRecord`、刷新目标 `lastFollowedAt`、回写转换标志和记录 ID。
- 每日定时任务按租户本地日历范围筛选 `PREPARED / UNDERWAY` 计划，通知负责人后写 `dueNotifiedAt`。
- 与 Cordys 的明确差异：转换改为原子操作；提醒支持他人代建并显式去重。这两点提高一致性和可恢复性，不改变用户可见业务语义。

## Web 与移动端

- 新增共享 API 客户端与 PC 跟进计划页面，支持列表、状态筛选、搜索、表单、状态操作和转记录。
- 新增移动端计划页面，使用卡片、Popup/ActionSheet 等触屏交互。
- 顶部导航 `event` 变更为可用，Header 使用 `lucide-vue-next` 图标跳转 `/follow-plans`。
- 客户 360 增加目标限定的计划 Tab，复用计划面板和表单，避免第二套请求协议。

## 验证

- 规则测试覆盖权限、状态锁、转换幂等和提醒去重。
- smoke 覆盖创建、列表、更新、状态、转换、重复转换、通知和删除。
- 浏览器验证 PC/移动端、顶部入口和客户 360 的真实往返。
