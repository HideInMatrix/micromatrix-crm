# 技术设计

## 数据模型

- 新增 `UserRole`：`id`、`tenantId`、`userId`、`roleId`、时间戳。
- 唯一约束 `(userId, roleId)`，并为 `(tenantId, roleId)` 建索引。
- `User.userRoles` 与 `Role.userRoles` 取代 `User.roleId` / `User.role` / `Role.users`。
- 迁移先把旧 `users.roleId` 写入 `user_roles`，再删除旧外键和字段。

## 认证上下文

`AuthUser` 保存角色快照：

```ts
interface AuthRole {
  id: string
  name: string
  permissions: string[]
  dataScope: DataScope
  scopeDeptIds: string[]
}
```

`AuthUser.permissions` 是角色权限并集，用于 Guard；`AuthUser.roles` 用于按权限计算范围。JWT 仍只保存用户 ID，角色变更在下一次请求即时生效。

## 数据范围算法

`scopeFilter(user, permission)` 与 `matchesResource(user, ..., permission)` 必须接收明确权限码：

1. 过滤 `permissions` 含目标码或 `*` 的角色。
2. 没有参与角色时返回不可见。
3. 任一角色 `ALL` 时为全部数据。
4. 展开所有 `CUSTOM` 与 `DEPT_AND_CHILD` 的下级部门，合并 `DEPT` 当前部门。
5. 查询条件为“本人负责人 OR 合并部门”；只有 `SELF` 时为本人负责人。

列表读取使用模块菜单/读取权限，单条修改使用对应动作权限。Dashboard 使用 `menu:dashboard`，防止其它业务角色无意扩大工作台范围。

## API

- 成员创建/更新：`roleIds: string[]`，至少一个角色。
- `GET /roles/:id/members`：角色成员分页列表。
- `POST /roles/:id/members`：`{ userIds: string[] }`，幂等批量关联。
- `DELETE /roles/:id/members/:userId`：移除单个关联。
- 复用 `system:role:update` 作为角色成员维护权限。

## 前端

- 成员表格显示角色标签，编辑表单使用可筛选多选框。
- 角色表新增“成员”操作，打开 Drawer：显示当前成员、添加未关联成员、移除成员。
- 顶部和移动端个人信息显示多个角色名称。

## 授权上限

- `*` 用户不受限制。
- 普通用户只能授予自身权限并集中的权限码。
- 针对每个被授予权限，分别计算操作者有效数据范围。
- `SELF` 总可授予；`CUSTOM` 仅允许目标展开部门为操作者有效部门子集。
- 目标 `DEPT` / `DEPT_AND_CHILD` 是相对被授权人部门的动态范围，普通用户只有在该权限有效范围为 `ALL` 时可授予，避免越权。
