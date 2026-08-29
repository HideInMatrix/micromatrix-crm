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

| 轮次 | 日期       | 范围                                               | 结论落点             |
| ---- | ---------- | -------------------------------------------------- | -------------------- |
| 1    | 2026-08-13 | 前端 bundle API 面（约 60 个模块前缀）             | 本文档早期探测记录   |
| 2    | 2026-08-13 | 登录 + 13 个业务对象默认表单字段                   | 本文档字段级探测记录 |
| 3    | 2026-08-13 | 列表/详情 Tab/系统设置/跟进计划交互（实例 v1.8.1） | 本文档 §6            |

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
| 客户标签（`INPUT_MULTIPLE`）                 | P1              | 与当期差距项合并；默认表单已使用                   |
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

## 5. 第 3 轮后的后续探测记录

1. ~~列表页 / 详情 Tab / 系统设置 / 跟进计划交互~~（已完成，见 §6）
2. 工作流（`menu.settings.workflowSetting`，与审批流并列）是否社区可用，暂不纳入实现
3. 数据字典接口本轮返回空 body，需在模块设置页再点一次核对
4. 结论已回写当期实施记录；第一期 P0 已落地
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
- 任务 1.2、1.3 标记完成，W3.4.0 当时保持 `IN_PROGRESS`；随后进入 1.4 模块表单与动态字段底座。

---

## 20. W3.4.0 任务 1.4 模块表单与动态字段公共底座（2026-08-25）

- 按 Cordys `ModuleFormService/ModuleFieldService/BaseResourceFieldService/BaseField` 源码实现 `ModuleFormsModule`，不从页面或旧 FieldDefinition 反推数据结构。
- Metadata 字段定义真相已切到 `sys_module_form(_blob)` 与 `sys_module_field(_blob)`；Web 继续获得稳定 FieldVO，旧 `FieldDefinition` delegate 的 14 个编译错误全部消除。
- 新增 ResourceFieldValueService，覆盖三目标资源的必填/类型/选项/唯一校验、普通/Blob 路由、组织隔离、事务锁、批改、批量装配和参数化筛选；写操作强制接收调用方同一 TransactionClient。
- 新增 7 条规则测试，全量公共规则测试 `77/77` 通过；隔离 PostgreSQL 从零执行全部 30 个 migration 后完成 12 项动态字段 Smoke，验证唯一冲突与主动异常整笔回滚，随后删除临时库。
- shared/Web typecheck 和改动文件 ESLint 通过。API 预期编译断点从 411/16 降至 397/15；剩余错误属于目标业务模型、池、用户视图、Dashboard 与 Seed 后续任务。
- 任务 1.4 的公共服务和测试已完成，但列表/详情/导入导出调用方当时仍待 1.7 切换，因此 1.4 保持部分完成，不通过兼容 DTO 或双写提前勾选；随后进入 1.5 用户视图直接模型。

---

## 21. W3.4.0 任务 1.5 用户视图直接模型与公共 Service（2026-08-25）

- 读取 Cordys `UserViewService`、Domain/DTO/Mapper、五类资源 Controller、前端 view store 与 API map，确认个人视图的资源路径、`resourceType`、`pos desc`、条件文本类型和系统视图边界。
- 新增 UserViewsModule/Service 与线索、线索池、客户、联系人、客户公海五组 Cordys View API；旧 SavedViews Service、DTO、Controller、Module 和数据库 delegate 已删除。
- 新增、编辑、删除、固定、启停、拖拽排序全部按认证组织、当前用户和路由 resourceType 隔离；联系人额外校验 `contact:read`，系统视图继续只由前端代码和本地偏好管理。
- 条件值按 `ARRAY/STRING/INT/FLOAT/BOOLEAN` 文本契约保存，树节点写 `children_value`；对象值直接拒绝，避免非 Cordys JSON 契约重新进入数据库。
- 线索、客户、联系人和两类池的 `viewId` 已切换到 UserViewsService；成员删除同步清理 `sys_user_view`，Web API 改用各资源 `/view/*` 路径。
- 专项规则测试 `7/7`、全量公共规则测试 `84/84`、Web typecheck 和改动文件 ESLint 通过。API 直接模型中间断点从 `397/15` 降至 `382/15`，用户视图相关为 0。
- 专用临时 PostgreSQL 从空库复放全部 30 个 migration，12 项用户视图 Smoke 通过，随后删除临时库；主开发库继续等待 W3.4.0 全部调用方迁移完成后统一重建。
- 任务 1.5 标记完成，DB-019 标记 `VERIFIED`；随后进入 1.6 分域池、规则、容量和负责人历史 Repository。

---

## 22. W3.4.0 任务 1.6 分域池、容量与负责人历史 Repository（2026-08-25）

- 读取 Cordys Clue/Customer Pool、Capacity、Owner History、领取/分配、手工退池和自动回收源码，确认 Scope/Condition 文本、最新容量规则、Owner 周期及客户商机阶段排除语义。
- 新增 `CluePoolRepository` 与 `CustomerPoolRepository`，分别只访问自己的 Pool/Rule/Capacity/Owner/HiddenField 与主记录；池配置、容量配置、领取、分配、转移、退池、回收全部使用直接模型。
- 新增共享无状态 `PoolRuleCalculator`，覆盖每日领取、新数据、前负责人冷却和有效库容。明确保留 Cordys 源码差异：线索池管理员仍受前负责人冷却，客户公海管理员跳过该限制；两者都受库容。
- 负责人历史按 Cordys 的“已结束负责周期”表意实现：领取/分配建立当前周期，转移/退池/回收结束旧周期并写 `clue_owner/customer_owner`；自动回收 `system` 原因不进入历史原因字段。
- PostgreSQL transaction advisory lock 同时覆盖资源和目标负责人，容量配置另用组织级锁；真实库并发 Smoke 证明两个同时领取只有一个成功，等价 Scope 重复容量配置被拒绝。
- 专项测试 18 条、全量规则测试 `95/95`、新增文件 TypeScript 定向审计和 ESLint 通过。隔离空库应用 30 个 migration 后 9 项真实库 Smoke 通过，临时库已删除。
- 任务 1.6 标记完成；在该历史节点，旧 ResourcePool/PoolRule/PoolRecycle 及业务调用方仍属于 1.7，Seed 属于 1.8，因此 API 尚不可启动；随后进入 1.7。

---

## 23. W3.4.0 任务 1.7 业务调用方直接模型迁移（2026-08-25）

- 线索、客户、联系人列表/详情/筛选/批改/导入导出已接入分域 Field/Blob；主记录和动态字段使用同一事务，不再读取或写入目标域 `customData`。
- 线索转换、客户 360、协作、关系、合并、商机联系人、跟进、跟进计划、标讯转线索、通知收件人、旧首页统计与自动回收已改用 `Clue/Customer/CustomerContact` 及分域 Pool/Owner 模型。
- 删除旧通用池 CRUD Controller、PoolRulesService 和旧资源池 DTO；ResourcePoolsService 仅保留对 Clue/Customer Repository 的业务编排，不建立兼容 Controller、数据库别名或双写。
- 代码搜索确认生产 API 中被删除 Prisma delegate、旧 DTO 和旧 Controller 引用均为 0；Prisma validate/generate、API 生产构建、shared/Web typecheck、本批 ESLint、`95/95` 规则测试和 diff 检查通过。
- API 全量 typecheck 只剩 Seed 中 6 个旧 Customer 字段错误，明确归任务 1.8；Web 旧通用池配置调用将在 W3.4.2/W3.4.3 按 Cordys 直接页面 API 替换，不以临时兼容接口恢复。
- DB-016、DB-017、DB-020 更新为“调用方已完成、Seed/页面待验收”，DB-021 继续保留图外模块动态字段缺口。任务 1.4 与 1.7 标记完成；随后进入 1.8 Seed 与空库启动验收。

---

## 24. W3.4.0 任务 1.8 Seed 实现复核与修正（2026-08-26）

- 用户实现的首版 Seed 已能创建表单、视图、池、容量、基础业务数据和仪表板，但对照任务 1.1 的直接模型审计后，确认缺少 Pool HiddenField、Clue/Customer Owner History、Customer Collaboration/Relation、Clue Conversion 以及 Contact/Clue Blob 字段样例。
- 首版专项审计仅检查基础数量和“每张表存在任意索引”，可能把关系数据缺失或关键索引缺失误判为完成；现已改为检查 23 个关键命名索引、固定 Form Key/View Type、非空 Scope/Owner、有效转化目标及全部直接关系样例。
- Seed 已补到 3 个表单、20 个字段、五类用户视图、两套分域池/规则/容量/隐藏字段、三域普通与 Blob 字段值、负责人历史、协作、关系、转化和 Cordys 默认仪表板目录语义；连续执行两次保持幂等。
- 现有开发库增强审计通过：目标表 `32/32`、旧表残留 `0/14`、关键索引 `23/23`，全部直接关系断言为 true；`95/95` 规则测试、Shared/API/Web typecheck、全仓 Lint、API/Web 生产构建、生产启动和 HTTP 200 探测均通过。
- 经用户明确授权，`localhost:5432/default` 已用最终修正版执行破坏性重建，全部 30 个 migration 从零复放成功；双次 Seed 后最终计数稳定，仪表板目录/资源/收藏均从旧库残留的 `2/2/2` 收敛为 `1/1/1`。最终增强审计和 API/Web HTTP 200 探测通过，任务 1.8 正式关闭；随后进入 1.9。

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
- DB-019 保持 `VERIFIED`；DB-016、DB-017、DB-018、DB-020 的数据/公共服务底座已通过 1.9，但仍等待 W3.4.2～W3.4.4 对应页面/API 闭环，因此继续 `IN_PROGRESS`。该阶段随后进入 W3.4.1 首页，结果见下一节。

---

## 27. W3.4.1 首页最终专项验收（2026-08-26）

- 首页按 Cordys 普通工作台源码重建：独立 Home 统计、自然周期与环比、SELF/DEPARTMENT/ALL Scope、一次性跨页筛选、数据概览设置、真实快捷入口、我的计划、四类审批待办和消息通知全部接真实 API/数据源。
- 默认密码提醒改为后端 `users.default_pwd` 事实；成员创建/重置密码重新标记，用户修改密码后清除。审批“抄送我的”落在与审批相同的 `approval_task`，使用 `APPROVAL / CC` 类型区分，不再以通知数据替代审批抄送。
- 两条 W3.4.1 migration 已应用，本地开发库 migration 总数为 32；Prisma validate、Shared/API/Web typecheck、全仓 ESLint `0 error / 0 warning`、三端 production build 通过。
- 规则测试扩展到 `108/108`；首页真实 PostgreSQL/API Smoke `17/17`，根关键链路 `219/219`，W3.2 `23/23`，W3.3 `19/19` 全绿。
- 新增零第三方依赖的 Chrome DevTools Browser Smoke；固定桌面视口并清理浏览器 origin 状态后最终 `12/12` 通过，验证真实登录、首页五区、统计设置、快捷入口新增表单、审批/计划/消息跳转及无未捕获 Runtime 异常。
- W3.4.1 正式关闭；DB-016/017/018/020 不因首页完成而提前关闭。下一执行单元为 W3.4.2 线索与线索池。

---

## 28. W3.4-S 企业设置六页签领域化对齐（2026-08-26）

- 对照 Cordys 企业设置结构，将 `/system/settings` 从旧“企业信息 / 企业集成 / 开放 API”内容替换为“界面设置 / 第三方 / 邮件设置 / 模型设置 / 术语设置 / 全局任务”六页签；第三方页签继续聚合既有企微专用域和开放 API 能力，不把集成数据写入企业设置表。
- 新增 `EnterpriseSettingsModule` 及 UI、SMTP、AI 模型/有序路由、术语分类/术语/AI 发现、全局任务/执行记录直接模型。SMTP 密码与 AI API Key 复用下沉到 `common` 的 AES-256-GCM `CredentialCipherService`，读取响应只暴露 `*Configured` 状态；空密钥编辑保留既有密文。
- 界面图片资源复用 Attachment 存储，但由企业设置服务以租户 + 目标对象绑定；术语发现只暴露 `PENDING`，忽略进入 `IGNORED`，采纳在同一事务创建术语并回写 `ADOPTED`；全局任务执行记录只允许等待/执行态停止，终态才允许删除。
- 新六页签接管后彻底删除前端 `settingApi`、后端 `/settings`、`SettingsModule`/`SettingsService` 和 Prisma `SystemSetting`。独立 migration `20260826193000_remove_legacy_system_settings` 删除 `system_settings`，历史 migration 不修改；全仓当前运行时代码无旧 KV 消费者，`/system/settings` 前端菜单路由继续保留。
- 本地现有库顺序应用 `20260826173000_enterprise_settings_domain` 与 `20260826193000_remove_legacy_system_settings` 成功，migration 总数为 34。Prisma validate/generate、Shared/API/Web typecheck、全仓 ESLint、三 workspace production build 均通过。
- `test:rules` 已把企业设置专项测试纳入主规则集，当前 `114/114`；真实 API/数据库企业设置 Smoke `23/23`，新增覆盖未登录登录页按邮箱解析租户品牌配置，继续覆盖旧 `/settings` 404、UI 租户隔离、公开品牌配置、企微独立域、SMTP/AI 密钥加密、模型路由、术语发现采纳、全局任务执行停止/删除；根关键链路 Smoke 继续 `219/219`。
- 界面设置后续 UI 收口已验证：平台标题、Slogan、favicon、登录 Logo/背景和平台 Logo 由统一品牌 Store 消费；浏览器刷新首帧通过本地租户品牌缓存同步设置标题，不再先显示静态“微矩阵 CRM”。企业设置六个面板及企微配置卡已移除 scoped CSS，统一改用 UnoCSS `presetWind4` utility；品牌资源预览固定为 `1:1`，Tabs 不产生内部滚动，`el-main` 底部 padding 为 0，保存栏与内容区底边贴合。
- 前端路由页面已统一收口到 `apps/web/src/views/<业务模块>/`，同模块移动端页面放 `mobile/` 子目录；原 `src/mobile` 根目录已删除，移动专用 API、组件、Layout、样式分别进入 `src/api`、`src/components`、`src/layouts`、`src/styles` 并统一使用 `Mobile` 前缀。登录品牌加载与主题应用分别抽为 `useLoginBranding`、`useEnterpriseUiTheme` composable；桌面与 Mobile 登录页在未登录且未点击登录时即可通过公开接口显示租户品牌与正确浏览器标题，系统设置登录页配置已移除左侧模拟预览。
- DB 台账复核未发现需要新增编号的企业设置数据模型缺口；钉钉/飞书仍由既有 DB-015 跟踪，不通过恢复通用 `SystemSetting` 规避。企业设置 W3.4-S 完成后，业务主线继续 W3.4.2。

---

## 29. W3.4-D Docker 发布链路（2026-08-27）

- 在进入 W3.4.2 前插入独立工程化执行单元 W3.4-D，不改变 Cordys 业务复刻顺序；完成后执行指针恢复到 W3.4.2 task 3.1。
- 新增 `docker/api.Dockerfile` 与 `docker/web.Dockerfile`：API 使用 Node 24 multi-stage + production `pnpm deploy`，以非 root 用户运行并将 `/app/uploads` 作为持久化边界；Web 使用 Vite builder + Nginx Alpine，运行时由 `API_UPSTREAM` 转发 `/api`，支持 Vue Router history fallback 与 SSE 长连接。
- API production dependencies 保留 Prisma CLI 与 `dotenv`，同一 API 镜像既能启动 NestJS，也能作为一次性 `prisma migrate deploy` 容器；Node slim builder/runtime 显式安装 OpenSSL/CA，避免 Prisma engine 检测和外部 HTTPS 运行时缺口。
- 新增 `.dockerignore`，排除 Git、CordysCRM、`node_modules`、构建产物、uploads 与所有真实 `.env`；Docker release Smoke 额外断言 API 镜像内不存在 `/app/.env`。
- 新增 `docker-compose.release.yml` 与 `docker/.env.release.example`，启动顺序固定为 PostgreSQL healthy → migrate success → API healthy → Web；数据库与上传文件分别使用 `release_pgdata`、`release_uploads` volume。
- 新增 `.github/workflows/release-docker.yml`：仅监听 `v*.*.*` tag push，先校验 SemVer、执行 typecheck/lint，再跑真实 Docker runtime Smoke，最后 API/Web matrix 并行构建并推送 GHCR `linux/amd64` + `linux/arm64` 镜像；GHCR 写权限仅授予镜像发布 job。
- 本地 `pnpm smoke:docker-release` 已实测通过：从当前源码构建 API/Web 两个镜像，在隔离 PostgreSQL 中从零成功应用 34 个 migration，随后验证 API `/api/health`、Nginx `/healthz`、`/api` proxy 和 `/login` SPA fallback。Shared/API/Web typecheck、全仓 ESLint、API rules `114/114`、Compose config、workflow YAML、Shell syntax 与 `git diff --check` 同步通过。
- 正式发布命令为 `git tag v0.0.1 && git push origin v0.0.1`；普通 `git push origin master` 不触发 Docker release。本执行单元只建立发布能力，不自动创建正式版本 tag。

---

## 30. W3.4.2 线索与线索池最终专项验收（2026-08-27）

- task 3.1～3.5 已完成源码证据、普通 `/lead/*`、三条独立转换链路、多 `/pool/lead/*` 与 `/lead-pool`/`/lead-capacity` 分域配置、Pool Scope/Hidden Field/领取规则/库容/自动回收，以及 `/leads`、`/leads/pool` 两个 PC 固定上下文页面；旧 `/api/leads` 保持 404，不恢复兼容 Controller。
- 3.6 新增同一线索连续生命周期 Smoke：新增→跟进记录/计划→User View→退池→成员读取/领取→再退池→管理员分配→Owner History→导出，最终 `17/17`；普通 API `18/18`、三条转换 `21/21`、多 Pool `32/32` 同步全绿。
- Browser Smoke 扩展为 `20/20`：覆盖普通/Pool Overview、真实转换弹窗、Pool 批量态和两个池的往返切换；首次进入、A→B、B→A、返回普通线索后再次进入均硬断言 `/api/pool/lead/page` 一次状态变化只请求一次，并验证列表不串池、无未捕获 Runtime 异常。
- 最终根 `pnpm smoke` 首次复跑暴露历史脚本仍使用旧 `/leads`、旧 Pool 导入导出与旧批量领取语义；按 3.1 固化的 Cordys 契约更新验收脚本后恢复 `219/219`。该修复只更新测试契约，没有恢复旧生产 API。
- API rules `114/114`、首页 `17/17`、Shared/API/Web typecheck、全仓 ESLint、三端 production build、Prisma validate/generate 与 `git diff --check` 全部通过；本阶段无 schema/migration 变更。DB-016 因源码、数据模型、API、页面、权限和测试已完整闭环，更新为 `VERIFIED`。
- W3.4.2 正式关闭；下一执行指针为 **W3.4.3 客户、联系人和客户公海 task 4.1：固化客户域源码证据矩阵**。

---

## 31. W3.4.2 task 3.7 模块设置补漏最终验收（2026-08-27）

- 在进入 W3.4.3 前复核 Cordys `views/system/module/components/configCard.vue` 发现线索卡片的“线索池设置 / 线索库容设置 / 更多 → 移入线索池原因设置”在 MicroMatrix 仍是禁用占位，因此重新打开 W3.4.2 task 3.7；源码证据继续读取 `cluePoolDrawer.vue`、`addOrEditPoolDrawer.vue`、`capacitySetDrawer.vue`、Reason Drawer、`CluePool/ClueCapacity/Dict` Controller/Service、`UserExtendService` 与 `sys_dict/sys_dict_config` DDL。
- 新增 `sys_dict/sys_dict_config` Prisma 直接模型和 `20260827173000_w342_clue_module_settings` migration，本地 migration 总数变为 **35**；新增 `/dict/*` 并将 `CLUE_POOL_RS` 真正接入人工退池原因必填、跨组织/模块校验、Owner History 原因名与关闭时隐藏语义。自动回收 `system` 不写用户原因历史。
- Pool/Capacity Scope 补齐角色 Token 与角色成员展开，和用户/部门一起按最终实际成员执行 Pool 访问与 Capacity 重叠校验；模块设置线索卡片直接打开 Pool、Capacity、Move Reason 三个真实 Drawer，Pool 删除前执行 `no-pick` 且后端继续保留池内数据删除保护。
- Browser Smoke 首轮稳定复现 `LeadPoolConfigDrawer` 的真实初始化 race：引用数据异步加载结束后第二次整表 `reset()` 会覆盖用户已经输入的名称/规则。现改为先初始化表单、引用数据加载完成后只规范化 Scope，并以 CDP 真实文本输入、精确下拉 `aria-controls` 与单次 `/api/lead-pool/add` 网络断言完成验收。
- 新增模块设置 API Smoke **22/22** 与模块设置 Browser Smoke **17/17**；原 W3.4.2 连续生命周期 **17/17**、普通 API **18/18**、三条转换 **21/21**、多 Pool **32/32**、线索 Browser **20/20**、首页 **17/17**、rules **114/114**、根 Smoke **219/219** 全部复跑通过，`/api/pool/lead/page` 单状态变化单请求硬断言继续全绿。
- 根 Smoke 复跑同时暴露 demo Seed existing-user 分支未更新 `passwordHash/defaultPwd`，导致 Seed 输出“其余 demo123”与真实库可能漂移；修正后重复 Seed 会恢复默认密码和默认密码状态，已实际验证张伟/李娜使用 `demo123` 登录并恢复 `219/219`。
- Shared/API/Web typecheck、全仓 ESLint、三端 production build、Prisma validate/generate 与 `git diff --check` 均通过；build 仅保留既有 `ReportsView` 约 565.90 kB chunk warning。DB-016 继续保持 `VERIFIED`，DB-022 更新为线索 Pool/Capacity/Move Reason 已完成，客户与其它模块专属设置继续后续执行单元。
- W3.4.2 再次正式关闭；下一执行指针为 **W3.4.3 客户、联系人和客户公海 task 4.1：固化客户域源码证据矩阵**。

---

## 32. W3.4.3 task 4.1 客户域源码与 API 证据矩阵（2026-08-28）

- 读取 Cordys 客户、联系人、公海、客户 360、协作、关系、合并、负责人历史、个人视图、Pool Rule、Capacity、自动回收与模块设置的 Vue、API URL、Controller、Service、DTO、Domain 和最终迁移，不以当前 MicroMatrix 页面或截图反推行为。
- 锁定普通客户 `/account/*`、联系人 `/account/contact/*`、公海资源 `/pool/account/*`、公海设置 `/account-pool/*`、客户库容 `/account-capacity/*` 和 `CUSTOMER_POOL_RS` 原因配置六条独立调用链；旧 `/customers`、`/contacts` 和统一资源池调用不进入兼容范围。
- 明确四类访问边界：普通客户由 CUSTOMER 数据范围控制；`COLLABORATION` 只获得指定客户及允许子域写权限；`READ_ONLY` 无写权限；公海只由独立 POOL 权限与 Pool Scope 控制，且详情仅开放客户信息、跟进记录和负责人历史。
- 权限矩阵确认普通客户必须拆分 `transfer/recycle`，公海必须具备 `read/pick/assign/update/delete/import/export`；Cordys 协作管理复用 CUSTOMER UPDATE，因此当前 `customer:team` 不能作为目标独立权限。
- 数据模型复核确认现有客户域直接表覆盖 Cordys 最终 DDL；联系人 `customerId` 应可空，公海进入时间按源码使用 `Customer.updateTime`，task 4.1 不新增 migration。DB-017/DB-020 继续 `IN_PROGRESS`，DB-022 继续跟踪公海、客户库容和移入公海原因三个设置入口。
- 完整证据和差异落点见 [W3.4.3 客户、联系人和客户公海源码与 API 证据矩阵](./specs/business-module-page-parity/customer-source-api-audit.md)。task 4.1 关闭；下一执行指针为 **W3.4.3 task 4.2：重建客户 API 与客户 360**。

---

## 33. W3.4.3 task 4.2 客户 API 与客户 360（2026-08-28）

- 旧 `/api/customers` 单体 Controller 已移除，普通客户主契约切换到 Cordys `/account/*`；表单、分页、详情、CRUD、批量转移/编辑/删除、移入公海、客户选项、Tab、导入导出、图表以及客户 360 真实资源入口完成破坏式替换。
- 客户 360 商机、合同、回款计划、回款记录、发票和订单在 CustomerAccess 通过后继续叠加各自业务模块 DataScope；合同及回款/发票统计同步按关联模块范围裁剪，避免“客户可见”穿透到超范围交易数据。
- 客户编辑时负责人变化、联系人负责人、Owner History、客户主体和动态字段合并进同一事务；客户删除事务补齐动态字段、Blob 和跟进计划清理。Cordys 证据同步纠正 `/account/option` 为 POST，回款计划/记录路径位于 `/account/contract/*`。
- 新增 `scripts/w343-customer-api-smoke.mjs`，专项验收 **22/22**；API rules **114/114**，Shared/API/Web typecheck 与受影响文件 ESLint 全绿。
- task 4.2 关闭；下一执行指针为 **W3.4.3 task 4.3：重建联系人 API**。协作、关系、合并的深层规则继续由 task 4.4 收口，客户公海完整规则继续由 task 4.5 收口。

---

## 34. W3.4.3 task 4.3 联系人 API（2026-08-28）

- 再次读取 Cordys `CustomerContactController`、`CustomerContactService`、`ExtCustomerContactMapper.xml` 和前端 requrls，确认联系人主路径必须为 `/account/contact/*`，独立页与客户 360 共用同一直接模型，但访问边界不同。
- 删除旧 `/api/contacts/*` Controller；补齐 `/account/contact/module/form`、Pager `/page`、`/chart`、客户子资源 `/list/{customerId}`、详情、CRUD、启停、商机关联检查、Tab、批改、导入导出，并保留已完成的 `/account/contact/view/*` User View。
- `customerId` 从 API DTO 到导入链路改为可选，独立联系人允许不关联客户；显式关联客户时执行 Customer 子资源写权限。独立列表/图表/导出/批改继续只按 CONTACT DataScope，客户 360 READ_ONLY 可只读查看联系人，COLLABORATION 无 Customer 数据范围时只返回自己负责的联系人。
- 联系人普通动态字段与 Blob、唯一规则、启停原因全部落直接表；后端保留需求 R8 的商机关联强制拒删，删除联系人、动态字段/Blob 与附件处于同一事务。移动端客户联系人调用同步迁移到 `/account/contact/list/*`，浏览器 `/contacts` 仍只作为前端导航路由。
- 新增 `scripts/w343-contact-api-smoke.mjs`，专项验收 **18/18**；API rules **114/114**，Shared/API/Web typecheck、本批 ESLint、API/Web production build 与 `git diff --check` 全绿。
- task 4.3 关闭；下一执行指针为 **W3.4.3 task 4.4：对齐客户协作、关系和合并**。

---

## 35. W3.4.3 task 4.4 客户协作、关系和合并（2026-08-28）

- 重读 Cordys `CustomerCollaborationController/Service`、`CustomerRelationController/Service`、`CustomerService.merge`、联系人 `batchMerge` Mapper 与 `mergeAccountModal.vue/customerRelation.vue`，确认协作复用 CUSTOMER UPDATE、关系整组保存以及合并只接收 `mergeIds/toMergeId/ownerId`。
- 协作管理列表和写接口不再把 `COLLABORATION/READ_ONLY` 当 Customer DataScope；同客户/用户唯一、类型更新和批量删除保持 Cordys 语义。客户关系补齐最多 10 子公司、重复边、单上级集团、自关联、防环和整组失败保留。
- 删除 MicroMatrix 自定义 `KEEP_ALL/SKIP_DUPLICATES` 合并策略；联系人只在姓名/电话字段启用 unique 时自动去重，重复联系人被删除前先转挂商机、FollowUpPlan 和附件引用。
- 合并事务补齐 FollowUpPlan、报价/合同/工商抬头 Customer FK、源协作/负责人继承、源关系清理、主客户联系人负责人、Owner History 与领取时间；负责人/范围校验失败不产生部分删除。
- 新增 `scripts/w343-customer-deep-api-smoke.mjs`，专项 **30/30**；回归客户 API/360 **22/22**、联系人 API **18/18**、rules **114/114**；Shared/API/Web typecheck、API/Web production build、本批 ESLint 全绿。
- task 4.4 关闭；下一执行指针为 **W3.4.3 task 4.5.0：先完成 `/system/modules` 客户卡片的公海设置、客户库容设置、移入公海原因设置三个真实 Drawer**。

---

## 36. W3.4.3 task 4.5 客户公海与模块设置（2026-08-28）

- 再次读取 Cordys `configCard.vue`、`openSeaDrawer.vue`、`addOrEditPoolDrawer.vue`、`capacitySetDrawer.vue`、`moveReasonDrawer.vue`、`CustomerPoolController/Service`、`CustomerCapacityController/Service` 与 `PoolCustomerController/Service`，先补齐模块设置三个真实入口，再收口公海资源链路。
- `/system/modules` 客户卡片现可直接打开公海全屏管理 Drawer、客户库容 Drawer 与 `CUSTOMER_POOL_RS` 原因 Drawer；Pool/Capacity 均使用直接客户模型，Scope 支持用户/部门/角色并按实际成员防重叠，库容支持商机阶段 `IN/NOT_IN` 排除。
- `/pool/account/*` 补齐并验收选项、分页、详情、领取/分配、批量、编辑/删除、导入导出和图表。领取校验请求公海与客户真实公海一致；批量分配/删除/导出选中由首条客户反查 Pool 并拒绝跨池；公海模板排除负责人，导入数据直接进入指定公海。
- 每日领取、新数据保护、前负责人冷却、库容和 stage 排除均在后端直接规则中执行；自动回收实际消费 `customer_pool_recycle_rule`，清空负责人、写 `system` 原因并发送 `CUSTOMER_AUTOMATIC_MOVE_HIGH_SEAS`。普通客户详情与协作接口不能读取公海客户，公海详情保持独立读取边界。
- 新增客户模块设置 API Smoke **25/25**、Browser Smoke **17/17**、客户公海主体 Smoke **36/36**；回归客户 **22/22**、联系人 **18/18**、深层规则 **30/30**、rules **114/114**。API/Web typecheck、ESLint、production build 和 `git diff --check` 全绿。
- task 4.5 正式关闭；下一执行指针为 **W3.4.3 task 4.6：重建客户域 Vue 页面**。

---

## 37. W3.4.3 task 4.6～4.7 客户域 Vue 与最终验收（2026-08-28）

- 再次对照 Cordys 客户、联系人、公海三个页面和普通/公海 Overview Drawer，补齐普通客户批量转移/批量移入公海、客户公海批量领取/分配/修改/删除，以及联系人/客户/公海 query 深链。
- 新增 `CustomerMoveToPoolDialog.vue`，统一目标客户公海与 `CUSTOMER_POOL_RS` 原因选择；普通客户单条“分配负责人/退回公海”恢复为 Cordys“转移/移入公海”。
- 公海详情不再跳普通客户详情，统一使用 `/pool/account/get` 的独立 360 模式，只显示客户信息、跟进记录与负责人记录并应用 Pool 隐藏字段；领取/分配后的列表刷新去重，避免重复 `/pool/account/page`。
- 新增 `scripts/w343-customer-pages-browser-smoke.mjs`，桌面 + 390px Mobile 最终 **21/21**；模块设置 Browser 继续 **17/17**。根级 `pnpm smoke` 同步迁移旧客户/联系人测试契约后 **220/220**。
- 回归客户 API/360 **22/22**、联系人 **18/18**、协作/关系/合并 **30/30**、客户公海 **36/36**、模块设置 **25/25**、rules **114/114**；根级 typecheck、受影响文件 ESLint、production build 与 `git diff --check` 全绿。
- W3.4.3 task 4.1～4.7 客户域全部关闭；下一执行指针为 **W3.4.4 task 5.1：固化仪表板源码证据矩阵**。

---

## 38. W3.4.4 task 5.1 仪表板源码证据矩阵（2026-08-28）

- 完整读取 Cordys `DashboardController / DashboardModuleController / DashboardService / DashboardModuleService / DashboardSortService`、Mapper、Domain、1.1.0 + 1.3.0 DDL 和前端 dashboard 目录，确认 `/dashboard` 是目录化 URL 资源管理，不是首页统计。
- 锁定 Dashboard 资源 add/detail/update/rename/delete/page/collect/un-collect/collect-page/edit-pos 与 DashboardModule add/rename/delete/tree/count/move 契约；三张最终表为 `dashboard_module/dashboard/dashboard_collection`，当前 Prisma 直接模型已经具备，无需另建数据模型。
- 明确 Scope：空数组全员、用户/部门祖先命中、创建者可见；MicroMatrix 将把 tenant + Scope 扩展到详情、收藏、编辑、删除、排序，不能复制 Cordys 部分 ID 直查弱边界。
- DataEase 证据链已锁定：`DE_BOARD` 组织配置、`/organization/settings/de-token`、HMAC JWT、iframe `DashboardPanel/Dashboard` postMessage，以及 CRM→DE 的客户/线索/商机数据权限变量同步。W3.4 只实现配置/token/嵌入 adapter，不捆绑 DE 服务端或 License。
- 安全偏离锁定：add/update 共用 URL allowlist；仅 HTTPS（开发 localhost HTTP 例外）；禁止脚本协议；校验 `event.origin` 并使用精确 target origin，禁止 Cordys 的 `postMessage('*')`；CSP/frame-src 与 provider 错误分类必须可诊断。
- 新增 `dashboard-source-api-audit.md`；task 5.1 关闭，下一执行指针为 **W3.4.4 task 5.2：释放 Dashboard API 命名空间**。

---

## 39. W3.4.4 task 5.2 Dashboard API 命名空间释放（2026-08-28）

- 将原 Dashboard 销售统计 Service 迁入 `HomeOverviewService`，新 API 为 `/home/overview/summary|funnel|ranking|trend|conversion`；`/reports` 临时页面与 Mobile 首页同步切换，首页业务未回归。
- 删除旧 `DashboardController/DashboardService`，`DashboardModule` 暂作为空资源域占位；旧 `/dashboard/summary|funnel|ranking|trend|conversion` 五条路径全部 404，不保留隐藏兼容接口。
- 根级 Smoke **221/221**，其中新增门槛显式验证五条旧 Dashboard 统计路径全部释放；根级 typecheck、受影响文件 ESLint 和 production build 全绿。
- task 5.2 关闭；下一执行指针为 **W3.4.4 task 5.3：实现 DashboardModule 与 Dashboard Service**。

---

## 40. W3.4.4 task 5.3 DashboardModule 与 Dashboard Service（2026-08-28）

- 新增 `dashboard:read/create/update/delete` 权限粒度；销售专员默认只读，销售主管具备增改删。`DashboardResourceController` 与 `DashboardModuleController` 已占用释放后的 `/api/dashboard` Cordys 命名空间。
- `DashboardModuleService` 完成新增、改名、删除、树、递归计数和 before/inside/after 移动；同级重名、无效父目录、目录环、自身后代移动、未选中子目录和包含 Dashboard 的删除均由后端强制拒绝。
- `DashboardResourceService` 完成 add/detail/update/rename/delete/page/edit-pos；同目录重名、Scope ID 合法性、跨目录 APPEND、BEFORE/AFTER 排序在服务端与事务内执行。
- `DashboardAccessService` 将空 Scope、用户 ID、当前部门/祖先部门和创建者可见统一应用到 page/detail/tree/count/update/delete/move；第二租户管理员对当前租户资源仍只能得到 404，损坏 Scope JSON 对普通用户 fail-closed。
- 新增 `scripts/w344-dashboard-api-smoke.mjs`，最终 **31/31**；根级 Smoke 额外清理历史 `冒烟线索-/R4*/批量编辑线索` 测试数据，避免多次执行占满 Seed 库容；同时 rules **114/114**、根级 Smoke **222/222**、根级 typecheck、ESLint、production build 全绿。
- task 5.3 关闭；下一执行指针为 **W3.4.4 task 5.4：实现收藏与安全嵌入适配**。

---

## 41. W3.4.4 task 5.4 Dashboard 收藏与通用安全嵌入（2026-08-28）

- 新增收藏、取消收藏、我的收藏分页；重复收藏稳定 409，重复取消幂等，收藏列表/计数继续执行 tenant + Dashboard Scope，失效 Scope 收藏不泄漏。
- Dashboard `resourceUrl` 的新增/更新共用安全校验：仅 HTTPS；非 production 仅允许 localhost/127.0.0.1/::1 HTTP；禁止 URL 内嵌用户名密码。
- 新增 `/dashboard/embed/policy/:id`，返回精确 `origin/postMessageOrigin/frameSrc/CSP/sandbox`，不使用 `*`；5.5 页面只消费该策略，不自行拼接宽松 iframe 权限。
- DataEase 配置/token/provider adapter 按当前产品决策延期，未新增数据库表或 migration，另入 deferred backlog。
- Dashboard API Smoke **44/44**；根级 Smoke **223/223**、rules **114/114**、typecheck/ESLint/production build 全绿；根 Smoke 同步解决历史客户夹具占满 Seed 库容的问题。task 5.4 关闭，进入 **task 5.5 `/reports` Vue 页面重建**。

---

## 42. W3.4.4 task 5.5～5.6 Dashboard Vue 与最终验收（2026-08-28）

- 旧固定 ECharts `/reports` 已破坏式替换为真实 Dashboard 资源页：左侧“我的收藏 / 全部 / 多级目录树”，右侧目录资源表或 Dashboard iframe 预览；新增 `dashboard.ts` API facade、资源表单与预览组件。
- 页面补齐搜索、分页、排序、成员/部门 Scope、收藏、CRUD、重命名、目录/资源操作、跨目录拖拽、全屏与新窗口；文件夹拖到 Dashboard 节点前后被 UI 拒绝，资源拖入文件夹走 `/dashboard/edit/pos`。
- iframe 只消费 `/dashboard/embed/policy/:id` 的精确 URL/origin/CSP/sandbox；不使用 `*`，DataEase provider 继续 deferred。
- Dashboard Browser **28/28**、Dashboard API **44/44**、根级 Smoke **223/223**、rules **114/114**；全仓 typecheck/production build、受影响 ESLint 与最终 Web typecheck/build 全绿。
- 演示账号约定已同步到 Seed 与 Smoke：管理员/销售主管密码均为 `admin123`，销售专员为 `demo123`。
- W3.4.4 Dashboard 正式关闭；下一执行指针为 **W3.4.5 task 6.1：菜单和跨页导航全图验收**。

---

## 43. W3.4.5 全图最终验收（2026-08-28）

- task 6.1 完成菜单与跨页导航最终对齐：联系人/客户公海保持客户主导航高亮，客户公海路由 Guard 收紧为 `customerPool:read`；普通线索、线索池、跟进计划补齐资源 ID 深链和刷新恢复，商机通知改为现有页面可消费的 `/opportunities?id=`。全图导航 Browser **29/29**。
- task 6.2 现场复跑最终权限矩阵：首页 **17/17**、线索池 **32/32**、客户协作/只读/关系/合并 **30/30**、客户公海 **36/36**、Dashboard **44/44**、多角色 DataScope 规则 **4/4**、根 Smoke **223/223**；管理员/主管/专员、COLLABORATION、READ_ONLY、多角色并集、无权限和第二租户均有成功/拒绝证据。
- task 6.3 新增 `w345-empty-db-validation.mjs`：使用 Prisma PostgreSQL adapter 创建真实临时数据库，从零应用 **35/35 migration**、连续 Seed 两次，确认目标直接表 **32/32**、关键索引 **23/23**、旧表 **14/14** 全部不存在；隔离 API/Web runtime、目标 API 与旧 API 404 合计 **14/14**，临时进程和数据库自动清理。
- task 6.4 最终 Browser：Home **12/12**、线索 **20/20**、客户 **23/23**、Dashboard **28/28**、全图导航 **29/29**、Mobile Home/Leads **10/10**。最终 Browser 发现并修复客户公海真实竞态：初始列表请求晚返回会覆盖较新的搜索结果；`CustomerPoolView` 现使用同参数请求复用 + generation，只允许最新请求更新列表。
- 最终质量门槛：根级 `pnpm smoke` **223/223**、API rules **114/114**、全仓 typecheck、全仓 ESLint、Shared/API/Web production build 全绿；ESLint 同时清理一个已废弃的 Browser Smoke `clickText` 测试 helper。
- 文档已同步 `tasks / final-navigation-access-audit / parity / deferred / graph-completion-plan / specs index / docs index`。DataEase provider/token 继续 DB-023 deferred；商机高级配置、合同/发票高级流程、自定义表单等图外能力仍按原 parity/deferred 状态推进。
- **W3.4.0～W3.4.5 正式全部关闭，用户确认的 W3.4 功能图状态更新为 `VERIFIED`。该状态不等于整个 CordysCRM 所有模块已 100% 复刻。**

---

## 44. W3.5 用户个人中心与 API Key（2026-08-28）

- 按 Cordys `layout-sider.vue / personalInfoDrawer.vue / UserKeyController / UserKeyService` 重建用户入口：桌面用户名从 Header 移到左侧底部，下拉菜单为个人信息、我的计划、我的导出、退出系统；Mobile “我的”同步个人信息编辑、改密和退出。
- 新增 `/personal/center/info|update|info/reset|follow/plan/list`，手机号/邮箱按 Cordys 用户级语义全局唯一；个人资料修改写操作日志。`User.authVersion` 使改密后旧 access/refresh 会话在服务端即时失效。
- 补齐条件式 API Key Tab 与 `PERSONAL_API_KEY:READ/ADD/UPDATE/DELETE`，新增 Cordys `/user/api/key/add|list|update|enable|disable|delete`；每人最多 5 个，支持描述、永久/自定义有效期、启停、删除，并对所有 ID 操作增加当前用户所有权校验。
- `AuthGuard` 支持 `X-Access-Key / X-Secret-Key`，真实复用现有角色权限和 DataScope；错误 Secret、停用、过期和跨用户操作均被拒绝。
- Cordys 企业“三方设置”只承载企微、钉钉、飞书、DataEase、MaxKB、标讯、企查查等企业级集成，开放 API 凭证属于个人中心。为避免双套凭证混淆，已破坏性删除 MicroMatrix 早期企业设置“开放 API / 365 天 JWT”卡片、`POST /auth/api-token` 和 `AuthService.issueApiToken()`，不保留兼容入口。
- 最终验收：Personal Center/API Key API **44/44**、Desktop/Mobile Browser **23/23**、根 Smoke **223/223**、rules **114/114**；隔离空库 **14/14** 可从零应用 **37/37 migration** 并双次 Seed，typecheck/ESLint/production build 全绿。

---

## 45. W3.6.0 商机直接模型与高级配置（2026-08-28）

- 按 Cordys `opportunity/*`、最终 DDL 与 ModuleForm 源码把商机主表、阶段、失败原因、关闭规则和动态字段值切换到直接模型；旧 `/opportunities` API 假设从根 Smoke 清除。
- `/system/modules` 商机阶段、关闭规则、失败原因均为真实 API/Drawer；专项规则 Smoke 与 Browser **18/18** 全绿。
- 最终验收：根 Smoke **224/224**、Rules **114/114**、typecheck/ESLint/production build 全绿；正式库最终达到当阶段 **40/40 migration**。

---

## 46. W3.6.1 产品与价格表（2026-08-29）

- Product 主表按 Cordys 直接模型重建，旧 `code/category/unit/cost/ownerId/deptId/customData` 主表真相源、旧 `/products` REST API 和 `ON/OFF` 状态全部删除；产品 API 统一 `/product/*`，状态统一 `1/2`。
- 产品动态值使用 `product_field/product_field_blob`；默认描述走 TEXTAREA，`productPic` 走 PICTURE Blob，Web 支持最多 10 张/20MB 上传预览。按 Cordys `canImport/canExport` 明确禁止 Picture 进入 Excel 导入导出。
- 新增独立 Price 直接模型和 `/price/*`；价格表产品信息按 `SUB_PRODUCT` 的 `refSubId/rowId/bizId` 存入 `product_price_field/blob`，支持产品、SKU、产品定价、税点，产品/定价 required。
- 价格表 ADD/UPDATE Excel 与 ExportTask 导出均升级为 Cordys 二级表头：主字段纵向合并，`产品信息` 横跨子字段；连续多产品行聚合为同一价格表，UPDATE 以唯一 ID 聚合。
- `/system/modules` 产品卡的“产品表单设置 / 价格表表单设置”均已 REAL；现有租户通过 forward migration 43 补齐 `productPic` 和价格表子字段元数据，不依赖重新 Seed。
- 数据库验收：正式 `default` **43/43 migrations**；隔离空库从零 **43/43** 全量 replay + Seed 连跑两次成功；SQL 直接确认 `productPic=picture`、price product/amount `required:true`、SKU/税点元数据存在。
- 最终验收：W3.6.1 Service Smoke 全绿、Browser **19/19**、根 Smoke **224/224**、Rules **114/114**、全仓 typecheck/ESLint/production build 全绿。旧 `/products` API、旧 Product 主字段和 `ON/OFF` 残留扫描均为 0。
- 报价引用价格表后的删除保护留给 W3.6.2 报价直接 Field/Blob 真相源关闭；不为提前变绿重新引入旧 Quote 兼容逻辑。

---

## 47. W3.6.2 报价直接模型、审批与交易链（2026-08-29）

- 按 Cordys `OpportunityQuotationController/Service/FieldService/UserViewController`、最终 DDL、前端 quotation table/detail/PDF 和 requrls 重建报价域；旧 `Quote/QuoteItem/QuoteStatus`、`customerId/ownerId/deptId/customData` 主数据假设和旧 `/quotes` REST 契约全部删除。
- Prisma 新增 `opportunity_quotation`、`opportunity_quotation_field/blob`、`opportunity_quotation_snapshot`；产品明细按 SUB_TABLE 的 `refSubId/rowId/bizId` 保存，客户关系从商机取得，DataScope 按 `createUser` 所属部门执行。正式库最终 **46/46 migrations**。
- 通用 Approval 按 Cordys `@HitApproval` 补齐 quotation CREATE/UPDATE/DELETE：CREATE 自动提审；UPDATE 保存 `business_snapshot`，驳回/撤回恢复主字段、动态字段、产品子表与报价 Snapshot；DELETE 审批通过后才物理删除。`approved` 作为历史审批事实位，通过后不因撤回/驳回清零。
- `/opportunity/quotation/*`、`OPPORTUNITY_QUOTATION` User View、作废/批量作废、审批/批量审批、Tab、Download 日志均完成；PDF 由 Web 按冻结 Snapshot 生成并触发打印。商机→报价 `fromOpportunity`、报价→合同 `fromQuote` 深链均通过真实 Browser。
- W3.6.1 延期的价格表引用保护在本阶段关闭：`ProductPriceService.delete()` 直接检查报价 Field/Blob，命中返回 Cordys“价格表已被报价单关联，无法删除！”；报价删除后价格表可再次删除，HTTP Smoke 已覆盖。
- `/system/modules` 商机卡“报价表单设置”保持 REAL，独立 Browser **5/5** 验证真实进入 `module=quote`，并确认报价、商机、联系人、报价日期、有效期、累计金额等 direct 字段存在，旧报价单号/报价状态字段不存在。
- 最终验收：报价业务 Browser **28/28**、审批 HTTP Smoke 全绿、根 Smoke **224/224**、Rules **114/114**；隔离空库 **46/46** 全量 replay + Seed 连跑两次成功；全仓 typecheck、ESLint、Shared/API/Web production build 全绿；`prisma.quote` 与 `QuoteStatus` 运行时残留为 0。
- W3.6.2 正式关闭；下一执行指针为 **W3.6.3 合同 4.1：先读 Cordys 合同源码/DDL/API/页面并建立证据矩阵**。
