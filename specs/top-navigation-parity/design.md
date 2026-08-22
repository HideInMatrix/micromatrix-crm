# 顶部导航对齐设计

## Cordys 源码事实（2026-08-21）

- 配置页：`frontend/packages/web/src/views/system/module/index.vue` 通过 `navTopConfigList` 展示顶部导航，并调用 `/navigation/sort` 完成拖拽排序。
- Header：`frontend/packages/web/src/layout/components/layout-header.vue` 读取 `appStore.getNavTopConfigList`，按配置顺序为按钮组提供 slot。
- 默认定义：`frontend/packages/web/src/config/system.ts` 定义八个 key：`search / task / agent / notify / about / language / help / event`；数据库迁移最终顺序为 `search / task / event / agent / notify / about / language / help`。
- 前端状态：`frontend/packages/web/src/store/modules/app/index.ts` 从 `/navigation/list` 读取配置，再以 key 映射本地按钮定义。
- 后端契约：`NavigationController` 仅提供 `GET /navigation/list` 与 `POST /navigation/sort`；排序要求模块设置更新权限。
- 持久化：`sys_navigation` 以组织保存 `navigation_key / enable / pos`。当前页面与 Controller 未提供启停操作，因此本阶段只实现排序；`enabled` 仅作为兼容扩展位保留。
- 排序服务：Cordys 使用拖拽项 ID、起止位置做区间移动；MicroMatrix 继续使用既有的“提交完整 key 顺序”契约，以一次事务写入所有 sort，最终行为等价且更容易校验完整性。

## MicroMatrix 数据与 API

- Prisma 新增 `TopNavigationConfig`，以 `tenantId + key` 唯一保存顶部入口状态与顺序，和主导航 `ModuleConfig` 分表，避免两类配置互相污染。
- shared 新增顶部导航 definition、key、VO 与能力状态。能力状态只描述本项目当前迁移情况，不写入数据库。
- `ModuleConfigsService` 增加 `listTopNavigation`、`reorderTopNavigation` 和缺省补种。
- Controller 增加：
  - `GET /module-configs/top-navigation`：登录即可读；
  - `POST /module-configs/top-navigation/reorder`：要求 `system:module:update`。
- 服务端要求排序载荷完整包含八个 key 且不能重复。

## Web

- `module-config` store 同时维护主导航和顶部导航配置，并提供顶部入口顺序查询。
- 模块配置页把静态顶部导航文本替换为可拖拽列表，展示“可用 / 待迁移 / 已排除”状态。
- 新增 `TopNavigationActions`，由 Header 复用：
  - `task`：进入现有审批中心并显示待审批数量；
  - `notify`：复用 `NotificationBell`；
  - `about`：展示当前产品与本阶段能力信息；
  - `help`：打开现有 Swagger/API 文档；
  - `search / event / language`：待对应平台能力迁移后接入；
  - `agent`：按项目排除策略不渲染。
- `ExportTaskButton`、主题切换和账号菜单属于 MicroMatrix 自有 Header 操作，不进入 Cordys 顶部导航排序。

## 安全与一致性

- 所有读取按 `tenantId` 隔离，排序更新使用复合唯一键并在事务内执行。
- 配置只控制入口发现和顺序，不替代路由 Guard 或后端权限。
- 前端状态标签不能改变服务端接受的 key 集合。
