# 公共底座对齐设计

## 源码事实

- 组织架构：`views/system/org` 与 Department / OrganizationUser 后端实现定义左侧部门树、右侧成员表及组织维护规则。
- 角色权限：`views/system/role` 与 Role 后端实现定义左侧角色列表、右侧“权限 / 成员”页签、数据范围和内置角色约束。
- 模块配置：`views/system/module` 与 Module 后端实现中的 `/module/list`、`/module/switch/:id`、`/module/sort` 共同驱动主导航开关与顺序。

## 模块配置实现

- Prisma 新增 `ModuleConfig`，以 `tenantId + key` 唯一保存模块开关和排序。
- NestJS 新增 `ModuleConfigsModule`：登录用户可读；更新与排序要求 `system:module:update`。
- shared 提供统一的模块 key、默认顺序、默认开关和可配置标记，API 与 Web 使用同一份定义。
- Pinia `module-config` store 负责加载、切换、排序，并作为左侧菜单的响应式数据源。
- 菜单先按模块配置过滤/排序，再按角色权限过滤；`system` 固定开启，尚未实现的 `agent` 固定不可开启。
- 原字段配置页保留为模块卡片的“表单设置”子能力，不再冒充模块配置首页。

## 组织与角色实现

- 组织架构入口合并部门树与成员 CRUD；部门删除按 Cordys 源码语义一次校验并删除空的整棵子树。
- 角色权限入口改为角色列表 + 权限/成员页签；沿用已完成的 canonical 权限树、多角色权限并集和数据范围授权上限。

## 安全与测试

- 服务端验证模块 key、完整排序集合和不可配置模块，不能只依赖前端禁用。
- 模块关闭只影响发现入口，不绕过既有路由权限 Guard。
- 验收覆盖 API 单元/集成行为、Web typecheck/lint/build，以及浏览器中的开关与刷新顺序。
