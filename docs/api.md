# 接口文档使用指南（Swagger / OpenAPI）

## 访问入口

| 地址 | 用途 |
| --- | --- |
| http://localhost:3000/api/docs | Swagger UI 在线文档与调试 |
| http://localhost:3000/api/docs-json | OpenAPI 3.0 JSON（供工具导入） |

文档默认常开（内部系统）；如需关闭，环境变量 `SWAGGER_ENABLED=false`。

## 在线调试步骤

1. 展开「认证」分组 → `POST /api/auth/login`，用演示账号登录拿到 `accessToken`
2. 点击页面右上角 **Authorize**，粘贴令牌（不需要 `Bearer ` 前缀），Authorize 后**刷新页面也会保留**
3. 任意接口 Try it out 即可；响应时长会显示在结果里

长期集成（脚本/第三方系统）请用 `POST /api/auth/api-token` 签发 365 天令牌，或到「Web 端 → 系统管理 → 企业设置 → 开放 API」生成。

## 导入到 Apifox / Postman

- **Apifox**：新建项目 → 导入数据 → OpenAPI/Swagger → URL 导入 `http://localhost:3000/api/docs-json`，可开启定时同步
- **Postman**：Import → Link → 同上 URL
- 每个接口的 `operationId` 形如 `Customers_findAll`（控制器_方法），导入后名称稳定可读

## 阅读约定（与文档首页描述一致）

- **鉴权**：除标注公开的接口（登录/注册/刷新/健康检查/SSE 流）外，一律需要 Bearer 令牌；无权限返回 `403`（缺权限码）、未登录返回 `401`
- **分页响应**：`{ items: T[], total, page, pageSize }`
- **高级筛选 filters**：JSON 字符串数组，`[{"key":"name","op":"contains","value":"科技"},{"key":"cf_xxx","op":"gt","value":100}]`
- **自定义字段**：写操作把 `cf_*` 键放进 `customData` 对象；字段定义通过 `GET /api/metadata/{module}/fields` 获取
- **错误结构**：`{ statusCode, message, error? }`，`message` 为中文提示，校验错误时可能为数组
- **数据范围**：同一接口不同角色返回的数据集合不同（按角色数据范围自动过滤），联调时注意用对应测试账号

## 测试账号

| 账号 | 密码 | 数据范围 |
| --- | --- | --- |
| admin@demo.com | admin123 | 全部 |
| zhangwei@demo.com | demo123 | 本部门及下级 |
| lina@demo.com | demo123 | 仅本人 |

## 已知限制

- 响应体 Schema 未逐接口建模（VO 为 TS interface，无运行时元数据）：响应结构以 `packages/shared/src` 中的 `*VO` 类型为准；后续如需完整响应 Schema，可将 VO 改为带 `@ApiProperty` 的 class 或引入 nest CLI swagger 插件（需恢复 nest build 链路）
- SSE 接口（`GET /api/notifications/stream?token=`）无法在 Swagger UI 中调试，请用浏览器 EventSource 或 curl 验证
