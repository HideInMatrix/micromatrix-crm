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
- 新建客户/线索转化时前端调用，命中弹窗提示「疑似重复，归属 XX」，可继续或放弃
- 导入 CSV 时逐行查重，重复行列入失败原因
- 验收：重复名称创建时出现提示；导入重复行被拦截

### 3. 客户 360 详情页

- 新路由 `/customers/:id`（保留列表抽屉作快捷预览）
- 聚合 tabs：基本信息（动态字段只读+编辑）/ 联系人 / 商机列表 / 合同与回款汇总 / 跟进时间线 / 团队 / 操作历史（第二期接入）
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
| xlsx 导入导出 | exceljs 替换 CSV（保留 CSV 兼容）；扩到商机/合同/回款导出 |
| 登录安全 | 自助改密接口+页面；连续 5 次失败锁定 15 分钟（Redis 计数）；密码复杂度校验 |
| 移动端补齐 | 商机（列表/看板简版/推进）、合同（列表/详情/登记回款）页面 |

## 第三期（P2：商业化前完善）

- 审批流增强：抄送人、转办、多条件路由（字段级条件表达式，复用公式求值器思路）
- 计算字段函数库：`SUM/AVG/IF/DATEDIF/ROUND` 等（扩展 shared 的公式解析器，语法向 Cordys v1.6 计算组件对齐）
- 客户标签体系 + 标签筛选；客户层级（parentCustomerId）
- 产品分类树管理；单据编号规则配置（前缀/日期格式/流水位数）
- 通知渠道扩展（邮件 SMTP、企微/钉钉机器人 webhook）与消息模板配置
- 办公平台集成：企微/钉钉扫码登录（OAuth）
- PostgreSQL RLS 强制租户隔离；BullMQ 承接重任务（大文件导入导出）

## 里程碑外的持续事项

- 冒烟脚本随功能扩充断言（当前 19 项）
- 每期结束更新 [gap-analysis.md](./gap-analysis.md) 状态标记
- 商业化启动时：开放注册入口、启用 plans/subscriptions、接入计费
