# 消息设置底座对齐设计

## Cordys 源码事实（2026-08-24）

- Web 入口 `views/system/message/index.vue` 含“消息通知 / 公告”两个 Tab；W2.3 只迁移消息通知。
- `messageList.vue` 展示功能、通知场景、系统消息、邮件提醒；第三方平台列仅在组织同步配置存在时显示。
- `message_task.json` 固定列出 35 个事件，模块为 `CUSTOMER / CLUE / OPPORTUNITY / ORDER / CONTRACT`。
- `MessageTaskController` 提供列表、单项保存、批量保存和配置查询；读写分别受 `SYSTEM_NOTICE:READ/UPDATE` 约束。
- `sys_message_task` 保存组织级渠道开关；`sys_message_task_config` 保存时间、成员、角色和负责人上级范围。
- 只有 8 个报价/合同事件显示配置入口；只有三个 `EXPIRING` 事件显示时间配置。默认范围为负责人，默认提前 3 天。
- 消息模板由 `MessageTemplateUtils` 和 i18n 资源提供，当前设置页面没有模板编辑入口。

## 共享契约与数据模型

`packages/shared/src/message-settings.ts` 保存只读事件目录、中文名称、是否可配置范围/时间及默认值，并定义前后端 VO。

新增 `MessageTaskSetting`：

- `tenantId / module / event`：租户与固定事件复合唯一键。
- `systemEnabled / emailEnabled`：站内信和邮件开关。
- `config`：JSON 范围配置，结构由 shared 类型约束。
- `createdAt / updatedAt`：审计时间。

数据库只保存覆盖值；列表服务将覆盖值合并到固定目录，所以 Cordys 后续事件升级需要显式修改代码和测试，不会被脏数据注入页面。

## API 与服务

Controller 根路径为 `/message-settings`：

- `GET /`：返回按模块分组的完整事件目录。
- `PATCH /:event`：保存单个事件开关，可同时保存范围配置。
- `POST /batch`：批量切换系统消息或邮件提醒。
- `GET /:event/config`：返回默认值或已保存范围配置。

服务校验事件与模块匹配、时间条数/正整数/重复、成员和角色租户归属。更新使用 Prisma upsert。写接口使用 `@LogOperation`。

## 通知分发

`NotificationsService.notify/notifyMany` 的输入增加可选 `event`。存在事件时先查询 `MessageTaskSetting.systemEnabled`；没有覆盖记录时使用目录默认值。关闭后直接返回，不创建 `Notification`，因此 SSE 也不会推送。

W2.3 先让跟进计划到期提醒传入对应事件编码，验证底座确实控制真实业务链路。其他已有通知调用不传事件，保持兼容；后续逐模块对齐时再绑定准确事件。

## 权限与 UI

- 权限树增加 `system:message` 和 `system:message:update`；菜单与读取 API 使用前者，写 API 使用后者。
- 页面采用 Cordys 的高密度分组表格；总开关位于列头，单项开关位于事件行。
- 邮件列保留源码信息架构但禁用，并显示“邮件通道待接入”。
- 8 个到期事件显示设置按钮，右侧抽屉编辑提前时间、成员、角色和上级层级。

## 明确差异

- MicroMatrix 使用一个 JSON 配置字段合并 Cordys 的两张配置表语义，外部契约保持同构。
- Cordys 当前第三方通知列依赖组织同步平台；项目尚无该公共底座，因此 W2.3 不展示第三方列。
- Cordys 初始化邮件关闭、系统消息开启；MicroMatrix采用相同默认值。

## 验证

- 单元测试覆盖目录、默认合并、校验与关闭站内通知。
- smoke 覆盖读取、单项更新、批量更新、配置保存、权限 403 与恢复默认。
- 浏览器验证列表分组、单项开关、总开关、到期抽屉、刷新持久化及相邻系统页面。
