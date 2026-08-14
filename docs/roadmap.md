# 补齐功能实施计划

> 基于 [gap-analysis.md](./gap-analysis.md) 的优先级排期。每期均要求：`pnpm build && pnpm typecheck && pnpm lint` 全绿 + 冒烟脚本扩充对应断言。

## 第一期（P0：补齐日常使用刚需）

### 1. 附件系统（其余多项功能的前置依赖）

- 后端 `modules/attachments`：
  - `POST /attachments/upload`（multipart，需 `@nestjs/platform-express` 自带 multer；限制类型/大小，默认 ≤20MB）
  - 存储抽象 `StorageProvider` 接口：`LocalDiskStorage`（`apps/api/uploads/` 起步）实现，预留 OSS/S3 适配器
  - `GET /attachments/:id/download`（鉴权 + 流式返回）、`DELETE /attachments/:id`
  - 挂载模型已就绪：`Attachment(targetType, targetId)`
- 前端：`AttachmentUploader.vue` 通用组件（上传/列表/删除/下载），接入跟进记录与合同详情抽屉
- 验收：合同上传扫描件、跟进带附件，重启服务后可下载

### 2. 客户查重（防撞单）

- `GET /customers/check-duplicate?name=&phone=`：名称模糊（pg_trgm 或 contains）+ 电话精确，返回疑似客户及归属人（脱敏：非本数据范围仅显示负责人姓名）
- 工作台提供查重入口（对齐 Cordys `workbench.duplicateCheck`）；新建客户/线索转化时同样调用
- 导入时逐行查重，重复行列入失败原因
- 验收：重复名称创建时出现提示；导入重复行被拦截

### 3. 客户 360 详情页

- 新路由 `/customers/:id`（保留列表抽屉作快捷预览）
- 聚合 tabs（对齐 Cordys 客户概览，P0 先做加粗项）：**基本信息** / **联系人** / **商机** / **合同与回款** / **跟进记录** / **团队**；二期再补跟进计划、负责人记录、客户关系、发票、订单
- 后端补 `GET /customers/:id/related`（商机/合同/回款聚合统计）
- 验收：从客户维度可看到完整生意链路

### 4. 商机产品明细

- `OpportunityItem` 表（同 QuoteItem 结构）；商机表单接入 `LineItemsEditor`，金额自动汇总（可手动覆盖）
- 报价「从商机创建」自动带入明细
- 验收：商机带明细创建，转报价免重复录入

### 5. 商业标讯数据源（阻塞项：等 API 账号）

- 拿到账号后实现 `JianyuProvider`/`QianlimaProvider`（实现 `BiddingProvider` 接口 + 在 `BiddingService` 注册）
- 凭证配置界面已就绪（数据源抽屉），补充 provider 的凭证字段说明
- 验收：真实关键词抓取入库，转线索链路走通

## 第二期（P1：管理与体验增强）

| 事项 | 要点 |
| --- | --- |
| 对象操作历史 | 通用 `ChangeLog` 表（module/targetId/字段 diff JSON）；服务层更新前后对比；详情页时间线。注意排除 customData 中未变更键 |
| 回收站 | 核心对象（线索/客户/商机/合同）加 `deletedAt` 软删除；所有查询默认过滤；系统管理-回收站页支持恢复/彻底删除（30 天自动清理 cron） |
| 全局搜索 | 顶栏搜索框：并行查客户/线索/商机/合同（名称/编号/电话），分组展示跳转 |
| 目标管理 | `SalesTarget(userId/deptId, month, amount)`；设置界面（按成员批量）；工作台/报表显示达成率进度条 |
| 批量操作 | 线索/客户列表多选：批量分配、批量退回池/公海、批量删除（权限同单条） |
| 看板拖拽 | 商机看板列间拖拽（vuedraggable group），落下调用 changeStage；输单列拖入弹原因框 |
| 合同到期提醒 | 现有 cron 体系加：endAt 前 30/7 天通知负责人 |
| 打印模板 | 报价单/合同打印视图（打印 CSS），含明细表格与合计、盖章位 |
| 登录安全 | 自助改密接口+页面；连续 5 次失败锁定 15 分钟（Redis 计数）；密码复杂度校验 |
| 移动端补齐 | 商机（列表/看板简版/推进）、合同（列表/详情/登记回款）页面 |
| **跟进计划** | 独立对象 `FollowUpPlan`；列表+到期提醒 cron（默认 3 天通知负责人）；**计划转记录**；个人中心「我的计划」。类型=客户显示客户/商机/联系人，类型=线索显示线索 |
| 默认字段包 | 种子补种、不改核心表：线索需求/线上来源；客户等级/类型/来源；商机来源。选项集对齐 alignment-log。报价系统字段补 `opportunityId` |
| 客户标签 | `Tag` + 多对多；客户表单多选；列表筛选。对应 Cordys `INPUT_MULTIPLE` |
| 商机/报价联系人 | Opportunity/Quote/FollowUpRecord 加 `contactId`；表单 DATA_SOURCE 先页面写死 |
| 保存的列表视图 | `SavedView(module, name, filters, columns, scope=personal/system)`；列表切视图；图表可二期 |
| 列表范围 Tab | 全部 / 我的 / 部门（客户加「协作」）；与现有 dataScope 叠加 |
| 客户合并 | 选主客户；联系人/跟进/商机/团队并入；被合并客户删除或标记 |
| 合同可配置阶段 | 复用商机阶段模型（`ContractStage` + 回退开关）；默认七段对齐 Cordys；写死四态改为 stageId |
| 商机关闭规则 | `OpportunityRule(成员范围, 归属天数, 阶段, 自动关闭)`；cron 扫描 |
| 多公海 / 库容 | `Pool` 可多条命名；领取日限额、前归属人冷却；`CapacityRule` 按部门/成员上限 |
| 异步导出中心 | 任务表 + 个人中心「我的导出」；xlsx 导出走任务，24h 过期 |
| xlsx 导入导出 | exceljs；导入新建 + 导入更新（唯一字段）；扩到商机/合同/回款 |

## 第三期（P2：商业化前完善）

- 表单引擎：`DIVIDER` 分组、`showControlRules` 显隐、`location`、图片/附件字段、元数据级 `DATA_SOURCE` / 子表、表单联动（计划转记录等）
- 发票开票明细（项目/规格/单位/数量/税率）；订单可配置阶段 + 产品明细 + 收货人/地址/电话
- 价格表（名称/启停/产品子表）
- 审批流增强：抄送人、加签、退回、依次审批、通过后 Webhook、多条件路由
- 计算字段函数库：对齐 v1.8 `SUM/DAYS/CONCATENATE/TEXT/IFS/TODAY/NOW/AND`
- 客户层级（集团/子公司 relation）；脱敏配置
- 自定义表单模块（任意对象）；产品分类树；单据编号规则
- 通知渠道扩展（邮件 SMTP）与按事件开关；SSO/用户同步（不含企微钉钉扫码登录本体，仍后置）
- PostgreSQL RLS 强制租户隔离；BullMQ 承接重任务

## 里程碑外的持续事项

- 冒烟脚本随功能扩充断言（当前含附件/查重/360/商机明细）
- 每期结束更新 [gap-analysis.md](./gap-analysis.md) 状态标记与 [alignment-log.md](./alignment-log.md)
- 商业化启动时：开放注册入口、启用 plans/subscriptions、接入计费
