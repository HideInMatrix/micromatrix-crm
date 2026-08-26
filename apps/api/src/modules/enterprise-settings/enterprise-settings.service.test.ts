/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import type { CredentialCipherService } from '../../common/services/credential-cipher.service'
import type { PrismaService } from '../../prisma/prisma.service'
import { EnterpriseAiModelsService } from './enterprise-ai-models.service'
import { EnterpriseGlobalTasksService } from './enterprise-global-tasks.service'
import { EnterpriseMailSettingsService } from './enterprise-mail-settings.service'
import { EnterpriseTermsService } from './enterprise-terms.service'
import { EnterpriseUiSettingsService } from './enterprise-ui-settings.service'
import type { SmtpProbeService } from './smtp-probe.service'

const user: AuthUser = {
  id: 'user-a',
  tenantId: 'tenant-a',
  email: 'admin@example.com',
  name: '管理员',
  deptId: null,
  leaderId: null,
  roles: [],
  permissions: ['system:setting', 'system:setting:update'],
}

const cipher = {
  encrypt(value: string) {
    return { ciphertext: `enc:${value}`, iv: 'iv', authTag: 'tag', keyVersion: 1 }
  },
  decrypt(value: { ciphertext: string }) {
    return value.ciphertext.replace(/^enc:/, '')
  },
} as unknown as CredentialCipherService

test('公开品牌配置按 tenantSlug 读取且只暴露品牌展示状态', async () => {
  const now = new Date()
  const prisma = {
    tenant: {
      findUnique: async ({ where }: any) =>
        where.slug === 'demo' ? { id: 'tenant-a', slug: 'demo' } : null,
    },
    enterpriseUiSetting: {
      findUnique: async ({ where }: any) =>
        where.tenantId === 'tenant-a'
          ? {
              id: 'ui-a',
              tenantId: 'tenant-a',
              theme: 'custom',
              customTheme: '#123456',
              style: 'follow',
              customStyle: '#f1f2f3',
              title: '一草一木 CRM',
              slogan: '连接每一位客户',
              helpDoc: 'https://example.com/help',
              iconAttachmentId: 'icon-a',
              loginLogoAttachmentId: null,
              loginImageAttachmentId: 'image-a',
              platformLogoAttachmentId: 'logo-a',
              createdAt: now,
              updatedAt: now,
            }
          : null,
    },
  } as unknown as PrismaService
  const attachments = {} as any
  const service = new EnterpriseUiSettingsService(prisma, attachments)

  const branding = await service.getBranding('demo')
  assert.equal(branding.title, '一草一木 CRM')
  assert.equal(branding.tenantSlug, 'demo')
  assert.equal(branding.iconConfigured, true)
  assert.equal(branding.loginLogoConfigured, false)
  assert.equal(branding.loginImageConfigured, true)
  assert.equal(branding.platformLogoConfigured, true)
  assert.equal('iconAttachmentId' in branding, false)
  assert.equal('platformLogoAttachmentId' in branding, false)
})

test('SMTP 密码加密保存、留空保留且响应不回显秘密材料', async () => {
  let row: any = null
  const mail = {
    findUnique: async ({ where }: any) => (row?.tenantId === where.tenantId ? row : null),
    upsert: async ({ create, update }: any) => {
      const now = new Date()
      row = row
        ? { ...row, ...update, updatedAt: now }
        : {
            id: 'mail-a',
            ...create,
            lastTestSucceeded: null,
            lastTestMessage: null,
            lastTestedAt: null,
            createdAt: now,
            updatedAt: now,
          }
      return row
    },
    update: async ({ data }: any) => {
      row = { ...row, ...data, updatedAt: new Date() }
      return row
    },
  }
  const prisma = { enterpriseMailSetting: mail } as unknown as PrismaService
  const probe = { test: async () => undefined } as unknown as SmtpProbeService
  const service = new EnterpriseMailSettingsService(prisma, cipher, probe)
  const base = {
    host: 'smtp.example.com',
    port: 465,
    account: 'mailer@example.com',
    from: 'mailer@example.com',
    recipient: 'admin@example.com',
    ssl: true,
    tls: false,
  }

  const first = await service.save(user, { ...base, password: 'plain-secret' })
  assert.equal(first.passwordConfigured, true)
  assert.equal('passwordCiphertext' in first, false)
  assert.equal(row.passwordCiphertext, 'enc:plain-secret')

  const originalCiphertext = row.passwordCiphertext
  const second = await service.save(user, { ...base, password: '' })
  assert.equal(second.passwordConfigured, true)
  assert.equal(row.passwordCiphertext, originalCiphertext)
  await assert.rejects(() => service.save(user, { ...base, tls: true }), BadRequestException)
})

test('AI 模型 API Key 留空保留，路由策略只接受当前租户真实模型并保持顺序', async () => {
  const now = new Date()
  const models: any[] = []
  let routes: any[] = []
  const enterpriseAiModel = {
    findFirst: async ({ where }: any) => {
      return (
        models.find((item) => {
          if (where.id && item.id !== where.id) return false
          if (where.tenantId && item.tenantId !== where.tenantId) return false
          if (where.displayName && item.displayName !== where.displayName) return false
          if (where.id?.not && item.id === where.id.not) return false
          return true
        }) ?? null
      )
    },
    findMany: async ({ where }: any) => {
      return models.filter((item) => {
        if (where.tenantId && item.tenantId !== where.tenantId) return false
        if (where.id?.in && !where.id.in.includes(item.id)) return false
        if (where.enable !== undefined && item.enable !== where.enable) return false
        return true
      })
    },
    create: async ({ data }: any) => {
      const row = { id: `model-${models.length + 1}`, ...data, createdAt: now, updatedAt: now }
      models.push(row)
      return row
    },
    update: async ({ where, data }: any) => {
      const row = models.find((item) => item.id === where.id)
      Object.assign(row, data, { updatedAt: new Date() })
      return row
    },
  }
  const tx = {
    enterpriseAiModelRoute: {
      deleteMany: async ({ where }: any) => {
        routes = routes.filter((item) => item.tenantId !== where.tenantId)
      },
      createMany: async ({ data }: any) => {
        routes.push(...data)
      },
    },
  }
  const prismaMock: any = {
    enterpriseAiModel,
    enterpriseAiModelRoute: {
      findMany: async ({ where }: any) =>
        routes.filter((item) => item.tenantId === where.tenantId).sort((a, b) => a.sort - b.sort),
    },
    $transaction: async (callback: any) => callback(tx),
  }
  const service = new EnterpriseAiModelsService(prismaMock as PrismaService, cipher)
  const input = {
    displayName: '主模型',
    modelName: 'gpt-test',
    provider: 'OpenAI' as const,
    apiUrl: 'https://api.example.com/v1',
    apiKey: 'secret-key',
    enable: true,
    temperature: 0.7,
    maxTokens: 2048,
    topP: 0.9,
  }
  const created = await service.create(user, input)
  assert.equal(created.apiKeyConfigured, true)
  assert.equal(models[0].apiKeyCiphertext, 'enc:secret-key')
  const oldCiphertext = models[0].apiKeyCiphertext
  await service.update(user, created.id, { ...input, apiKey: '' })
  assert.equal(models[0].apiKeyCiphertext, oldCiphertext)

  models.push({ ...models[0], id: 'model-2', displayName: '备用模型' })
  assert.deepEqual(await service.updateRouteStrategy('tenant-a', ['model-2', created.id]), {
    modelIds: ['model-2', created.id],
  })
  assert.deepEqual(
    routes.map((item) => item.modelId),
    ['model-2', created.id],
  )
  await assert.rejects(
    () => service.updateRouteStrategy('tenant-a', [created.id, 'missing-model']),
    BadRequestException,
  )
})

test('术语发现只能处理一次，采纳在同一事务创建术语并回写 ADOPTED', async () => {
  const now = new Date()
  const category = {
    id: 'category-a',
    tenantId: 'tenant-a',
    name: '销售',
    sort: 0,
    createdAt: now,
    updatedAt: now,
  }
  const discovery: any = {
    id: 'discovery-a',
    tenantId: 'tenant-a',
    discovered: 'GMV',
    source: 'AI',
    context: '合同分析',
    status: 'PENDING',
    adoptedTermId: null,
    createdAt: now,
    updatedAt: now,
  }
  let term: any = null
  const prismaMock: any = {
    enterpriseTermCategory: {
      findFirst: async ({ where }: any) =>
        where.id === category.id && where.tenantId === category.tenantId ? category : null,
    },
    enterpriseTerm: {
      findFirst: async () => null,
      create: async ({ data }: any) => {
        term = {
          id: 'term-a',
          ...data,
          category: { name: category.name },
          createdAt: now,
          updatedAt: now,
        }
        return term
      },
    },
    enterpriseTermDiscovery: {
      findFirst: async ({ where }: any) =>
        where.id === discovery.id && where.tenantId === discovery.tenantId ? discovery : null,
      update: async ({ data }: any) => {
        Object.assign(discovery, data, { updatedAt: new Date() })
        return discovery
      },
    },
  }
  prismaMock.$transaction = async (callback: any) => callback(prismaMock)
  const service = new EnterpriseTermsService(prismaMock as PrismaService)
  const adopted = await service.adoptDiscovery(user, discovery.id, {
    categoryId: category.id,
    standardTerm: 'GMV',
    alsoCalled: '成交总额',
    enable: true,
  })
  assert.equal(adopted.id, 'term-a')
  assert.equal(term.tenantId, 'tenant-a')
  assert.equal(discovery.status, 'ADOPTED')
  assert.equal(discovery.adoptedTermId, 'term-a')
  await assert.rejects(
    () =>
      service.adoptDiscovery(user, discovery.id, {
        categoryId: category.id,
        standardTerm: 'GMV',
        enable: true,
      }),
    /已处理/,
  )
  await assert.rejects(() => service.ignoreDiscovery('tenant-a', discovery.id), /已处理/)
})

test('全局任务执行记录必须先停止再删除，且跨租户不可操作', async () => {
  const now = new Date()
  const executions: any[] = [
    {
      id: 'execution-running',
      tenantId: 'tenant-a',
      taskId: 'task-a',
      task: { name: '巡检任务' },
      status: 'RUNNING',
      input: null,
      output: null,
      errorMessage: null,
      startedAt: now,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'execution-other-tenant',
      tenantId: 'tenant-b',
      taskId: 'task-b',
      task: { name: '其他租户任务' },
      status: 'SUCCEEDED',
      input: null,
      output: null,
      errorMessage: null,
      startedAt: now,
      finishedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  ]
  const prisma = {
    enterpriseGlobalTaskExecution: {
      findFirst: async ({ where }: any) =>
        executions.find((item) => item.id === where.id && item.tenantId === where.tenantId) ?? null,
      update: async ({ where, data }: any) => {
        const row = executions.find((item) => item.id === where.id)
        Object.assign(row, data, { updatedAt: new Date() })
        return row
      },
      delete: async ({ where }: any) => {
        const index = executions.findIndex((item) => item.id === where.id)
        return executions.splice(index, 1)[0]
      },
    },
  } as unknown as PrismaService
  const service = new EnterpriseGlobalTasksService(prisma)

  await assert.rejects(() => service.removeExecution('tenant-a', 'execution-running'), /请先停止/)
  const stopped = await service.stopExecution('tenant-a', 'execution-running')
  assert.equal(stopped.status, 'STOPPED')
  assert.ok(stopped.finishedAt)
  assert.deepEqual(await service.removeExecution('tenant-a', 'execution-running'), {
    id: 'execution-running',
  })
  await assert.rejects(
    () => service.removeExecution('tenant-a', 'execution-other-tenant'),
    /执行记录不存在/,
  )
})
