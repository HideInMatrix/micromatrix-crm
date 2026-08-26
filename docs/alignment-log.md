# 功能对齐记录

> 对照实例：本地 CordysCRM 社区版（`http://localhost:8081`，账号 `admin` / `CordysCRM`）。
> 记录原则：先写文档、再改功能。当前功能状态回写 [cordys-parity.md](./cordys-parity.md)，实施顺序以最新阶段执行计划为准。
> 原始表单快照（本机临时文件，不入库）：`/tmp/cordys-forms.json`。

## 2026-08-21：对齐顺序校正

- 每个模块先打开 Cordys 真实页面，再根据页面请求定位接口，并沿接口核对后端 Controller、Service、Domain、DTO、Mapper XML 与跨模块副作用。
- 页面专属能力归业务模块；涉及多个页面、导航或全局策略的能力归公共底座。
- 后续顺序调整为：先收口组织架构、角色权限、模块配置等基础能力，再逐个对齐线索、客户、订单等业务页面。
- 左侧菜单只呈现“实例已启用 + 当前角色可见”的能力，不再先挂全量模块或用占位项代替功能完成度。

## 2026-08-21：左侧菜单信息架构对齐

- 对齐基准更正为 Cordys 实例经模块开关和权限过滤后的实际导航，不再将全部静态路由当成左侧菜单。
- PC 左侧一级菜单与当前 Cordys 实例一致：首页、线索、客户、仪表板、自定义表单、订单、系统。
- 系统二级菜单为组织架构、角色权限、模块配置、消息设置、流程设置、企业设置、系统日志；成员管理和销售设置不再单列。
- 商机、产品、合同、标讯等页面仍保留，但遵循当前 Cordys 模块开关状态不在左侧显示。
- 线索池获得独立 `/leads/pool` URL，页内页签双向同步，但仍归属“线索”一级菜单。
- 对照表见 [cordys-menu-parity.md](./cordys-menu-parity.md)。

## 2026-08-21：R7 多角色与按权限数据范围

- 对照 `UserRole`、`PermissionCache`、`DataScopeService`、组织成员 `roleIds` 多选和角色 `memberTab`，将 `User.roleId` 完整替换为 `user_roles` 多对多关联。
- 登录与 Guard 的功能权限改为全部角色权限并集；JWT 仍只保存用户 ID，因此角色变更下一请求即时生效。
- 数据范围改为 `scopeFilter(user, permission)` / `matchesResource(..., permission)`：仅目标权限所属角色参与合并；`ALL` 胜出，否则合并 DEPT/DEPT_AND_CHILD/CUSTOM 并保留本人数据。
- 成员管理支持多个角色标签和多选表单；角色管理新增成员 Drawer、分页列表、批量关联和移除。
- 验收：Prisma migrate + seed、11 条单元测试、API/Web build/typecheck、ESLint、186 条全链路 smoke、浏览器成员多选/角色成员 Drawer/控制台无错误。

## 2026-08-24：W2.5 流程设置管理底座

- 按 Cordys 流程页面、前端 API 及 `ApprovalFlowController/Service`、Domain、Mapper 和 1.7.x 迁移建立流程主记录、不可变版本、基础节点图和实例版本引用，不以页面外观反推实现。
- `/system/approval-flows` 已替换为分页列表与新建/编辑/详情抽屉，接入 `system:process / add / update / delete` 四类权限；Vue Flow 仅开放可执行的线性开始/审批/结束图。
- 报价、合同、订单继续使用 `CREATE` 当前版本并冻结 `nodesSnapshot`；发票仅能保存停用配置，回款记录不再允许新提交，历史实例仍保留。
- DB-009 已验证；发票业务对象、编辑/删除暂存回放、高级任务和条件/抄送/字段权限/Webhook 分别保留在 DB-003、DB-010、DB-011、DB-012。
- 验收：迁移、规则与公共底座单测 `27/27`、API/Web 类型检查和构建通过，全链路 Smoke `219/219`，浏览器往返无新增 error/warn。

## 0. 探测进度

| 轮次 | 日期       | 范围                                               | 结论落点                                   |
| ---- | ---------- | -------------------------------------------------- | ------------------------------------------ |
| 1    | 2026-08-13 | 前端 bundle API 面（约 60 个模块前缀）             | gap-analysis 第三节                        |
| 2    | 2026-08-13 | 登录 + 13 个业务对象默认表单字段                   | 本文档；gap-analysis 第一/四节补字段级差距 |
| 3    | 2026-08-13 | 列表/详情 Tab/系统设置/跟进计划交互（实例 v1.8.1） | 本文档 §6；gap-analysis 第一/三/四节回写   |

---

## 1. 登录与会话（探测方法）

Cordys 管理端不是 JWT。登录流程：

1. `GET /get-key` 取 RSA 公钥（X.509 SubjectPublicKeyInfo，base64）。
2. 用户名、密码分别用 **PKCS#1 v1.5** 公钥加密后再 base64。
3. `POST /login`，body：

```json
{
  "username": "<RSA(admin)>",
  "password": "<RSA(CordysCRM)>",
  "authenticate": "LOCAL",
  "platform": "WEB"
}
```

4. 成功后会话头（后续所有请求都带）：

| Header            | 值来源                                                            |
| ----------------- | ----------------------------------------------------------------- |
| `X-AUTH-TOKEN`    | 登录返回的 `sessionId`                                            |
| `CSRF-TOKEN`      | 登录返回的 csrf                                                   |
| `Organization-Id` | `lastOrganizationId` 或 `organizationIds[0]`（本实例为 `100001`） |
| `Accept-Language` | `zh-CN`                                                           |

本实例登录用户为 Administrator。业务成功码为 `100200`（不是 HTTP 200 语义上的业务码混用）。

表单定义接口：`GET /{module}/module/form`。本轮成功拉取 13 个模块（见第 3 节）。

---

## 2. 字段类型对照（引擎层）

Cordys 默认表单实际出现的类型 → 我们 `FieldType` 的对应关系。

| Cordys type                 | 我们                              | 差距                                                                                          |
| --------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------- |
| `INPUT`                     | `text`                            | 对齐                                                                                          |
| `TEXTAREA`                  | `textarea`                        | 对齐                                                                                          |
| `INPUT_NUMBER`              | `number` / `currency` / `percent` | 我们按语义拆了三种                                                                            |
| `SELECT`                    | `select` / `radio`                | 对齐                                                                                          |
| `INPUT_MULTIPLE`            | `multiselect`（近似）             | Cordys 是可输入多值（标签），我们是预定义多选                                                 |
| `PHONE`                     | `phone`                           | 对齐                                                                                          |
| `DATE_TIME`                 | `date` / `datetime`               | 对齐                                                                                          |
| `MEMBER`                    | `member`                          | 对齐                                                                                          |
| `FORMULA`                   | `formula`                         | 我们仅四则运算；Cordys 累计金额绑子表                                                         |
| `DATA_SOURCE`               | ❌                                | 关联单条业务对象（客户/合同/商机…）。我们在页面里写死关联，未进元数据                         |
| `DATA_SOURCE_MULTIPLE`      | ❌                                | 关联多条（意向产品）。同上                                                                    |
| `SUB_PRICE` / `SUB_PRODUCT` | ❌                                | 报价/订单产品子表。我们有 `LineItemsEditor`，但是硬编码组件，不是字段类型                     |
| `SERIAL_NUMBER`             | ❌                                | 流水号字段。我们在服务层生成 `code`，表单里不可配置规则                                       |
| `LOCATION`                  | ❌                                | 省市区/地址。线索、客户、商机、订单收货都用到                                                 |
| `DIVIDER`                   | ❌                                | 表单分组标题（基本信息/负责人信息/地址信息…）                                                 |
| `showControlRules`          | ❌                                | 选项值 → 显示哪些字段。默认表单有 4 处（来源→线上详情；跟进类型→客户/线索）                   |
| `optionSource`              | 🟡                                | 本轮默认表单全是 `custom`（选项写在字段上，与我们一致）。平台另有 `dict` 模块，默认表单未引用 |

字段上还观察到：`businessKey`（映射系统列）、`rules`（含 required）、`optionSource`/`options`、`sys`（系统字段保护）。与我们 `FieldDefinition.key` + `required` + `options` 模型同构，缺的是类型与联动，不是整套元数据思路。

---

## 3. 默认表单字段对照（13 模块）

对照基准：

- **Cordys**：本轮 `GET /{module}/module/form` 的默认表单（已去掉 `DIVIDER`）。
- **我们**：`MODULE_SYSTEM_FIELDS` + Prisma 实体列。自定义字段（`cf_*` / `customData`）可补种，不视为「模块缺失」。

标记：✅ 已有（含列名不同但语义等价）· 🟡 部分 · ❌ 无 · 🌱 可用元数据补种、不必改表。

### 3.1 线索

| Cordys                                       | 我们                         | 状态                                 |
| -------------------------------------------- | ---------------------------- | ------------------------------------ |
| 公司名称 `name` *                            | `name` 线索名称              | ✅                                   |
| 线索进度 `clueProgress`（初步意向/强烈意愿） | `cf_level` 意向等级（A/B/C） | 🟡 语义近、选项集不同                |
| 线索来源 `clueSource` + 显隐规则             | `cf_source`                  | 🟡 有来源，无「选线上才显示详情」    |
| 线上来源详情 `clueOnlineSource`              | —                            | 🌱                                   |
| 客户需求 `clueDemand`                        | —                            | 🌱                                   |
| 联系人名称 `contact`                         | `contactName`                | ✅                                   |
| 联系人电话 `phone`                           | `phone`                      | ✅                                   |
| 意向产品 `products`（多选关联）              | —                            | ❌ 需关联产品；与商机产品明细同类    |
| 地区 `clueArea`（LOCATION）                  | —                            | ❌ 缺 `location` 类型；可暂用文本 🌱 |
| 负责人 `owner` *                             | `ownerId`                    | ✅                                   |
| —                                            | `email`、线索池/状态机       | 我们多出的能力                       |

### 3.2 客户

| Cordys                         | 我们                       | 状态                |
| ------------------------------ | -------------------------- | ------------------- |
| 客户名称 *                     | `name`                     | ✅                  |
| 客户行业                       | `industry`（选项集更全）   | ✅                  |
| 客户等级（重要/一般/战略）     | —                          | 🌱                  |
| 客户类型（最终客户/代理商）    | —                          | 🌱                  |
| 客户来源 + 线上来源详情 + 显隐 | —                          | 🌱（联动仍缺引擎）  |
| 客户标签 `INPUT_MULTIPLE`      | —                          | ❌ 见差距：客户标签 |
| 地区 LOCATION                  | —                          | ❌ 同线索           |
| 负责人 *                       | `ownerId`                  | ✅                  |
| —                              | 电话/邮箱/备注、公海、团队 | 我们多出的能力      |

### 3.3 联系人

| Cordys                              | 我们                                   | 状态          |
| ----------------------------------- | -------------------------------------- | ------------- |
| 客户名称 DATA_SOURCE *              | 创建时选客户（页面写死，非元数据字段） | 🟡            |
| 姓名 * / 邮箱 / 手机号 * / 负责人 * | 姓名/邮箱/电话；**无 ownerId**         | 🟡 缺负责人列 |
| —                                   | 职位 `position`                        | 我们多出      |

### 3.4 商机

| Cordys                                               | 我们                                                             | 状态                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------ |
| 商机名称 * / 客户 * / 金额 * / 结束时间 * / 负责人 * | `name` / `customerId` / `amount` / `expectedCloseAt` / `ownerId` | ✅                                         |
| 业务编码 SERIAL_NUMBER                               | —                                                                | 🟡 无独立编号；可后续走编号规则            |
| 商机来源                                             | —                                                                | 🌱                                         |
| 意向产品 多选关联                                    | —                                                                | ❌ **P0 商机产品明细**（子表比多选更完整） |
| 可能性 `possible`                                    | 阶段上的 `probability`                                           | 🟡 我们跟阶段走，无独立可改字段            |
| 联系人 DATA_SOURCE                                   | —                                                                | ❌ 缺 `contactId`                          |
| 客户标签 / 地区                                      | —                                                                | 同客户                                     |
| 备注                                                 | `remark`                                                         | ✅                                         |

### 3.5 报价

| Cordys             | 我们                                         | 状态                      |
| ------------------ | -------------------------------------------- | ------------------------- |
| 报价名称 *         | `name`                                       | ✅                        |
| 商机 DATA_SOURCE * | 表有 `opportunityId`，**系统字段模板未暴露** | 🟡                        |
| 联系人             | —                                            | ❌                        |
| 报价日期           | —                                            | 🌱 或用 `createdAt`       |
| 有效期至 *         | `validUntil`                                 | ✅                        |
| 报价产品 SUB_PRICE | `QuoteItem` + `LineItemsEditor`              | ✅ 组件硬编码，非字段类型 |
| 累计金额 FORMULA   | 服务端汇总 `totalAmount`                     | ✅                        |
| —                  | 客户 `customerId`、状态机、审批              | 我们多出                  |

### 3.6 合同

| Cordys                                           | 我们                                                 | 状态            |
| ------------------------------------------------ | ---------------------------------------------------- | --------------- |
| 合同名称 * / 客户 * / 负责人 * / 开始 * / 结束 * | 对齐（另有签约日 `signedAt`）                        | ✅              |
| 合同编号 SERIAL_NUMBER                           | 服务端 `code`                                        | 🟡 规则不可配置 |
| 合同报价信息（分组）                             | 表有 `quoteId`/`opportunityId`，表单未做成报价信息块 | 🟡              |
| 累计金额 FORMULA                                 | `amount` + `ContractItem`                            | ✅              |

### 3.7 回款计划

| Cordys                                               | 我们                                                                 | 状态     |
| ---------------------------------------------------- | -------------------------------------------------------------------- | -------- |
| 名称 * / 合同 * / 负责人 * / 计划金额 * / 计划时间 * | 金额、到期日、合同、备注；**无名称、无 ownerId**（用 `period` 期次） | 🟡       |
| —                                                    | 期次 `period`                                                        | 我们多出 |

### 3.8 回款记录

| Cordys                                         | 我们                                            | 状态               |
| ---------------------------------------------- | ----------------------------------------------- | ------------------ |
| 名称 * / 回款编码 SERIAL_NUMBER *              | —                                               | ❌                 |
| 合同 * / 回款计划 / 负责人 * / 时间 * / 金额 * | 合同、计划、时间、金额；`method` 收款方式；审批 | 🟡                 |
| 收款银行 / 收款账号（选项）                    | —                                               | 🌱 或并入 `method` |

### 3.9 工商抬头

| Cordys                                                                               | 我们                                                                | 状态                                            |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------- |
| 公司名称 / 税号 / 开户行 / 账号 / 注册地址 / 注册电话                                | `name` / `taxNo` / `bankName` / `bankAccount` / `address` / `phone` | ✅                                              |
| 注册资本 / 公司规模 / 工商注册账号 / 省 / 市 / 企业规模 / 国标行业 / 备注 / 公司编号 | —                                                                   | 🌱 多数可 customData；抬头表当前无 `customData` |

### 3.10 发票

| Cordys                                                                   | 我们                                     | 状态                                   |
| ------------------------------------------------------------------------ | ---------------------------------------- | -------------------------------------- |
| 发票名称 * / 合同 * / 客户 * / 工商抬头 * / 税号 / 发票金额 * / 负责人 * | 合同、抬头、金额、类型文本、状态、发票号 | 🟡 无独立名称/客户字段（可从合同带出） |
| 开票类型（专票/普票）                                                    | `type` 默认「增值税普通发票」            | 🟡 建议改为选项                        |
| 开票项目 / 规格 / 单位 / 数量 / 税率                                     | —                                        | ❌ 明细粒度远细于我们单行发票          |
| 合同编号 SERIAL_NUMBER / 累计金额 FORMULA                                | —                                        | 🟡 只读带出即可                        |

### 3.11 订单

| Cordys                                       | 我们                                                          | 状态              |
| -------------------------------------------- | ------------------------------------------------------------- | ----------------- |
| 订单编号 / 名称 * / 客户 * / 合同 / 负责人 * | `code` / `name` / 合同（**客户从合同带，无独立 customerId**） | 🟡                |
| 产品明细 SUB_PRODUCT                         | —                                                             | ❌ 当前看合同明细 |
| 订单金额 FORMULA                             | `amount` 手工                                                 | 🟡                |
| 收货地址 LOCATION / 收货人 / 电话            | —                                                             | ❌                |

### 3.12 跟进记录

| Cordys                                      | 我们                                         | 状态                 |
| ------------------------------------------- | -------------------------------------------- | -------------------- |
| 跟进类型（客户/线索）+ 显隐，再填客户或线索 | 多态 `targetType` + `targetId`               | 🟡 能力等价，UX 不同 |
| 商机 / 联系人                               | 目标可以是商机；**无联系人外键**             | 🟡                   |
| 跟进方式（到访/电话）                       | `type`（拜访/电话/微信/邮件/其他）           | ✅ 选项集不同        |
| 跟进时间                                    | `createdAt`（无独立 followTime）             | 🟡                   |
| 意向产品                                    | —                                            | ❌                   |
| 跟进内容 *                                  | `content`                                    | ✅                   |
| 负责人                                      | `ownerId` + `ownerName`                      | ✅                   |
| —                                           | `nextFollowAt`（下次跟进，不是独立计划对象） | 我们多出的弱替代     |

### 3.13 跟进计划（整模块缺失）

Cordys 默认表单与跟进记录几乎同构，差别是「预计开始时间 + 预计沟通内容」，且是**独立对象**（独立列表/表单）。

我们没有 `FollowUpPlan`。仅有跟进记录上的 `nextFollowAt`，不能承担：独立列表、按计划提醒、计划→完成转记录、与线索/客户显隐同一套 UX。

**结论：新增差距，建议 P1。**

---

## 4. 本轮新发现与定级建议

| 发现                                         | 建议优先级      | 说明                                               |
| -------------------------------------------- | --------------- | -------------------------------------------------- |
| 跟进计划模块                                 | **P1**          | 独立对象，销售日常会用；`nextFollowAt` 不够        |
| 默认字段包（等级/类型/来源/需求/进度选项等） | P1              | 多数可种子化进元数据，不改表                       |
| 客户标签（`INPUT_MULTIPLE`）                 | P1              | 与 gap-analysis 已列项合并；默认表单已使用         |
| 商机联系人 `contactId`、报价联系人           | P1              | 小改表；跟进记录也需要联系人                       |
| 商机/订单产品明细                            | **P0** / P2     | 商机明细维持 P0；订单明细维持 P2                   |
| 发票开票明细（项目/规格/数量/税率）          | P2              | 内部开票若只记金额可暂缓；要对齐默认表单再做       |
| 订单收货信息                                 | P2              | 与订单明细一起做                                   |
| 表单 `DIVIDER` 分组                          | P2              | 纯展示                                             |
| 字段联动 `showControlRules`                  | P2              | 跟进计划/来源详情要用；可与跟进计划同期做          |
| `LOCATION` 类型                              | P2              | 未落地前用文本自定义字段                           |
| `DATA_SOURCE` 作为元数据类型                 | P2              | 现有关联继续页面写死；引擎化后表单设计器才能配关联 |
| 抬头/回款计划缺 `customData` 或名称列        | P2              | 抬头扩展字段现在无法走元数据                       |
| 数据字典                                     | P2              | 默认表单未引用 `dict`，维持观察                    |
| 合同阶段 / 商机规则 / 价格管理               | 已在第 3 轮核实 | 见 §6.4 / §6.5                                     |

不纳入本轮：付费能力（DataEase / SQLBot / MaxKB / Agent / 许可证）仍排除。

---

## 5. 下一步探测（第 3 轮后）

1. ~~列表页 / 详情 Tab / 系统设置 / 跟进计划交互~~（已完成，见 §6）
2. 工作流（`menu.settings.workflowSetting`，与审批流并列）是否社区可用，暂不纳入实现
3. 数据字典接口本轮返回空 body，需在模块设置页再点一次核对
4. 结论已回写 gap-analysis / roadmap；第一期 P0 已落地
5. **2026-08-14**：商业标讯数据源（剑鱼/千里马）从计划中删除，不排期。标讯维持演示源 + 手动录入 + 转线索

---

## 6. 第 3 轮：列表、详情、系统设置（2026-08-13）

对照实例版本：`GET /system/version` → **v1.8.1-dd8fb18**（文档此前写 v1.7，已落后）。
本轮方法：登录后 POST 分页/设置接口 + 解析 zh-CN locale 与客户详情 chunk。

### 6.1 列表能力

列表不是「一张死表」，而是 **视图 + 范围 Tab + 高级筛选 + 批量 + 异步导出**。

| Cordys 能力                                                    | 接口/文案                                                                            | 我们                                  | 建议                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------- | --------------------------- |
| 范围 Tab：全部 / 我的 / 部门                                   | `GET /{mod}/tab` → `{all, dept}`；客户另有「协作客户」，商机另有「成交商机」         | 数据范围在查询里，UI 无这组 Tab       | P1（列表壳）                |
| **保存的视图**（系统/个人、固定视图、图表）                    | `/{mod}/view/{list,add,update,delete,enable,fixed}`；可配条件筛选 + 柱/折/饼/环/漏斗 | 只有一套动态列，无命名视图            | **P1**                      |
| 表头设置（显示列/列高/滑动或页码分页）                         | locale `crmTable.columnSetting.*`                                                    | 动态列有，缺列高与滚动分页            | P2                          |
| 高级筛选（含动态日期：今天/本周/过去7天…）                     | `POST /{mod}/page` body.search；`advanceFilter.*`                                    | 已有 AdvancedFilter，动态相对日期较弱 | P2                          |
| 批量：转移 / 入池 / 删除 / 修改 / 领取 / 分配 / 审批 / 作废    | `/{mod}/batch/*`、`pool/*/batch-*`                                                   | 无线索/客户批量                       | 已列 P1                     |
| 导入：Excel xls/xlsx；**导入新建** + **导入更新**（按唯一 ID） | `import` + `import/pre-check` + `template/download`                                  | 仅 CSV 新建                           | 已列 P1，补「导入更新」     |
| 导出：勾选 / 全部页；异步任务；个人中心「我的导出」24h         | `export-all` / `export-select` + `POST /export/center/list`                          | 同步 CSV                              | 导出中心从观察项升为 **P1** |
| 工作台 **查重**（客户名/手机号 → 客户/联系人/线索/商机）       | locale `workbench.duplicateCheck.*`                                                  | 无                                    | 维持 **P0**（入口在工作台） |
| **合并客户**                                                   | `POST /account/merge/page`；规则：主客户保留基本信息，联系人/计划/记录/商机/协作并入 | 无                                    | **P1**（查重的下游）        |
| 列表内数据分析图                                               | `/{mod}/chart` + 视图「数据分析」                                                    | 报表页独立，列表无内嵌图              | P2                          |

分页成功码 100200，body 带 `optionMap`（字段选项，含 owner 与各 SELECT 的 id/name），与表单选项同源。本实例业务数据为空（total=0），不妨碍结构核对。

### 6.2 详情 / 360 Tab

客户不是独立路由大页，而是 **概览抽屉**（`crm-overview-drawer`），可配置 Tab（`show-tab-setting`）。客户详情默认 Tab：

1. 跟进记录
2. 联系人
3. 跟进计划
4. 负责人记录（owner history）
5. 客户关系（集团 / 子公司）
6. 商机信息
7. 协作成员（只读 / 协作两种权限）
8. 合同
9. 回款计划
10. 回款记录
11. 发票
12. 订单

商机详情 Tab：跟进记录 / 跟进计划 / 联系人 / 报价。  
合同详情 Tab：合同 / 回款计划 / 回款记录 / 发票。  
线索详情：跟进记录 / 跟进计划 / 联系人（转换后关联客户）。

对应 API 均在 `/account/*`、`/lead/follow/*`、`/opportunity/follow/*`、`/opportunity/quotation/*`、`/contract/*` 下，与抽屉 Tab 一一对应。

**对我们 P0「客户 360」的验收应改成**：至少覆盖上述 12 个聚合面中的「联系人 / 商机 / 合同+回款 / 跟进记录 / 团队」；跟进计划、负责人记录、客户关系、发票、订单可随后续期补进同一详情壳。

### 6.3 跟进计划（交互已核实）

- 独立列表：`POST /follow/plan/page`（无 type 时 100400，个人中心 `POST /personal/center/follow/plan/list` 可列出）
- 线索/客户/商机下均可增删改、取消、改状态：`/{lead|account|opportunity}/follow/plan/*`
- **计划转记录**（locale `common.convertPlanToRecord` / 表单联动 `PLAN_TO_RECORD`）
- **到期提醒**：消息事件 `CUSTOMER/CLUE/BUSINESS_FOLLOW_UP_PLAN_DUE`；可配提前提醒天数（本实例默认 3 天、通知负责人）
- 个人中心 Tab「我的计划」
- 写计划与写记录是详情里两个入口（`crmFollowRecord.writePlan` / `writeRecord`）

维持 **P1**，验收补：到期 cron + 计划转记录 + 个人中心列表。

### 6.4 合同 / 订单阶段（原「待核对」→ 已核实）

与商机一样是 **可配置阶段 + 回退开关 + 高级流转**，不是我们现在的四态枚举。

**合同默认阶段**：待签署 → 已签署 → 合同变更 → 履行中 → 履行完毕 → 合同完结(END) / 作废(END)。  
接口：`GET /contract/stage/get`，含 `afootRollBack` / `endRollBack` / `circulationType`。

**订单默认阶段**：新建 → 待发货 → 部分发货 → 已发货 → 待验收 → 已完成(END) / 已作废(END)。  
接口：`GET /order/stage/get`。

高级流转可配「源状态 → 目标状态」及条件（locale `crmStatusConfigDrawer.*`）。改合同阶段还要求审批通过 + 阶段变更权限。

我们：`ContractStatus` 四态、`OrderStatus` 五态，均写死。建议 **P1**（合同阶段先做，订单可同模型复用）。

商机阶段本身已对齐（新建/需求明确/方案验证/立项汇报/商务采购/成功/失败 + 赢率 + 进行中可回退、完结默认不可回退）。

### 6.5 商机规则 / 价格表 / 公海库容（已核实）

| 能力                  | 实例形态                                                                                                                                                         | 建议                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **商机关闭规则**      | `POST /opportunity-rule/page`；按成员、归属天数、阶段自动关闭；可到期提醒                                                                                        | **P1**（与公海回收同类）                |
| **价格表**            | 独立模块；表单：名称(唯一)、状态启用/禁用、产品子表 `SUB_PRODUCT`、备注；产品页可「新建价格表」                                                                  | **P2**（多价格体系）                    |
| **库容**              | `GET /lead-capacity/get`、`/account-capacity/get` 本实例为空=不限制；可按部门/成员设上限，并可设「不计入条件」                                                   | 维持 P1                                 |
| **多公海 / 多线索池** | `lead-pool` / `account-pool` 是**命名池列表**（可多个），不是一条全局规则。领取：每日限额、前归属人 N 天后可领、新流入数据领取；回收：未跟进天数；移入原因可配置 | **P1**（我们只有每模块一条 `PoolRule`） |
| 脱敏                  | `GET /mask/config/get` 目前 `searchFields: {}`；模块设置有「脱敏设置」                                                                                           | P2                                      |
| 自定义表单            | 主导航独立模块，可设计任意表单 + 管理员/成员数据权限                                                                                                             | P2（我们只给固定业务对象做元数据）      |

### 6.6 系统设置与个人中心

**模块开关** `POST /module/list`（12 项）：home / clue / customer / business / product / dashboard / agent / contract / customForm / tender / order / setting。本实例关掉了商机、产品、合同、标讯、智能体（不影响 API 探测）。

**顶栏导航** `GET /navigation/list`：search / task / event(记录与计划) / agent / notify / about / language / help。数据表有 `enable` 字段，但当前 Controller/UI 只提供列表与排序，没有开关能力。

**个人中心**：个人信息（性别/手机/邮箱/工号/职位/员工类型/工作城市/入职日期）、**修改密码**（当前密码 + 复杂度：数字+字母、≤64）、**API Keys**（最多 5 个，可永久或自定义到期、启停、删除）、**我的计划**、**我的导出**。

**消息**：`GET /message/task/get` 按模块列出事件，渠道开关为 站内 / 邮件 / 企微 / 钉钉 / 飞书。本实例仅站内开启。到期类事件可配提前天数（回款计划即将到期、合同即将到期、报价即将到期、跟进计划到期）。消息模板配置维持 P2，但事件清单应作为我们通知 `type` 的对齐表（见下）。

已核对的通知事件（节选）：新建/转移/删除客户与线索、入池/入公海、分配、协作人、跟进计划到期、商机转移、报价审批/到期、合同归档/作废/到期、回款计划到期、订单/合同/发票审批。

**表单设计器（locale，比第 2 轮字段类型更多）**：分割线、图片、附件、地址（含国家到门牌）、行业、数据单选/多选、流水号规则、显隐规则、**表单联动**（线索转客户/商机、计划转记录、合同开票/下单等跨对象填充）、**字段联动**（自动选择/限制可选范围）、公式函数 `SUM/DAYS/CONCATENATE/TEXT/IFS/TODAY/NOW/AND`、唯一值校验。这些补进引擎 P2，不改变第 2 轮默认表单对照。

**审批（v1.8.1 社区文案已包含）**：加签、退回、抄送、会签/或签/**依次审批**、批量审批、通过后字段更新与 Webhook。我们已有会签或签与金额阈值；加签/退回/依次审批/抄送/Webhook 仍缺。

**工商抬头**：必填字段可配（`/business-title/config/get`）；支持企查查第三方回填（排除项之外的商业数据源，内部可不接）。

**排除项复核**：Agent、Dashboard(DataEase)、License、企微/钉钉/飞书扫码与消息、MaxKB、SQLBot、企查查仍不实现。工作流菜单存在，本轮未跟接口，暂不排期。

### 6.7 本轮定级变更（相对第 2 轮）

| 项                                 | 原状态     | 现建议                           |
| ---------------------------------- | ---------- | -------------------------------- |
| 合同/订单可配置阶段                | 待核对     | **P1**                           |
| 商机关闭规则                       | 待核对     | **P1**                           |
| 价格表                             | 待核对形态 | **P2**（独立价格表+产品子表）    |
| 多公海/多线索池                    | 以为单规则 | **P1**                           |
| 保存的列表视图                     | 未列       | **P1**                           |
| 客户合并                           | 未列       | **P1**                           |
| 异步导出中心                       | P2 观察    | **P1**                           |
| 查重入口                           | P0         | 维持 P0，明确在工作台            |
| 客户 360                           | P0         | 维持 P0，Tab 清单见 §6.2         |
| 跟进计划                           | P1         | 维持，补计划转记录/到期/我的计划 |
| 公式函数 / 表单联动 / 图片附件字段 | 部分 P2    | 维持 P2，函数清单已对齐 v1.8     |
| 数据字典                           | P2         | 接口空 body，维持 P2             |

---

## 7. 公共底座源码对齐（2026-08-21）

本轮改为以 `CordysCRM/` 源码为第一事实来源：从 `views/system/org`、`views/system/role`、`views/system/module` 的页面组件和 API 封装出发，继续核对 Department、OrganizationUser、Role、SystemModule 的 Controller / Service / DTO / Domain / Mapper。运行中的 Cordys 页面只用于确认当前实例开关及最终交互验收。

已完成：

- 组织架构合并为“左侧部门树 + 右侧直属成员列表”，部门与成员维护在同一入口；空部门可连同空下级部门一次删除，根部门、成员引用和角色数据范围引用仍受服务端保护。
- 角色权限改为“左侧角色列表 + 右侧权限/成员页签”，保留 canonical 权限树、多角色权限并集、数据范围合并、授权上限和内置角色保护。
- 新增租户级 `ModuleConfig`：模块启停和主导航排序持久化；左侧菜单由模块配置与角色权限共同生成；字段配置降为模块卡片下的表单设置子页面。
- 浏览器已验证当前默认菜单仍为：首页、线索、客户、仪表板、自定义表单、订单、系统；模块开启后入口立即出现，关闭后立即隐藏，控制台无 error/warn。

---

## 8. 顶部导航配置闭环（2026-08-21）

### 8.1 源码事实与范围修正

- 读取 `views/system/module/index.vue`、`layout-header.vue`、`config/system.ts`、App Store、Navigation API/Controller/Service/Domain/Mapper 与 `1.2.1 / 1.2.3 / 1.7.1` 迁移。
- 最终顺序确认是 `search / task / event / agent / notify / about / language / help`。
- Cordys 当前只实现 `GET /navigation/list` 与 `POST /navigation/sort`。因此 W2.1 只对齐排序，不凭表字段臆造启停功能。

### 8.2 MicroMatrix 落地

- 新增租户级 `top_navigation_configs`，旧租户首次读取自动幂等补种八项；完整排序拒绝缺项、重复和未知 key。
- 新增 `GET /module-configs/top-navigation` 与 `POST /module-configs/top-navigation/reorder`；写接口要求 `system:module:update` 并记录操作日志。
- 系统模块页提供真实拖拽排序和“可用/待迁移/已排除”状态。Header 复用审批待办、实时通知、关于和帮助；搜索、记录/计划、语言仍待迁移，Agent 继续排除，不创建空壳页面。

### 8.3 验证证据

- Prisma generate、shared/API/Web typecheck、ESLint、API/Web build 全绿。
- 规则与公共底座单测 `14/14`；全链路 smoke `190/190`，覆盖默认补种、管理员排序、非管理员 `403` 与刷新持久化。
- 浏览器验证配置页八项顺序/状态、服务端排序后的配置页刷新与 Header 同步；恢复默认后 Header 顺序为 `task / notify / about / help`，最终刷新未产生新的控制台错误。

---

## 9. 跟进计划源码迁移与验收（2026-08-22）

### 9.1 源码事实

- 完整读取 Cordys Web/Mobile 计划列表与详情组件、API URL、全局/线索/客户/商机 Controller、`FollowUpPlanService`、Domain/DTO/Mapper、migration 和 `FollowUpPlanRemindListener`。
- 状态确认为 `PREPARED / UNDERWAY / COMPLETED / CANCELLED`；新建默认未开始且未转记录。
- Cordys 商机计划使用 `type=CUSTOMER + opportunityId + customerId`；MicroMatrix 延续现有跟进记录的 `targetType + targetId` 多态表达。
- Cordys Web 转记录是“先建记录、再回写 converted”的两次请求；MicroMatrix 改为原子事务并保存 `convertedRecordId`。
- Cordys 提醒 Mapper 当前额外限制 `owner = create_user`；MicroMatrix 按业务语义通知所有负责人，并通过 `dueNotifiedAt` 显式去重。

### 9.2 MicroMatrix 落地

- 新增 `FollowUpPlan` Prisma 模型、迁移、shared VO/status、NestJS 模块和 `/follow-up-plans` 完整接口。
- 全局列表按三类资源权限合并，指定目标列表先校验资源；客户复用 READ_ONLY/COLLABORATION，写操作限制负责人或管理员。
- 新增 PC 表格页、Mobile 卡片页、PC/Mobile 新建编辑表单、客户 360 Tab 和顶部 `event` 的 `CalendarClock` 入口。
- 跟进评论、评论计数和动态表单设计器明确留到后续阶段，不伪造完成。

### 9.3 验证证据

- Prisma generate、shared/API/Web typecheck、ESLint、API/Web build 全绿。
- 单元测试 `17/17`，新增覆盖已转换状态锁、事务式转记录、代建计划提醒和同日去重。
- smoke `199/199`，新增 9 条断言覆盖创建、客户 360 列表、编辑、状态、转换、记录继承、重复转换、状态锁和删除。
- 浏览器验证 PC `/follow-plans`、新建表单、Header `event`、客户 360 跟进计划 Tab，以及 390×844 Mobile 列表和新建表单；最终刷新未发现本轮新增控制台错误。

---

## 10. 消息设置底座源码迁移与验收（2026-08-24）

### 10.1 源码事实

- 从 `views/system/message/index.vue`、`messageList.vue`、`expirationSettingDrawer.vue` 沿 shared API 读到 `MessageTaskController/Service`、Domain/DTO/Mapper、DDL/DML、`message_task.json`、模板与 Notice sender。
- 消息通知与公告是两个 Tab；W2.3 只迁移消息通知。目录固定为五模块 35 事件，默认系统消息开启、邮件关闭。
- 只有 8 个报价/合同事件显示范围设置，三个 `EXPIRING` 事件可配置最多 10 条提前时间。模板来自后端资源，设置页没有模板编辑器。

### 10.2 MicroMatrix 落地

- 新增 shared 事件目录、`message_task_settings`、`/message-settings` 列表/单项/批量/配置 API、`system:message` 独立权限与操作日志。
- 新增 Cordys 结构的分组表格和到期配置抽屉；邮件发送器未接入，因此列保留但明确禁用。
- `NotificationsService` 在事件型通知落库/SSE 前读取租户开关；三类跟进计划到期提醒已绑定准确事件，其余触发点随业务模块继续对齐。

### 10.3 验证证据

- Prisma generate、迁移、shared/API/Web typecheck、ESLint、API/Web build 全绿。
- 规则与公共底座单测 `21/21`；全链路 smoke `207/207`。
- 浏览器验证 `/system/messages` 五组 35 事件、邮件禁用说明、单项关闭确认与恢复、合同即将到期 3/7 天保存重开持久化并恢复默认；刷新与相邻模块配置页面无 console error/warn。

---

## 11. 业务消息触发链路源码迁移与验收（2026-08-24）

### 11.1 源码事实

- 读取 Cordys 客户/联系人/协作团队、线索/资源池、商机/报价 Service，审批完成通知、自动回收 Listener、`NoticeExpireJob` 和 `CommonNoticeSendService`，不以运行界面或菜单名称推断事件。
- 人工操作统一排除操作者；线索同次转客户并创建商机必须发送两条独立事件；报价/合同/订单审批结果按对象映射，回款审批不能冒充发票审批。
- 到期任务逐租户读取开关、`timeList`、负责人/指定成员/角色/部门负责人范围，并按精确日历日处理报价、合同和回款计划。

### 11.2 MicroMatrix 落地

- 新增统一业务消息分发与配置接收范围解析，完成接收人去重、租户/启用状态过滤、操作者排除和 best-effort 异常隔离。
- 接入当前领域模型可准确表达的 29 个事件；加 W2.3 的 3 个跟进计划事件后为 32/35。客户协作事件改为通知客户负责人，自动回收与人工移池事件分离。
- 新增每天 08:00 的统一到期执行器，替换固定 3 天回款提醒；支持报价、合同、回款计划即将到期/当天到期、3/7 天配置和有效状态/足额回款过滤。
- 未伪造 `CONTRACT_ARCHIVED`、`CONTRACT_VOID`、`INVOICE_APPROVAL`。对应领域缺口以及创建人、回款计划负责人、渠道、公告、模板资源差异均登记在 [暂缓能力与数据模型缺口台账](./cordys-deferred-backlog.md)。

### 11.3 验证证据

- 规则与公共底座单测 `27/27`；全链路 smoke `214/214`。
- Smoke 真实验证事件关闭不落库、恢复后重新发送，以及客户人工移入公海、线索人工移池/双事件转换、商机转移和合同审批结果；消息设置最终恢复默认。
- 固定时钟测试验证到期 3/7 天、当天、关闭/空配置、仅执行中合同和足额回款过滤。定时任务保持内部执行，不为测试新增 Cordys 不存在的公开 API。
- 浏览器刷新复验 `/system/messages`：五组 35 事件仍完整显示，系统消息总开关及各事件均恢复开启，邮件列保持禁用；刷新后没有新增 console error/warn。

---

## 12. 企业微信集成底座源码迁移与验收（2026-08-24）

### 12.1 源码事实

- 从 `views/system/business/index.vue`、`integrationList.vue`、`editIntegrationModal.vue` 和 shared API 继续追到 `OrganizationSettingsController`、`IntegrationConfigService`、`TokenService`、企微请求 DTO、配置 Domain/Mapper。
- Cordys 企微自建应用配置由 `corpId / agentId / appSecret / startEnable` 构成；连接测试先获取 access token，再读取应用信息，并保存配置与测试结果。
- 组织同步、扫码登录和消息发送是配置底座的下游能力，不能因为配置页存在就视为已完成。

### 12.2 MicroMatrix 落地

- 新增租户/provider 唯一的 `enterprise_integrations`，Secret 采用 AES-256-GCM 随机 IV 加密，保存密钥版本和认证标签；读取接口只返回是否已配置。
- 新增 `/enterprise-integrations/wecom` 读取、保存和测试接口，以及 `system:setting:update` 写权限和操作日志。首次 Secret 必填，已有配置可留空保留；配置管理员可通过独立受控接口加载 Secret 并用眼睛按钮查看。
- 对齐 Cordys 卡片操作：已有配置点击“测试连接”直接使用服务端保存的 Secret，不再先打开配置抽屉。
- 企业设置重组为“企业信息 / 企业集成 / 开放 API”三个页签；企微卡片显示配置、测试和 W3.2 同步边界，配置抽屉支持保存与测试。
- 组织同步、统一登录和第三方消息的数据模型缺口分别登记为 DB-013、DB-014、DB-006，W3.1 不伪造这些能力。

### 12.3 验证证据

- Prisma validate/generate/migrate、shared/API/Web typecheck、ESLint、API/Web build 全绿；规则与公共底座单测 `41/41`，全链路 smoke `225/225`。
- 单测覆盖 AES-GCM 随机 IV、篡改/错密钥拒绝、租户隔离、Secret 首次必填/留空保留/受控查看/替换、连接成功/失败持久化和 token/agent 两阶段客户端。
- 浏览器验证管理员进入企业设置、切换企业集成、打开配置抽屉、保存配置后状态变为“待验证”；重新打开抽屉会加载已保存 Secret，默认以密码显示并可用眼睛按钮查看，卡片测试无需重新填写，最终无 console error/warn。
- 浏览器使用本地已保存自建应用配置完成真实 token + agent 连接测试，结果为“企业微信连接成功”。

---

## 13. 企业微信组织同步源码迁移与验收（2026-08-24）

### 13.1 源码事实

- 从组织架构前端同步入口与 shared API 继续读取 `UserSyncController`、`ThirdDepartmentService`、`WeComDepartmentService`、`DataHandleUtils`、同步 DTO/Domain/Mapper 和数据库变更，不以 Cordys 页面外观或静态菜单反推能力。
- Cordys 以组织级开关、独立同步权限和租户级锁控制执行，从企微读取部门与成员后按外部 ID 建立关系；企微缺失的既有映射成员进入禁用，日志和通知属于公共副作用。
- Cordys 首次覆盖/删除式处理不适合当前已有关联业务数据。经确认采用“先生成不可变差异预览、显式处理冲突、再原子应用”的安全适配；本地手工成员和部门不因企微缺失而删除。

### 13.2 MicroMatrix 落地

- 新增 `system:dept:sync` 独立权限、同步配置开关和新成员默认角色；真实凭据变化递增 `credentialVersion`、关闭同步并失效待应用预览，相同 Secret 或直接测试不误关同步。
- 新增部门/成员外部映射、同步批次和差异项模型，以及同租户/provider 活动批次 partial unique index；新企微成员关闭普通密码登录，已映射成员保留原角色。
- 企微客户端新增部门/成员全量快照，最大并发 5、8 秒超时、临时错误两次退避重试、白名单解析、主部门去重、负责人平行数组配对和空/重复/缺父/循环树拒绝。
- 差异规划器按映射、根部门、同级名称、租户内邮箱/手机号匹配，生成确定性 `CREATE / UPDATE / DISABLE / UNCHANGED / CONFLICT / SKIP`；后续 Cordys 模型复查已把无邮箱改为 `NULL`，不再生成占位邮箱。
- 应用在单一 Prisma interactive transaction 和 advisory lock 内完成部门拓扑写入、成员/角色/主管更新、映射 upsert、离职禁用、日志与通知；成功批次重复应用幂等，失败整批回滚。
- 企业设置接入真实同步开关和默认角色；组织架构工具栏接入 760px 响应式五阶段抽屉、历史批次、统计、筛选、字段变化、绑定/跳过冲突和最终风险确认，不新增左侧菜单项。

### 13.3 验证证据

- Prisma validate/generate/migrate status、shared/API/Web typecheck、ESLint、API/Web build 全绿；规则与公共底座单测 `51/51`，包含部门冲突跳过时级联跳过同步子树。
- 独立 `smoke:wecom-sync` 使用本地企微夹具和隔离租户完成 23 条断言：权限 `403`、配置/测试/开启、差异名称搜索、首次新增与邮箱冲突绑定、原子应用、重复幂等、角色保留、默认角色、密码登录拒绝、部门主管、后续改名与缺失成员禁用、通知和操作日志。
- 浏览器验证企业设置连接门槛、默认角色选择和启用摘要；组织架构入口在关闭时准确禁用、开启后可进入五阶段抽屉。隔离租户中可回看首次“已绑定本地资源”的同步明细与后续更新/禁用批次，成员和部门结果与 Smoke 一致。
- 新开浏览器页面复验组织架构、同步抽屉和历史批次，没有 console error/warn。现有真实企微凭据未在浏览器验收中再次发送；外部拉取与应用由可控夹具链路验证。
- DB-013 标记为 `VERIFIED`。DB-006、DB-014、成员多部门、增量游标、自动/定时同步及钉钉/飞书 provider 保持未完成并继续进入后续阶段。

---

## 14. 企业微信统一登录与消息渠道源码迁移与验收（2026-08-24）

### 14.1 源码事实

- 读取 Cordys `views/base/login`、二维码组件、登录 shared API，以及 `SSOController/Service`、`OAuthStateService`、`OAuthUserService`、`TokenService`；登录只接受企微返回的已同步 userid，不按邮箱或姓名自动注册。
- 读取消息设置页面、`MessageTaskController`、`MessageNotificationService`、`NoticeSendService`、`CommonNoticeSendService`、`WeComNoticeSender` 和事件资源。Cordys 按事件保存企微开关并向同步 userId 发送文本消息，但不保存持久化重试明细。
- MicroMatrix 保留 Cordys 入口、门槛、身份识别和 best-effort 语义；按 W3.3 完成标准增加多租户企业标识、浏览器绑定 state、外部身份状态和可审计 outbox，不复制默认组织假设。

### 14.2 MicroMatrix 落地

- 新增 `ExternalIdentity`、`ExternalOAuthState`、`MessageDelivery` 及对应枚举/索引/唯一约束；扩展登录日志认证字段和 35 个事件的 `weComEnabled`，前进迁移已应用。
- 公共登录新增 discovery/start/callback：state 与 nonce 均为 32 字节随机值且数据库只存 SHA-256，nonce 使用 HttpOnly cookie，10 分钟 TTL 并原子一次消费；可定位租户的重放/nonce/过期失败也写登录审计。
- 回调使用 W3.2 ACTIVE 成员映射识别账号，复用现有 JWT，禁止未知/禁用/解绑身份登录。成员页支持查看、绑定、恢复和安全解绑；禁用密码登录的成员不能移除最后登录方式。
- 消息设置仅在企微已配置时展示企微列，后端 gate 强制要求连接测试和同步开启。业务通知创建逐接收人 outbox，缺映射保留 DEAD；worker 条件认领、最多 3 次退避、超时恢复、Cron 补偿，页面提供分页筛选和手工重试。
- 登录页使用官方 `@wecom/jssdk` 二维码面板并保留移动端跳转回调；企业设置显示统一登录/消息能力和企业登录 URL，未增加左侧菜单项。

### 14.3 验证证据

- Prisma validate/generate/migrate、API/Web typecheck 和生产构建通过；规则与公共底座单测 `65/65`，覆盖企微 code 解析、消息错误分类、渠道 gate、outbox 条件认领/退避及 OAuth state 一次消费/重放审计。
- 独立 `smoke:wecom-sso-message` 使用本地企微夹具和隔离租户完成 16 条断言，实际走通组织冲突绑定、登录发现、HttpOnly cookie/state、JWT、重放拒绝、身份审计、业务消息临时失败、手工重试成功及解绑/恢复。
- 浏览器验证登录页企业标识门槛、企业设置统一登录/消息摘要和 URL、消息设置企微列、投递记录抽屉、成员身份弹窗；console 无 error/warn。
- DB-006、DB-014 标记为 `VERIFIED`。钉钉/飞书 provider、企微增量/定时同步、多部门、unionid/open_userid 迁移、邮件、公告、模板和富媒体消息继续保留在台账，不因 W3.3 完成而被遗漏。

> 2026-08-25 复查说明：本节的 PC“企业标识门槛”与 W3.3 完成结论已被后续源码复查推翻，最新状态以第 15 节为准。

---

## 15. 企业微信双登录流程与 Cordys 数据模型复查（2026-08-25）

### 15.1 Cordys 源码复查

- PC 登录页点击企业微信入口后直接创建官方 `@wecom/jssdk` 登录面板，不要求普通用户输入 tenant，也不使用 `easyqrcodejs` 自绘二维码。
- 企业微信工作台内的 H5/WebView 通过 `wxwork` 环境判断进入独立网页 OAuth 链路，不能把 PC 扫码流程视为两端共用实现。

### 15.2 已完成修正

- PC 登录入口已移除“企业标识”弹窗，点击后直接挂载官方扫码组件。
- 多租户适配改为依次解析 URL `tenant`、部署变量 `WECOM_DEFAULT_TENANT_SLUG`、唯一可用企微企业；本地开发默认企业为 `demo`。多企业部署不得依赖创建时间猜测企业。
- discovery/start 的 tenant 参数改为可选；OAuth state、HttpOnly nonce、成员映射和登录审计安全边界保持不变。
- 工作台路由检测 `wxwork` 后自动进入 `snsapi_privateinfo` 网页 OAuth；PC 与工作台分别使用 `qr-wecom`/`wecom` state、独立 nonce cookie 和独立回调，交叉消费会被拒绝。
- 工作台按 Cordys 读取 `user_ticket` 并调用 `/auth/getuserdetail`，否则回退 `/user/get`；只在邮箱为空时补全邮箱，并更新手机号、Boolean 性别与独立用户扩展表头像。
- 数据库 flow 直接使用 Cordys `QR_WECOM/WECOM`，不保留 `WECOM_OAUTH2` flow 兼容值；`WECOM_OAUTH2` 仅保留为工作台登录审计来源。用户邮箱改为可空，组织同步移除 `@local.invalid` 占位邮箱。

### 15.3 当前验证状态

- 页面实测确认 PC 点击后“企业标识”元素数量为 0，直接出现“企业微信扫码登录”对话框；默认企业接口返回可用配置，start 接口 `201` 且完整生成 authorization URL、corpId、agentId、redirect URI、state 和 nonce cookie。
- 浏览器已验证工作台缺配置错误态、重试/密码回退与公共回调错误态，均无 console error/warn；真实企微 iframe 在 localhost 明确返回回调域名不匹配，部署时必须把正式回调域名加入企微信任域名。
- 新模型规则测试 `66/66`、API/Web typecheck 与 Lint 通过；旧模型下的 19 条专项 Smoke 证据不冒充新模型迁移证据。
- 当前未发布项目已按确认清空本地开发库并从零应用全部迁移，Seed 成功；规则测试 `66/66`、19 条专项 Smoke、API/Web 类型检查、Lint、生产构建和 diff 检查均通过。W3.3 与 DB-014 恢复 `VERIFIED`，W3.4 进入 `READY`。

---

## 16. 企业微信单一可见子树同步修正（2026-08-25）

- 企业微信 `/department/list` 只返回 token 对应应用可见范围内的部门。应用仅勾选一个子部门时，响应会保留该部门真实 `parentId`，但可能不返回企业全局根部门。
- Cordys `WeComDepartmentService` 按固定企业根部门 `id=1` 标记根节点，原实现默认应用可见企业根部门；MicroMatrix 先前按 `parentId=0` 校验唯一根，同样错误拒绝了单一可见子树。
- 快照规范化现将 `parentId=0` 或父节点不在响应集合内的唯一部门视为本次同步根；子树内部父子关系、循环和重复 ID 校验保持不变。
- 多个互不相连的可见子树仍拒绝应用，避免在本地单根组织中静默生成错误层级；后续若要支持多授权根，必须先明确虚拟根与映射语义。
- 新增单一可见子树与多棵可见树规则用例后，规则测试 `68/68`、shared/API/Web 类型检查、改动文件 Lint 和生产构建全部通过。
- 首轮修正使用本地已保存的真实企微配置创建预览成功：HTTP `201`、批次进入 `PREVIEW_READY`，返回新增 7、更新 1、冲突 0；部门明细确认“技术支持”（外部 ID `13`）为 `isRoot=true`。本次未应用该批次，未修改组织架构。
- 后续页面复核发现同步入口未传递左侧树选中部门，预览仍把企微可见根固定绑定本地组织根，错误显示“微矩阵科技 → 技术支持”。现已新增批次级 `targetDepartmentId`：同步抽屉默认使用左侧当前选中部门，未选择时才使用本地根；企微可见根在目标部门下新增或更新，选中目标本身不会接收企微名称、排序或上级变更。
- 使用本地已保存的真实企微配置再次预览：目标部门为“微矩阵科技”，批次进入 `PREVIEW_READY`，企微可见根“技术支持”为 `CREATE`、`localId=null`、`changes=null`，确认不会改名或重排目标部门。本次仍只生成预览，未应用同步。
- 最终回归规则测试 `70/70`，shared/API/Web 类型检查、改动文件 Lint 和生产构建全部通过；29 个迁移状态一致，批次目标部门迁移已约束为非空并应用到本地开发库。
- 浏览器复验组织架构：选择“微矩阵科技”后同步抽屉显示“同步到：微矩阵科技”，部门明细将“技术支持”标为“新增”且字段变化为 `-`；切换左侧部门后目标提示同步变化，页面明确说明选中部门本身不会被改名、移动或修改排序。若当前查看的预览属于另一目标部门，页面显示目标不一致警告、历史批次标注其目标部门并禁用“应用同步”，必须重新生成匹配当前目标的预览。

---

## 17. W3.4 技术设计确认与任务拆分（2026-08-25）

- 用户已确认 W3.4 技术设计；设计状态从待确认更新为已确认，范围继续保持首页、线索/线索池、客户/联系人/公海和仪表板逐页源码闭环。
- 新增 `business-module-page-parity/tasks.md`，按 W3.4.0～W3.4.5 拆分公共直接模型、首页、线索域、客户域、仪表板和全图验收，并逐项关联 R1～R12。
- W3.4 当前状态更新为 `TASK_REVIEW`。任务清单确认前不实施业务代码；确认后的首个执行单元是 1.1 调用方影响审计，先交付逐表差异、删除模型调用方和一次性替换顺序，再进入破坏性 Schema 修改。
- DB-016～DB-020 保持 `PLANNED`，执行入口已改为任务编号，确保暂未实施的数据模型缺口不会在后续阶段遗漏。

## 18. W3.4.0 任务 1.1 直接模型与调用方审计（2026-08-25）

- 用户已确认 W3.4 任务清单并授权开始实施；W3.4 状态从 `TASK_REVIEW` 更新为 `IN_PROGRESS`。
- 新增 `business-module-page-parity/model-impact-audit.md`，以 Cordys 最终 DDL、Domain、Mapper 和 Service 交叉核对 32 张直接表；首版 DDL 后的 ALTER 已合并，重点纠正 Dashboard `resourceUrl`、根目录 `parentId='NONE'`、联系人 `customerId` nullable、BigInt 时间和文本 Scope/Condition。
- 已列出 Lead/Contact/CustomerTeamMember/FieldDefinition/SavedView/ResourcePool/PoolRule/ResourceOwnerHistory 的 Prisma relation、至少 15 个后端直接调用 Service、Web/shared、Seed/Smoke，以及旧 Dashboard 五个统计接口和固定 `/reports` 页面入口。
- 已固化一次性替换顺序和禁止兼容路径；任务 1.1 标记完成。任务 1.2～1.3 才开始修改 Prisma 与破坏性迁移，不建立兼容视图、旧模型别名、双写或数据回填。
- DB-016～DB-020 随 W3.4.0 进入 `IN_PROGRESS`，但均未标记实现或验收完成；只有对应迁移、Service、页面与自动化全部闭环后才能进入 `VERIFIED`。
- 新发现图外 Opportunity/Product/Quote/Contract/Order/FollowUpPlan 仍共享旧 FieldDefinition/customData 的直接模型缺口，已登记 DB-021，确保删除旧字段定义时不破坏现有模块且后续完整复刻不遗漏。

---

## 19. W3.4.0 任务 1.2～1.3 直接模型与破坏性迁移（2026-08-25）

- 按已确认的 32 表审计一次性替换 Prisma Schema：新增模块表单/字段、用户视图、线索、客户/联系人、公海和仪表板直接模型，删除 Lead/Contact、旧 SavedView、FieldDefinition、通用池/规则/容量/负责人历史及 `LeadStatus`。
- 数据库列使用 Cordys snake_case 映射；目标业务表只保留 `organizationId`。关键差异 `resource_url VARCHAR(500)`、`parent_id='NONE'`、nullable 联系人客户、`BIGINT` 时间和 TEXT Scope/Condition 均已落地。
- 新增 `20260825180000_w34_cordys_direct_models` 破坏性迁移：删除 14 张旧表，创建 32 张目标表，不包含回填、兼容视图、旧字段别名或双写。
- 隔离临时库从零应用全部 30 个 migration 成功；查询确认目标表 32、旧表 0，关键类型/长度/默认值通过。主开发库尚未应用本次破坏性迁移。
- Prisma format/validate/generate 通过。类型检查的 411 个错误集中在任务 1.1 已审计的 16 个调用文件，属于 1.4～1.8 尚未迁移的明确中间断点；不得用兼容模型掩盖。
- 任务 1.2、1.3 标记完成，W3.4.0 保持 `IN_PROGRESS`；下一执行单元为 1.4 模块表单与动态字段底座。

---

## 20. W3.4.0 任务 1.4 模块表单与动态字段公共底座（2026-08-25）

- 按 Cordys `ModuleFormService/ModuleFieldService/BaseResourceFieldService/BaseField` 源码实现 `ModuleFormsModule`，不从页面或旧 FieldDefinition 反推数据结构。
- Metadata 字段定义真相已切到 `sys_module_form(_blob)` 与 `sys_module_field(_blob)`；Web 继续获得稳定 FieldVO，旧 `FieldDefinition` delegate 的 14 个编译错误全部消除。
- 新增 ResourceFieldValueService，覆盖三目标资源的必填/类型/选项/唯一校验、普通/Blob 路由、组织隔离、事务锁、批改、批量装配和参数化筛选；写操作强制接收调用方同一 TransactionClient。
- 新增 7 条规则测试，全量公共规则测试 `77/77` 通过；隔离 PostgreSQL 从零执行全部 30 个 migration 后完成 12 项动态字段 Smoke，验证唯一冲突与主动异常整笔回滚，随后删除临时库。
- shared/Web typecheck 和改动文件 ESLint 通过。API 预期编译断点从 411/16 降至 397/15；剩余错误属于目标业务模型、池、用户视图、Dashboard 与 Seed 后续任务。
- 任务 1.4 的公共服务和测试已完成，但列表/详情/导入导出调用方仍待 1.7 切换，因此 1.4 保持部分完成，不通过兼容 DTO 或双写提前勾选。下一独立单元为 1.5 用户视图直接模型。

---

## 21. W3.4.0 任务 1.5 用户视图直接模型与公共 Service（2026-08-25）

- 读取 Cordys `UserViewService`、Domain/DTO/Mapper、五类资源 Controller、前端 view store 与 API map，确认个人视图的资源路径、`resourceType`、`pos desc`、条件文本类型和系统视图边界。
- 新增 UserViewsModule/Service 与线索、线索池、客户、联系人、客户公海五组 Cordys View API；旧 SavedViews Service、DTO、Controller、Module 和数据库 delegate 已删除。
- 新增、编辑、删除、固定、启停、拖拽排序全部按认证组织、当前用户和路由 resourceType 隔离；联系人额外校验 `contact:read`，系统视图继续只由前端代码和本地偏好管理。
- 条件值按 `ARRAY/STRING/INT/FLOAT/BOOLEAN` 文本契约保存，树节点写 `children_value`；对象值直接拒绝，避免非 Cordys JSON 契约重新进入数据库。
- 线索、客户、联系人和两类池的 `viewId` 已切换到 UserViewsService；成员删除同步清理 `sys_user_view`，Web API 改用各资源 `/view/*` 路径。
- 专项规则测试 `7/7`、全量公共规则测试 `84/84`、Web typecheck 和改动文件 ESLint 通过。API 直接模型中间断点从 `397/15` 降至 `382/15`，用户视图相关为 0。
- 专用临时 PostgreSQL 从空库复放全部 30 个 migration，12 项用户视图 Smoke 通过，随后删除临时库；主开发库继续等待 W3.4.0 全部调用方迁移完成后统一重建。
- 任务 1.5 标记完成，DB-019 标记 `VERIFIED`。下一独立执行单元为 1.6 分域池、规则、容量和负责人历史 Repository。

---

## 22. W3.4.0 任务 1.6 分域池、容量与负责人历史 Repository（2026-08-25）

- 读取 Cordys Clue/Customer Pool、Capacity、Owner History、领取/分配、手工退池和自动回收源码，确认 Scope/Condition 文本、最新容量规则、Owner 周期及客户商机阶段排除语义。
- 新增 `CluePoolRepository` 与 `CustomerPoolRepository`，分别只访问自己的 Pool/Rule/Capacity/Owner/HiddenField 与主记录；池配置、容量配置、领取、分配、转移、退池、回收全部使用直接模型。
- 新增共享无状态 `PoolRuleCalculator`，覆盖每日领取、新数据、前负责人冷却和有效库容。明确保留 Cordys 源码差异：线索池管理员仍受前负责人冷却，客户公海管理员跳过该限制；两者都受库容。
- 负责人历史按 Cordys 的“已结束负责周期”表意实现：领取/分配建立当前周期，转移/退池/回收结束旧周期并写 `clue_owner/customer_owner`；自动回收 `system` 原因不进入历史原因字段。
- PostgreSQL transaction advisory lock 同时覆盖资源和目标负责人，容量配置另用组织级锁；真实库并发 Smoke 证明两个同时领取只有一个成功，等价 Scope 重复容量配置被拒绝。
- 专项测试 18 条、全量规则测试 `95/95`、新增文件 TypeScript 定向审计和 ESLint 通过。隔离空库应用 30 个 migration 后 9 项真实库 Smoke 通过，临时库已删除。
- 任务 1.6 标记完成；旧 ResourcePool/PoolRule/PoolRecycle 及业务调用方仍属于 1.7，Seed 属于 1.8，因此 API 当前仍不可启动。下一独立执行单元为 1.7。

---

## 23. W3.4.0 任务 1.7 业务调用方直接模型迁移（2026-08-25）

- 线索、客户、联系人列表/详情/筛选/批改/导入导出已接入分域 Field/Blob；主记录和动态字段使用同一事务，不再读取或写入目标域 `customData`。
- 线索转换、客户 360、协作、关系、合并、商机联系人、跟进、跟进计划、标讯转线索、通知收件人、旧首页统计与自动回收已改用 `Clue/Customer/CustomerContact` 及分域 Pool/Owner 模型。
- 删除旧通用池 CRUD Controller、PoolRulesService 和旧资源池 DTO；ResourcePoolsService 仅保留对 Clue/Customer Repository 的业务编排，不建立兼容 Controller、数据库别名或双写。
- 代码搜索确认生产 API 中被删除 Prisma delegate、旧 DTO 和旧 Controller 引用均为 0；Prisma validate/generate、API 生产构建、shared/Web typecheck、本批 ESLint、`95/95` 规则测试和 diff 检查通过。
- API 全量 typecheck 只剩 Seed 中 6 个旧 Customer 字段错误，明确归任务 1.8；Web 旧通用池配置调用将在 W3.4.2/W3.4.3 按 Cordys 直接页面 API 替换，不以临时兼容接口恢复。
- DB-016、DB-017、DB-020 更新为“调用方已完成、Seed/页面待验收”，DB-021 继续保留图外模块动态字段缺口。任务 1.4 与 1.7 标记完成，下一独立执行单元为 1.8 Seed 与空库启动验收。

---

## 24. W3.4.0 任务 1.8 Seed 实现复核与修正（2026-08-26）

- 用户实现的首版 Seed 已能创建表单、视图、池、容量、基础业务数据和仪表板，但对照任务 1.1 的直接模型审计后，确认缺少 Pool HiddenField、Clue/Customer Owner History、Customer Collaboration/Relation、Clue Conversion 以及 Contact/Clue Blob 字段样例。
- 首版专项审计仅检查基础数量和“每张表存在任意索引”，可能把关系数据缺失或关键索引缺失误判为完成；现已改为检查 23 个关键命名索引、固定 Form Key/View Type、非空 Scope/Owner、有效转化目标及全部直接关系样例。
- Seed 已补到 3 个表单、20 个字段、五类用户视图、两套分域池/规则/容量/隐藏字段、三域普通与 Blob 字段值、负责人历史、协作、关系、转化和 Cordys 默认仪表板目录语义；连续执行两次保持幂等。
- 现有开发库增强审计通过：目标表 `32/32`、旧表残留 `0/14`、关键索引 `23/23`，全部直接关系断言为 true；`95/95` 规则测试、Shared/API/Web typecheck、全仓 Lint、API/Web 生产构建、生产启动和 HTTP 200 探测均通过。
- 经用户明确授权，`localhost:5432/default` 已用最终修正版执行破坏性重建，全部 30 个 migration 从零复放成功；双次 Seed 后最终计数稳定，仪表板目录/资源/收藏均从旧库残留的 `2/2/2` 收敛为 `1/1/1`。最终增强审计和 API/Web HTTP 200 探测通过，任务 1.8 正式关闭，下一独立执行单元为 1.9。

---

## 25. 模块配置页面 Cordys 源码对齐（2026-08-26）

- 对照 `CordysCRM/frontend/packages/web/src/views/system/module/index.vue`、`components/configCard.vue` 和 zh-CN 资源，不以截图反推：页面改为 24%/76% 双栏，左侧分别承载主导航与顶部导航拖拽列表，右侧使用 80px 配置行、圆形主色图标、模块动作、分隔线与开关。
- 删除旧页面自创的说明文案、固定/关闭标签和顶部导航迁移状态标签；模块排序、顶部导航排序、权限门槛和固定模块规则继续复用既有 Store/API。
- 模块启停确认标题、正文和确认按钮已按 Cordys 分别对齐开启/关闭语义；取消不会提前修改本地开关值。
- 表单设置动作接入已存在的模块表单直接页面。Cordys 已展示但当前尚无直接 API/Page 的池、库容、原因、阶段、状态流、价格表及回款/发票类入口保持可见禁用，不连接 W3.4.0 已删除的旧通用池 Controller；完整缺口登记为 DB-022。
- 浏览器复验 `/system/modules`：双栏布局、动作状态和商机开启确认均符合源码语义，页面无 console error/warn；Web Vue 类型检查、改动文件 ESLint、生产构建和 diff 检查通过。

---

## 26. W3.4.0 task 1.9 公共底座最终专项验收（2026-08-26）

- 1.9 以完整回归而不是“编译通过”作为关闭门槛，最终收口 `/resource-pools/options` 只读直接模型 facade、Clue/Customer Owner History BigInt 序列化与成员信息、Lead/Contact 直接字段 alias、关联客户候选 Scope、动态字段 `contains` 关键词语义，以及 Opportunity/Quote/Contract 对直接 Customer `organizationId` 的遗留调用。
- 根 Smoke 删除已失效的旧通用池/库容写接口夹具，改为直接 CluePool/CustomerPool 测试数据；SavedView 回归迁移到 Cordys UserView API。最终根关键链路 `219/219` 通过。
- W3.4 专项结果：字段 12 项、UserView 12 项、Pool Repository 9 项均通过；Seed 增强审计确认 32 张目标表、14 张旧表零残留、23 个关键索引；隔离数据库从零复放全部 30 个 migration 后 Pool Repository 9 项再次通过。
- Prisma validate/generate、`97/97` 规则测试、Shared/API/Web typecheck、全仓 Lint、Shared/API/Web production build 全部通过。W3.2/W3.3 Smoke 同步到当前 `targetDepartmentId` 契约后分别 `23/23`、`19/19` 通过。
- DB-019 保持 `VERIFIED`；DB-016、DB-017、DB-018、DB-020 的数据/公共服务底座已通过 1.9，但仍等待 W3.4.2～W3.4.4 对应页面/API 闭环，因此继续 `IN_PROGRESS`。下一执行单元为 W3.4.1 首页。
