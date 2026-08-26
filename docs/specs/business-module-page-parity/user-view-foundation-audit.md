# W3.4.0 用户视图直接模型实施记录

> 实施日期：2026-08-25
>
> 对应任务：1.5
>
> 结论：用户视图已切换到 Cordys 直接模型和资源路径，任务 1.5 完成。

## 1. Cordys 源码依据

本单元先读取代码，再实施，不以截图或旧 MicroMatrix SavedView 结构反推：

- 后端公共行为：`UserViewService`、`UserView`、`UserViewCondition`、`ExtUserViewMapper.xml`、`ExtUserViewConditionMapper.xml`；
- 请求与输出：`UserViewAddRequest`、`UserViewUpdateRequest`、`UserViewListResponse`、`UserViewResponse`、`PosRequest`；
- 目标资源 Controller：`ClueUserViewController`、`PoolClueUserViewController`、`CustomerUserViewController`、`CustomerContactUserViewController`、`PoolCustomerUserViewController`；
- 前端调用：`models/view.ts`、`store/modules/view.ts`、`crm-view-select/config.ts` 以及 clue/customer shared API；
- 数据表：`sys_user_view`、`sys_user_view_condition`。

确认的 Cordys 事实：

1. 当前五类资源分别使用 `CLUE`、`CLUE_POOL`、`CUSTOMER`、`CUSTOMER_CONTACT`、`CUSTOMER_POOL`；
2. 页面调用各资源下的 `/view/add|update|delete|detail|list|fixed|enable|edit/pos`，不使用公共 `/saved-views` 路径；
3. 列表按 `pos desc` 返回，新增 pos 以 4096 递增；
4. 条件值按 `ARRAY/STRING/INT/FLOAT/BOOLEAN` 转为文本，树选择的下级节点单独写 `children_value`；
5. 所有权由组织、用户和资源类型共同限定；
6. 系统视图是前端代码和用户本地排序偏好，不写入 `sys_user_view`。

## 2. 已实施内容

- 新增 `UserViewsModule/UserViewsService`，数据库只访问 `SysUserView/SysUserViewCondition`；旧 `SavedViewsService`、Controller、DTO、Module 已删除。
- 新增五组 Cordys 资源路径，覆盖新增、编辑、删除、详情、列表、固定、启停和 `BEFORE/AFTER` 拖拽排序。
- 所有查询与写入强制使用认证上下文中的 `organizationId/userId` 和路由固化的 `resourceType`；请求组织与认证组织不一致时拒绝。
- 条件标量、数组、数值、Boolean 与 `containChildIds` 使用 Cordys 文本契约双向序列化；对象值明确拒绝，避免写成错误的 `[object Object]`。
- 线索、线索池、客户、联系人、客户公海的列表 `viewId` 已切换到 `UserViewsService.resolveFilters`。
- Web 用户视图 API 已切换到五组资源路径和 Cordys 字段名 `enable/name/type`；系统视图仍只由页面代码提供。
- 删除成员时改为按组织和用户删除 `sys_user_view`，生产代码不再访问旧 SavedView delegate。
- 接口权限沿用对应业务资源：线索/池要求 `menu:lead`，客户/公海要求 `menu:customer`，联系人额外要求 `contact:read`。

## 3. 验证证据

- 用户视图规则测试 `7/7`、全量公共规则测试 `84/84`：覆盖五种值类型、树节点序列化、三重隔离、条件替换、停用拦截、固定/删除、跨资源拒绝和拖拽排序。
- Web `vue-tsc --noEmit` 通过；变更范围 ESLint 通过。
- API 全量类型检查的中间断点从任务 1.4 的 `397/15` 降至 `382/15`，`user-views`、旧 `saved-views` 和成员删除链路均为 0 错误；其余错误属于任务 1.6～1.8 尚未切换的直接业务模型。
- 专用临时库 `w34_user_views_audit` 从空库应用全部 30 个 migration 成功。
- 真实 PostgreSQL 用户视图 Smoke 12 项通过，覆盖创建、列表、详情、资源隔离、固定、启停、筛选还原、拖拽、编辑替换和删除；验证后临时库已删除，开发库未应用 W3.4 破坏性迁移。
- 负向搜索确认生产后端不存在 `SavedViewsService`、`savedView` delegate 或 `/saved-views` Controller。

## 4. 范围边界

- 本单元只完成公共用户视图和五类目标资源调用；在该历史节点，线索、客户、联系人主表仍处于 W3.4 直接模型迁移中间态。后续 1.6～1.9 已完成并关闭该中间态。
- `optionMap` 当前仍返回空对象；基于动态字段数据源的回显选项尚未进入 UserView 输出，不得回读已删除的旧 SavedView 数据。
- 该阶段开发库尚未应用破坏性迁移；后续已在 1.8～1.9 完成开发库重建、Seed 和最终专项验收，结果见 [foundation-validation-audit.md](./foundation-validation-audit.md)。
