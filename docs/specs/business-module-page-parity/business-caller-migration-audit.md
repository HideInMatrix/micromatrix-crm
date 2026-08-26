# W3.4.0 业务调用方直接模型迁移审计

日期：2026-08-25
任务：1.7 迁移既有业务调用方并删除旧代码

## 1. 结论

W3.4.0 目标业务调用方已从旧 `Lead/Contact/CustomerTeamMember`、通用资源池和 `customData` 切换到 Cordys 直接模型。生产 API 源码中已不存在被删除 Prisma delegate、旧通用池 Controller 或旧资源池 DTO 引用。

Seed 仍使用旧 Customer 字段，明确留给任务 1.8 一次性重写；因此本记录只关闭任务 1.7，不声明空库启动验收完成。

## 2. 调用方迁移矩阵

| 调用链                                                 | 直接模型/服务                                                                                           | 本次结果                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 线索列表、详情、转换、导入导出、批改、跟进时间         | `Clue`、`ClueField/Blob`、`CluePoolRepository`                                                          | 主记录与动态字段同事务写入，列表/详情/筛选/导入导出不再读取 `customData`   |
| 客户列表、详情、360、合并、关系、协作、导入导出、批改  | `Customer`、`CustomerField/Blob`、`CustomerRelation`、`CustomerCollaboration`、`CustomerPoolRepository` | 组织字段统一为 `organizationId`，Owner、BigInt 时间和公海状态使用直接字段  |
| 联系人列表、详情、客户 Tab、导入导出、启停、商机联系人 | `CustomerContact`、`CustomerContactField/Blob`                                                          | nullable `customerId`、直接 Owner 和 BigInt 时间已接入；动态字段同事务写入 |
| 跟进与跟进计划                                         | `Clue`、`Customer`、`CustomerContact`                                                                   | 数据范围、池范围、目标名称和最后跟进时间均读取直接模型                     |
| 标讯转线索                                             | `Clue`、`ClueField`                                                                                     | 主记录和 `cf_source=标讯` 在同一事务创建                                   |
| 首页旧统计调用方                                       | `Clue`、`Customer`                                                                                      | 仅消除旧模型依赖；Cordys 首页页面与新统计 API 仍归 W3.4.1                  |
| 成员删除与通知收件人                                   | 直接 Owner/Collaboration/UserView 关系                                                                  | 清理与通知不再访问旧 Lead、Contact 或 CustomerTeamMember                   |
| 自动回收                                               | `CluePool*`、`CustomerPool*` 与分域 Repository                                                          | 线索池、客户公海分别查询和回收，不再访问通用规则表                         |

## 3. 删除项

- 删除旧通用池 CRUD Controller：`pool-rules.controller.ts`、`resource-pools.controller.ts`。
- 删除旧 `PoolRulesService` 和旧通用资源池 DTO。
- `ResourcePoolsService` 只保留业务编排所需的分域查询、成员校验、目标池解析、库容校验和负责人历史，不再提供旧通用池数据库 CRUD。
- 公共“移入池”请求只保留无数据库语义的 `MoveToResourcePoolDto`，放入 `common/dto`。
- `PoolRecycleService` 直接按 Clue/Customer 两个域执行，不保留旧模型分支、双写或兼容读取。

## 4. 搜索证据

下列生产源码搜索结果均为空：

```text
prisma/tx.(lead|contact|resourcePool|resourceCapacity|resourceOwnerHistory|poolRule|customerTeamMember)
旧 resource-pool.dto import
PoolRulesController
ResourcePoolsController
```

任务 1.7 删除了旧通用池 CRUD Controller。任务 1.9 全链路验收发现现有池页面仍需要“当前用户可访问池选项”，因此仅恢复 `GET /resource-pools/options` 只读兼容 facade，并将直接 `CluePool/CustomerPool` 映射为稳定 Web VO；旧 `/resource-pools` 写 CRUD、`/resource-capacities`、`/pool-rules` 仍保持删除。W3.4.2/W3.4.3 读取 Cordys 对应页面并建立分域配置 Controller/Page 后再移除该 facade。

## 5. 验证证据

- Prisma `validate`、`generate`：通过。
- API 生产构建配置 `tsconfig.build.json --noEmit`：通过。
- shared typecheck、Web vue-tsc：通过。
- 本批 API 文件 ESLint：通过。
- 公共规则测试：`95/95` 通过。
- task 1.9 最终验收另见 [W3.4.0 公共底座最终专项验收记录](./foundation-validation-audit.md)。
- API 全量 typecheck 只剩 Seed 中 6 个旧 Customer 字段错误；生产源码错误为 0，断点归任务 1.8。

## 6. 明确保留的后续项

- 任务 1.8：按直接模型重写 Seed，重建本地开发库并验证 API/Web 启动。
- W3.4.2/W3.4.3：按 Cordys 页面源码建立线索池、客户公海的直接配置 API 和页面，替换 Web 旧通用池配置调用。
- DB-021：商机、产品、报价、合同、订单和跟进计划的分域动态字段表仍未建立；这些图外模块暂由 ModuleForm Metadata adapter 维持运行，不能标记为完整复刻。
- Cordys 直接 `CustomerCollaboration` 没有旧 `role` 列；协作写入只保存源码存在的协作类型，不新增兼容字段。公海进入时间由直接模型的 `updateTime` 暂时派生，W3.4.3 页面全链路复核时再次核对输出语义。
