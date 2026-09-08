# DB-008 消息模板与多语言资源设计

状态：`VERIFIED`

## 1. Cordys 事实

1. `NotificationConstants.Event / TemplateText` 通过 `@Schema(description=i18nKey)` 指向资源 key。
2. `MessageTemplateUtils.getTemplate(event)` 取 `event + _TEXT`；`getContent()` 用 `${param}` 替换，额外处理 `*Time / *User`。
3. `AbstractNoticeSender` 默认 subject 为 `eventText + Translator.get("notice.event.subject")`。
4. `CommonNoticeSendService` 把操作者 `User.language` 放入 NoticeModel；`NoticeSendService` 按这个 language 设置 Locale 后统一渲染。
5. Cordys CRM 后端当前只有 `zh_CN / en_US` 两套 properties；消息设置页面不存在模板编辑器。

## 2. MicroMatrix 结构

### 2.1 User language

`User.language: String @default("zh-CN")`

首批公开值：`zh-CN`、`en-US`。继续使用 String 而不是 Prisma enum，保持与 Cordys `varchar language` 的扩展方式一致。

### 2.2 MessageTemplateService

位于 `apps/api/src/modules/notifications/message-template.service.ts`：

- `normalizeLanguage()`：兼容 `zh_CN / en_US` 输入并收敛为公开 locale。
- `render(event, context, language)`：返回 `{ title, content }`。
- `renderText()`：复用相同变量规范化能力处理 Cordys 的显式业务模板分支。
- title = eventName + localized subject suffix。
- content = 对应 event template；全部 `MessageTaskEvent` 都由类型化资源注册表覆盖。
- `*User` 解析只在值看起来是邮箱/手机号时查询当前 tenant 用户；调用方已传姓名时原样保留。

资源使用 TypeScript 只读对象，不新增数据库真相源；内容从 Cordys 两份 properties 固化并由专项测试防漂移。

### 2.3 BusinessNotificationsService

输入新增：

```ts
templateContext?: Record<string, unknown>
language?: MessageLanguage
```

默认流程：解析/过滤接收人 → 解析操作者 language（无操作者默认 `zh-CN`）→ renderer → 同一份 title/content 同时交给 Notification 与 MessageDelivery。

显式 title/content 只作为无模板事件或迁移期间 fallback；完成迁移的 MessageTaskEvent 不再传手写正文。

### 2.4 个人中心

沿用 `/personal/center/info` 与 `/personal/center/update`，在已有编辑 Dialog 增加语言选择，不新增平行设置页。`CurrentUser / PersonalCenterVO` 同步暴露 language。

## 3. 数据库策略

项目仍未正式发布；DB-008 直接修改唯一 `20260905084900_baseline` 的 users 表定义，并更新 Prisma schema。Seed 创建用户时可依赖数据库默认 `zh-CN`。

## 4. 业务调用迁移

将 `title/content` 硬编码收敛为 `event + operatorId + templateContext`，但链接、Notification biz type、接收范围和 MessageTaskSetting gate 保持不变。

## 5. 失败策略

- 未知 locale → `zh-CN`。
- 未找到 event template → 不伪造正文；保留显式 fallback 能力。
- 单个 `*User` 无法解析 → 原值继续参与模板渲染。
- renderer 错误由业务通知原有 best-effort 边界捕获，不影响主业务事务。

## 6. Prisma driver adapter schema 一致性

最终 fresh-schema 验收发现 Prisma CLI 能识别 `DATABASE_URL?schema=...`，但 `@prisma/adapter-pg` 运行时不会自动消费 Prisma 专用 `schema` 查询参数。现统一由 `createPrismaPgAdapter()` 提取 `schema` 并传入 adapter options，同时从 node-postgres connection string 删除该参数，使 migrate / Seed / API 对同一连接串保持一致；未指定 schema 时行为保持不变。
