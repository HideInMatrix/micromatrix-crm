# W3.4.2 线索与线索池最终专项验收记录

> 执行单元：W3.4.2 / task 3.6
>
> 验收日期：2026-08-27
>
> 当前状态：验收通过，W3.4.2 已关闭；下一执行单元为 W3.4.3 客户、联系人和客户公海 task 4.1。

## 1. 验收基线

task 3.1～3.5 已分别完成源码证据、普通线索 API、三条转换链路、多线索池 API/规则和 PC Vue 页面。最终验收不重新解释业务语义，全部以 [线索与线索池源码/API 证据矩阵](./clue-source-api-audit.md) 为事实基线。

进入 3.6 时已有专项证据：

| 已有测试 | 已验证结果 | 继续承担的职责 |
| --- | ---: | --- |
| `smoke:w342-clue-api` | `18/18` | 普通线索 `/lead` 契约、Owner History、移池、导入导出、图表、旧 `/api/leads` 404 |
| `smoke:w342-clue-transition` | `21/21` | 三条转换差异、Follow Record/Plan、同名 selector、幂等、公海领取、真实事务回滚 |
| `smoke:w342-clue-pool` | `32/32` | 多 Pool Scope、Hidden Field、PICK/ASSIGN、批量、库容、导入导出、自动回收 |
| `smoke:w342-clue-page-browser` | `20/20` | PC 独立路由、普通/Pool Overview、转换入口、批量态、真实切池与 Pool page 单请求硬断言 |
| `smoke:w342-clue-domain` | `17/17` | 同一线索贯穿 User View、跟进、退池、领取、再退池、分配、Owner History 与导出 |
| API `test:rules` | `114/114` | DataScope、Pool Rule、User View、动态字段等公共规则底座 |

这些测试仍要在 3.6 最终代码状态再次执行，但不能代替下面两条“跨功能连续链路”。

## 2. 新增最终 API 生命周期 Smoke

新增 `smoke:w342-clue-domain`，使用独立临时租户和真实 PostgreSQL/API，至少连续验证：

```text
新增普通线索
  -> 写跟进记录 + 跟进计划
  -> 新建 User View 并用 viewId 查询
  -> 退入指定线索池
  -> Pool Scope/Hidden Field 下可见
  -> 成员领取
  -> 再次退池
  -> 管理员分配给目标成员
  -> Owner History 连续记录完整
  -> 普通/Pool 导入导出仍可执行
```

要求：

- 同一个资源贯穿普通线索、线索池、领取和分配，避免只证明互不关联的单接口可用。
- User View 必须真实创建/查询并作用到 `/lead/page`，不能只复用 `user-views.service.test.ts`。
- Hidden Field 继续以 Pool `fieldConfigs`/页面字段可用性为准，不伪造数据库字段擦除。
- 导入导出至少验证已有专项 Smoke 仍通过；生命周期脚本可复用模板/导出任务，不重复实现解析器测试。

## 3. 最终 Browser Smoke

在现有 `smoke:w342-clue-page-browser` 基础上继续补齐 3.6 浏览器验收，最终必须覆盖：

1. `/leads` 与 `/leads/pool` 独立路由、独立权限和模块导航。
2. 普通列表工具栏、批量勾选态、行操作和 Overview Drawer。
3. 普通 Overview 的转换入口能够打开真实 `LeadTransformDialog`；关联客户继续由批量入口进入。
4. Pool 页面至少两个 Pool 可实际切换，列表数据随 Pool 变化且不串池。
5. Pool Overview 只出现领取/分配/删除以及跟进记录/前负责人历史，不出现普通线索跟进计划。
6. Pool 批量勾选后显示领取、分配、批改、删除和导出选中。
7. 首次进入 Pool 与“返回普通线索后再次进入”时 `/api/pool/lead/page` 都严格为 `1` 次；切换 Pool 时一次状态变化只产生一次目标 page 请求。
8. 浏览器运行期间无未捕获 Runtime 异常。

浏览器验收继续使用项目现有 Chrome DevTools Protocol 方案，不新增 Playwright/Puppeteer 依赖。

## 4. 转换、规则和回滚复用证据

最终验收不另写一套转换实现测试，继续要求以下测试在最终提交前重新通过：

- `smoke:w342-clue-transition 21/21`：自动转换、新建客户并关联、关联已有客户三条独立路径。
- 故意制造 Contact 写入失败后，Customer 与 clue transition 均回滚。
- FollowUpRecord / FollowUpPlan、`convertedRecordId`、Contact 映射和原记录保留。
- 同名客户 selector、重复联系人/协作幂等、公海领取后关联。
- `test:rules 114/114`：Pool Rule、User View、DataScope、动态字段与其它公共规则不回归。

## 5. 静态与仓库级回归

最终必须执行：

```text
pnpm typecheck
pnpm lint
pnpm build
pnpm --filter @micromatrix/api test:rules
pnpm smoke:w342-clue-domain
pnpm smoke:w342-clue-api
pnpm smoke:w342-clue-transition
pnpm smoke:w342-clue-pool
pnpm smoke:w342-clue-page-browser
pnpm smoke:w341-home
pnpm smoke
git diff --check
```

如果 `pnpm smoke` 的历史总数因测试集合新增而变化，以实际执行结果为准，不把旧 `219/219` 写死为通过条件。

本阶段没有计划新增 Prisma 模型；仍需执行 Prisma validate/generate。如果验收过程中没有 schema/migration 改动，不为“凑验收步骤”制造空 migration。

## 6. 最终执行结果

2026-08-27 在最终代码状态完成全部验收，结果如下：

| 验收项 | 结果 |
| --- | ---: |
| `pnpm smoke:w342-clue-domain` | `17/17` |
| `pnpm smoke:w342-clue-api` | `18/18` |
| `pnpm smoke:w342-clue-transition` | `21/21` |
| `pnpm smoke:w342-clue-pool` | `32/32` |
| `pnpm smoke:w342-clue-page-browser` | `20/20` |
| `pnpm smoke:w341-home` | `17/17` |
| `pnpm smoke` | `219/219` |
| API `test:rules` | `114/114` |

静态与仓库检查同时通过：Shared/API/Web `typecheck`、全仓 ESLint、三端 production build、Prisma validate/generate 与 `git diff --check`。本阶段未修改 Prisma schema，也没有新增空 migration。

最终根 Smoke 首次执行时暴露的是历史验收脚本仍调用旧 `/api/leads`、旧 Pool 导入导出和旧批量领取语义；专项 W3.4.2 Smoke 已全部通过，因此按 3.1 固化的 Cordys 契约把根 Smoke 更新为 `/lead/*` 与 `/pool/lead/*`，并保留旧 `/api/leads` 404 断言。修正后根关键链路恢复 `219/219`，没有为通过测试恢复旧兼容 Controller。

Browser Smoke 对 `/api/pool/lead/page` 保留硬断言：首次进入、Pool A→B、B→A、返回普通线索后再次进入均为一次状态变化对应一次请求，并校验列表不串池、页面无未捕获 Runtime 异常。

## 7. 关闭结论

W3.4.2 的关闭条件均已满足：

- 新增连续生命周期 Smoke 全绿。
- 最终 Browser Smoke 全绿，并包含 `/api/pool/lead/page` 单请求硬断言。
- 3.2 / 3.3 / 3.4 / 首页专项 Smoke 全绿。
- API rules 全绿；User View 同时有规则测试与线索集成运行证据。
- 根关键链路 Smoke 全绿。
- Shared/API/Web typecheck、全仓 ESLint、三端 production build、Prisma validate/generate、`git diff --check` 全通过。
- 临时租户、Browser 夹具和独立 API/Vite/Chrome 进程全部清理。
- 最终 Git 工作区只包含 3.6 验收脚本/文档和验收暴露出的根 Smoke 契约修复；提交后要求工作区干净。

task 3.6 标记完成，W3.4.2 正式关闭；下一执行指针切到 **W3.4.3 客户、联系人和客户公海 task 4.1：固化客户域源码证据矩阵**。
