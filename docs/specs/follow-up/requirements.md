# Follow-up 统一协同需求

## 1. 目标

线索与客户共享同一套跟进计划、跟进记录、评论/@成员和动态表单能力。当前正式目标类型只允许 `lead / customer`，不得恢复已退出产品的 Opportunity 等目标。

## 2. 跟进计划

- 支持分页、关键词、状态、本人、目标类型/目标 ID 和动态高级筛选。
- 状态固定为 `PREPARED / UNDERWAY / COMPLETED / CANCELLED`。
- 新建、编辑、删除、状态变化均保持 tenant、权限和 DataScope 边界；客户协作成员继续服从 READ_ONLY/COLLABORATION 语义。
- 计划负责人、目标对象、联系人、计划时间、跟进方式、内容及可配置字段统一进入当前 ModuleForm / Field / Blob 体系。
- 到期计划按调度扫描并向负责人发送对应 Lead/Customer 消息事件；重复扫描不得在同一天重复提醒。

## 3. 计划转跟进记录

- `/follow-up-plans/{id}/convert` 只允许未转换计划执行一次。
- 转换在单一事务中 claim 源计划、创建 FollowUpRecord、保存 Field/Blob、刷新目标最近跟进信息并回写 `convertedRecordId`。
- 计划动态字段只通过显式 `PLAN_TO_RECORD` formLink 预填/复制；不按同名字段或 `cf_` key 猜测。

## 4. 跟进记录

- FollowUpRecord 正式目标类型只允许 `lead / customer`。
- 支持统一 page/detail/create/update/delete、UserView、动态筛选和可排序标量字段。
- 动态字段与附件/图片字段复用 Metadata 的 Field/Blob 与附件 claim 生命周期。
- Lead -> Customer、Customer merge/delete 等跨资源事务必须保持跟进记录与动态字段一致性。

## 5. 评论协同

- 跟进计划和跟进记录都支持顶层评论 + 一层回复。
- 评论创建支持 `mentionedUserIds` 和 `replyToUserId`；成员必须属于当前租户且有效。
- 只有评论创建人可以编辑/删除自己的评论；一级评论删除时按当前服务规则清理关联回复与 mention。
- `commentCount` 统计顶层评论与回复总数。
- 新评论、回复和 @成员使用 Lead/Customer 对应事件进入统一通知链，不定义万能跨业务事件。

## 6. PC / Mobile

- PC 与 Mobile 使用同一后端协议和动态字段契约。
- 客户/线索详情、跟进计划页面和相关 Drawer/选择页只做目标上下文编排，不复制一套跟进领域逻辑。
- Mobile 使用 Vant 组件和独立路由；企业微信容器的 Header 显隐继续服从统一环境判断。

## 7. 验收

- API Rules 覆盖计划 CRUD、提醒、转换、FollowRecord CRUD、Field/Blob、评论、mention、权限和事务回滚。
- 目标类型不得接受除 `lead/customer` 以外的值。
- 计划转换重复执行、越权目标访问、无效联系人、无效 mention 和已转换计划再次修改必须 fail-closed。
- 文档和 API 不再出现 Opportunity 作为当前 Follow-up target。
