import type { INestApplication } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger'

const DESCRIPTION = `
微矩阵 CRM 开放接口文档。

## 认证方式

1. 调用 \`POST /api/auth/login\` 获取 \`accessToken\`（15 分钟有效，配合 \`POST /api/auth/refresh\` 刷新）
2. 长期脚本/第三方集成在「个人中心 → API Key」创建 AK/SK，并通过 \`X-Access-Key\` / \`X-Secret-Key\` 请求头调用
3. 点击右上角 **Authorize** 填入登录 accessToken（无需 Bearer 前缀），即可在线调试

## 通用约定

- **分页**：列表接口统一 \`page\`（默认 1）/ \`pageSize\`（默认 10，上限 100）参数，返回 \`{ items, total, page, pageSize }\`
- **高级筛选**：支持 \`filters\` 参数的接口传 JSON 字符串：\`[{"key":"字段key","op":"eq|ne|contains|gt|gte|lt|lte|isEmpty|notEmpty","value":...}]\`，自定义字段 key 为 \`cf_\` 前缀
- **数据范围**：列表/详情自动按登录人角色的数据范围过滤（全部/本部门及下级/本部门/仅本人/自定义部门）
- **自定义字段**：创建/更新载荷中 \`customData\` 对象携带 \`cf_*\` 键值；字段定义见「模块设置（元数据）」分组接口
- **错误响应**：统一结构 \`{ statusCode, message, error? }\`，message 为可直接展示的中文提示

## 导入到 API 工具

OpenAPI JSON 地址：\`/api/docs-json\`（Apifox / Postman / Insomnia 均可直接导入该 URL）
`.trim()

/** 按业务流程排序的分组（与控制器 @ApiTags 一一对应） */
const TAGS: [name: string, description: string][] = [
  ['认证', '登录、令牌刷新、当前用户与密码管理'],
  ['工作台', '销售简报、待办、漏斗、排行、趋势统计'],
  ['线索', '线索池、领取分配、跟进转化、导入导出'],
  ['客户', '客户全生命周期、公海、协作团队、导入导出'],
  ['联系人', '客户联系人管理'],
  ['商机', '可配置阶段、看板、赢单输单与阶段配置'],
  ['产品', '产品目录与上下架'],
  ['报价', '报价单与明细行'],
  ['合同与回款', '合同、回款计划/记录、工商抬头、发票'],
  ['订单', '合同履约订单与状态流转'],
  ['标讯', '数据源配置、关键词订阅、抓取与转线索'],
  ['审批', '审批流配置、提交、待办处理、审批记录'],
  ['跟进记录', '贯穿线索/客户/商机/合同的跟进'],
  ['消息通知', '站内信与 SSE 实时推送'],
  ['消息设置', '按业务事件配置站内消息、邮件渠道与到期通知范围'],
  ['组织架构', '部门树管理'],
  ['成员管理', '成员账号、角色部门分配、启停'],
  ['角色权限', '菜单/操作权限与数据范围'],
  ['模块设置（元数据）', '自定义字段定义（驱动动态表单/列表/筛选）'],
  ['公海/线索池规则', '超期未跟进自动回收规则'],
  ['企业设置', '企业级配置项'],
  ['系统日志', '操作日志与登录日志'],
  ['健康检查', '服务可用性探针'],
]

/** 为所有需鉴权的操作补充统一错误响应文档 */
function addGlobalErrorResponses(document: OpenAPIObject): void {
  const errorSchema = {
    type: 'object' as const,
    properties: {
      statusCode: { type: 'number' as const, example: 400 },
      message: { type: 'string' as const, example: '错误提示（可直接展示给用户）' },
      error: { type: 'string' as const, example: 'Bad Request' },
    },
  }
  document.components = document.components ?? {}
  document.components.schemas = {
    ...document.components.schemas,
    ErrorResponse: errorSchema,
  }

  const errorRef = { $ref: '#/components/schemas/ErrorResponse' }
  for (const path of Object.values(document.paths)) {
    for (const operation of Object.values(path)) {
      if (typeof operation !== 'object' || operation === null || !('responses' in operation)) {
        continue
      }
      const op = operation as {
        security?: unknown[]
        responses: Record<string, unknown>
      }
      op.responses['400'] ??= {
        description: '参数校验失败或业务规则不满足',
        content: { 'application/json': { schema: errorRef } },
      }
      // 带鉴权的接口补 401/403
      if (op.security && op.security.length > 0) {
        op.responses['401'] ??= {
          description: '未登录或令牌失效',
          content: { 'application/json': { schema: errorRef } },
        }
        op.responses['403'] ??= {
          description: '没有操作权限（缺少所需权限码）',
          content: { 'application/json': { schema: errorRef } },
        }
      }
    }
  }
}

export function setupSwagger(app: INestApplication): void {
  const builder = new DocumentBuilder()
    .setTitle('微矩阵 CRM API')
    .setDescription(DESCRIPTION)
    .setVersion('1.0.0')
    .setContact('微矩阵研发', '', '')
    .addServer('http://localhost:3000', '本地开发')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: '登录接口返回的 accessToken',
      },
      'bearer',
    )

  for (const [name, description] of TAGS) builder.addTag(name, description)

  const document = SwaggerModule.createDocument(app, builder.build(), {
    // 生成稳定的 operationId：控制器名_方法名（工具导入后可读）
    operationIdFactory: (controllerKey, methodKey) =>
      `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
  })
  addGlobalErrorResponses(document)

  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: '微矩阵 CRM API 文档',
    jsonDocumentUrl: 'api/docs-json',
    swaggerOptions: {
      // 刷新页面保留已填的令牌
      persistAuthorization: true,
      docExpansion: 'none',
      defaultModelsExpandDepth: 2,
      displayRequestDuration: true,
    },
  })
}
