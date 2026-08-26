# W3.4.1 首页源码与 API 证据矩阵

> 执行单元：W3.4.1 / task 2.1
>
> 事实来源：项目内 `CordysCRM/` 源码。当前项目不实现 Cordys License，因此首页固定采用普通工作台，不进入 Smart Workbench。

## 1. 路由与 License 边界

Cordys `frontend/packages/web/src/router/routes/modules/workbench.ts` 的 `/workbench` 会根据 `licenseStore.hasLicense()` 在 `smart` 与 `index` 间重定向。W3.4 已明确 License 不在复刻范围，因此 MicroMatrix `/dashboard` 对应 Cordys `workbench/index.vue` 普通工作台，不实现 `workbench/smart/index.vue`。

普通工作台自身没有首页级业务权限；内部数据概览分别按线索/商机读取权限裁剪，快捷入口按对应新增权限裁剪。

## 2. 页面组成

| 区块         | Cordys 证据                                          | 真实行为                                                                  |
| ------------ | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| 默认密码提醒 | `views/workbench/index.vue`                          | `userInfo.defaultPwd` 为真时顶部 warning；点击打开修改密码弹窗            |
| 数据概览     | `components/dataOverviewIndex.vue` + `overview.vue`  | 部门树、统计设置、刷新；TODAY/THIS_WEEK/THIS_MONTH/THIS_YEAR 四列         |
| 快捷入口     | `components/quickAccess.vue` + `config/workbench.ts` | 按新增权限过滤；本地持久化；最少 1 个、最多 5 个；点击打开真实新增表单    |
| 我的计划     | `workbench/index.vue` + `CrmFollowDetail`            | `follow-api-key="myPlan"`，只展示真实当前用户计划；“查看更多”进入个人计划 |
| 我的待办     | `workbench/index.vue` + `CrmTaskDrawer`              | 待我审批、我处理的、我发起的、抄送我的四入口；待我审批展示真实计数        |
| 消息通知     | `workbench/index.vue` + `CrmMessageList`             | 使用全局消息数据源；“查看更多”打开消息抽屉                                |

主体布局固定为左侧弹性主区 + 右侧 `400px`，容器最小宽度 `1000px`；右侧上方待办、下方消息。

## 3. 数据概览前端参数与设置

`dataOverviewIndex.vue` 维护统一统计参数：

```text
searchType: ALL | SELF | DEPARTMENT
deptIds: string[]
timeField: CREATE_TIME | EXPECTED_END_TIME
userField: CREATE_USER | OWNER
priorPeriodEnable: boolean
winOrderTimeField: EXPECTED_END_TIME | ACTUAL_END_TIME
```

默认用户配置来自 `store/modules/overview.ts`：

- `userField = OWNER`
- `timeField = CREATE_TIME`
- `priorPeriodEnable = true`
- `winOrderTimeField = EXPECTED_END_TIME`

设置按用户持久化。商机预计结束时间的显示名称会读取商机真实表单字段名称，不在首页写死业务字段别名。

## 4. 部门选择语义

`GET /home/statistic/department/tree` 返回当前用户可见部门树，前端额外插入“本人”虚拟节点。

- 无可见部门：默认 `SELF`。
- 有部门树且非管理员：根节点默认 `DEPARTMENT`，请求根节点及其全部后代 ID。
- 管理员选择根节点：使用 `ALL`。
- 选择任意子部门：使用 `DEPARTMENT`，请求当前节点及全部后代 ID。
- 选择“本人”：`SELF`，`deptIds=[]`。

Cordys 后端 `HomeStatisticService.getDepartmentTree()` 对 `ALL / DEPT_AND_CHILD / DEPT_CUSTOM` 做树裁剪；统计接口随后再按各自目标权限重新计算 DataScope，因此部门树可见不等于统计越权。

## 5. Home Statistic API

前端 `lib-shared/api/modules/home.ts` 与 `requrls/home.ts` 固定调用：

| 方法 | 路径                                   | 权限                          | 结果                    |
| ---- | -------------------------------------- | ----------------------------- | ----------------------- |
| GET  | `/home/statistic/department/tree`      | 登录用户                      | 权限裁剪部门树          |
| POST | `/home/statistic/lead`                 | `CLUE_MANAGEMENT:READ`        | 四周期新增线索数        |
| POST | `/home/statistic/opportunity`          | `OPPORTUNITY_MANAGEMENT:READ` | 四周期商机数/金额       |
| POST | `/home/statistic/opportunity/underway` | `OPPORTUNITY_MANAGEMENT:READ` | 四周期进行中商机数/金额 |
| POST | `/home/statistic/opportunity/success`  | `OPPORTUNITY_MANAGEMENT:READ` | 四周期赢单数/金额       |

MicroMatrix 对应读取权限继续使用当前已验收权限事实：`menu:lead` 与 `menu:opportunity`；不新增首页宽泛统计权限。

## 6. 统计 SQL 语义

### 6.1 线索

`ExtClueMapper.selectClueCount`：

- 始终限制当前组织。
- 排除已经存在 `transition_id` 的已转换线索。
- `userField=OWNER` 时按负责人所属部门统计，并排除 `in_shared_pool=true`。
- `userField=CREATE_USER` 时按创建人所属部门统计，不附加公海排除。
- `SELF` 最终按 `owner=currentUser`，即使当前设置选择 `CREATE_USER`。
- 时间固定使用 `create_time`。

前端存在一个重要交互限制：当线索统计维度为 `CREATE_USER` 时数字不可点击；只有 `OWNER` 维度允许进入线索列表。W3.4.1 必须保留该限制，避免统计口径与普通线索列表负责人范围产生歧义。

### 6.2 商机

`ExtOpportunityMapper.selectOpportunityCount`：

- 始终限制当前组织和负责人 DataScope。
- 普通商机可按 `CREATE_TIME` 或 `EXPECTED_END_TIME`。
- 赢单可按 `EXPECTED_END_TIME` 或 `ACTUAL_END_TIME`。
- `UNDERWAY` 使用阶段配置 `type=AFOOT`。
- `SUCCESS` 使用阶段配置 `type=END AND rate=100`。
- 同一 SQL 分别执行 `count(*)` 与 `sum(amount)`。

当前 MicroMatrix 商机阶段模型使用 `isWon/isLost` 表达结果阶段，因此 W3.4.1 映射为：`SUCCESS => isWon=true`，`UNDERWAY => isWon=false && isLost=false`；预计结束映射 `expectedCloseAt`，实际赢单结束映射 `wonAt`。

## 7. 周期与环比

Cordys `HomeStatisticSearchWrapperRequest` 以服务端本地时区计算完整自然周期：

- TODAY：当天 00:00:00 ～ 23:59:59；前周期为完整昨天。
- THIS_WEEK：周一 ～ 周日；前周期为完整上周。
- THIS_MONTH：自然月；前周期为完整上月。
- THIS_YEAR：自然年；前周期为完整上年。

环比公式：`(current - previous) * 100 / previous`；前周期为 0 时返回 `null`。`priorPeriodEnable=false` 时不查询前周期。

## 8. 首页统计跳转

`overview.vue` 的跳转不是简单打开列表：

- 写入临时 sessionStorage 状态，URL 只带临时 key 与周期/状态/时间字段参数。
- `SELF` 显式携带本人范围。
- 商机可附加 `status=AFOOT/SUCCESS`。
- 商机跳转携带统计实际使用的时间字段。
- 线索 `CREATE_USER` 维度禁止跳转。

MicroMatrix 采用共享 `HomeFilterPayload` 达到同一目标：Payload 存 `sessionStorage`，目标 URL 只携带一次性 token；目标列表读取后立即删除 token 对应状态，并把 Payload 交给后端再次校验。后端重新执行当前用户目标模块权限与 DataScope，禁止通过手工构造 session/URL 扩大范围。

## 9. 快捷入口证据

Cordys `config/workbench.ts` 定义 9 类入口：

1. 客户新增
2. 联系人新增
3. 线索新增
4. 商机新增
5. 合同新增
6. 发票新增
7. 跟进记录新增
8. 跟进计划新增
9. 订单新增

`quickAccess.vue` 先按权限过滤，再恢复当前用户本地保存的顺序；无有效保存时默认取第一个有权限入口。自定义弹窗禁止少于 1 个、超过 5 个。新增保存成功时向工作台发出 refresh，跟进计划会刷新“我的计划”。

MicroMatrix 不展示没有真实新增 API/表单的空壳入口；已具备业务新增链路的入口使用同一真实 API 和 Metadata。

## 10. W3.4.1 实施结论

- `/dashboard` Web 路由继续作为“首页”，页面内容替换成 Cordys 普通工作台。
- 新增独立 `HomeModule`，统计 API 使用 `/home/statistic/*`，不复用现有 `DashboardService` 的销售简报/漏斗/排行 Scope。
- `HomeFilterPayload` 成为首页 → 线索/商机唯一跨页统计筛选协议。
- 我的计划、审批和消息复用项目中已经存在的真实领域 API，不为首页复制第二套数据库查询。
- Smart Workbench、Cordys License 不属于本阶段目标。
