# Platform Foundation 设计

## 1. 模块边界

```text
Departments / Members / Roles
          │
          ├── AuthGuard + AuthUser
          ├── DataScopeService
          ├── ModuleConfigsService
          └── PersonalCenter / UserApiKey
                 │
                 ▼
             business modules
```

JWT 只保存稳定会话声明；角色、权限与数据范围由请求时加载的当前用户上下文决定。安全敏感变更通过 auth cache 主动失效和 `authVersion` 保证尽快生效。

## 2. 组织模型

`Department` 使用 tenant + parentId 形成单根树。Service 在 create/update 时执行唯一根、父节点存在、同级名称和非后代校验；remove 明确拒绝根部门。

组织同步不直接替换本地组织树。外部部门先经过 provider mapping/preview，再在明确目标节点下应用。

## 3. RBAC

`UserRole(userId, roleId)` 是成员角色关系。`AuthUser` 保存角色快照与权限并集；Guard 负责功能权限，DataScope 负责资源可见范围。

数据范围计算流程：

1. 选出拥有当前 permission 或 `*` 的角色。
2. 若无角色参与则不可见。
3. 任一 `ALL` 立即返回全部。
4. 展开 DEPT / DEPT_AND_CHILD / CUSTOM 部门集合。
5. 与 SELF/owner 规则组合成业务查询条件。

角色授权时同时校验权限码上限和该权限的数据范围上限，防止管理员以无关角色扩大可授予范围。

## 4. 模块配置

`ModuleConfig` 保存租户模块顺序与开关。Shared definitions 是当前可配置 key 的唯一产品名单；API 只返回当前 definitions 中存在的历史行。

Web 菜单生成顺序为：模块配置过滤/排序 → 当前用户权限过滤 → 路由渲染。模块配置页面只能渲染真实有配置能力的 Lead/Customer 等卡片。

退出产品的旧 key 不需要为删除数据库历史行而做 destructive 操作，只需从 definitions/DTO/图标映射退出并由 API 过滤。

## 5. 认证缓存

Redis 只缓存派生 AuthContext，PostgreSQL 是角色与成员状态真相源。成员状态、角色权限、角色成员关系、密码和影响认证上下文的资料变化必须主动失效目标用户缓存。

## 6. Personal Center

`PersonalCenterModule` 聚合当前用户资料、计划入口、导出入口和 API Key 生命周期。修改密码复用 AuthService，不复制密码校验。

`UserApiKey` 认证由全局 AuthGuard 接受 `X-Access-Key / X-Secret-Key`，验证后转换为正常 AuthUser，后续权限与 DataScope 路径与 JWT 一致。

## 7. 前端

- `/system/org`：单根部门树 + 当前部门成员。
- `/system/roles`：角色列表 + 权限/成员管理。
- `/system/modules`：主/顶部导航配置与 Lead/Customer 业务配置入口。
- 个人中心从统一用户入口进入，不为每项自助能力新增系统菜单。

## 8. 维护规则

- 不恢复 `User.roleId` 单角色模型。
- 不在业务模块复制角色/部门展开逻辑。
- 不用导航隐藏替代后端鉴权。
- 新导航 key 必须同时具备真实路由、页面、权限和业务能力后才进入 shared definitions。
