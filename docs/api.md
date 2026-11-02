# API 使用指南

## Swagger / OpenAPI

| 地址 | 用途 |
| --- | --- |
| `http://localhost:3000/api/docs` | Swagger UI |
| `http://localhost:3000/api/docs-json` | OpenAPI JSON |

Swagger 默认关闭。仅在开发或排障环境显式设置 `SWAGGER_ENABLED=true` 后注册上述入口；生产环境不要为了方便长期开放交互式文档。

## 鉴权方式

- 用户交互及普通业务 API 使用登录后获得的 Bearer access token。
- 服务集成使用个人中心创建的 API Key，通过 `X-Access-Key` 和 `X-Secret-Key` 请求头认证。
- 外部事件执行使用 API Key，不接受 JWT 替代。调用账号仍受其角色权限和数据范围约束。
- 不要把 API Key、Secret、access token 或真实用户凭证写入文档、代码仓库和问题截图。

## 调试与导入

1. 在本地启动 API，并按需启用 Swagger。
2. 使用当前环境提供的测试账号登录，取得 access token。
3. 在 Swagger 的 **Authorize** 中填写 token，再调用需要认证的接口。
4. 长期集成可将 `/api/docs-json` 导入 Apifox 或 Postman；生产环境的 OpenAPI 地址仅在受控环境临时开放。

## 当前接口约定

- API 路由以当前控制器实现及运行时 OpenAPI 输出为准；本文不维护手工复制的接口清单，避免与代码漂移。
- 分页、筛选、动态字段和错误结构以具体接口 schema 与 `packages/shared` 类型为准，不要将历史 Cordys 接口路径当作当前 API。
- 业务资源范围由当前登录成员的角色权限和数据范围共同决定；拥有菜单入口不代表拥有所有数据或动作权限。
- 动态字段写入规则、系统字段保护和资源转换规则以对应模块 API 校验为准。

## 外部事件

外部事件的配置、请求示例、幂等处理和审计说明见[外部事件文档](./external-events.md)。

## 相关文档

- [当前系统架构](./architecture.md)
- [开发约定](./conventions.md)
- [Prisma ORM 8 Migration 规范](./prisma-migration-policy.md)
- [Docker 发布流程](./docker-release.md)
