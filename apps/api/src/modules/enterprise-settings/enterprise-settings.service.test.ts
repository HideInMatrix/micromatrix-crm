/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import type { CredentialCipherService } from '../../common/services/credential-cipher.service'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Now, prisma8TimestampToDate } from '../../prisma/prisma8-temporal'
import { createPrismaTestTenant, openPrismaTestDatabase } from '../../testing/prisma-test-db'
import { EnterpriseAiModelsService } from './enterprise-ai-models.service'
import { EnterpriseAiRuntimeService } from './enterprise-ai-runtime.service'
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

const databaseUrl = process.env['DATABASE_URL']

test('AI runtime 使用 Prisma 8 按租户读取模型且保持 provider 请求契约', async () => {
  const whereCalls: unknown[] = []
  const selectCalls: string[][] = []
  const collection = {
    where(input: unknown) {
      whereCalls.push(input)
      return this
    },
    select(...fields: string[]) {
      selectCalls.push(fields)
      return this
    },
    async first() {
      return {
        id: 'model-a',
        displayName: 'GPT Test',
        modelName: 'gpt-test',
        provider: 'OpenAI',
        apiUrl: 'https://ai.example/v1',
        apiKeyCiphertext: 'enc:secret-key',
        apiKeyIv: 'iv',
        apiKeyAuthTag: 'tag',
        apiKeyKeyVersion: 1,
        enable: true,
        temperature: 0.2,
        maxTokens: 1024,
        topP: 0.9,
      }
    },
  }
  const prisma8 = {
    client: { orm: { public: { EnterpriseAiModels: collection } } },
  } as unknown as Prisma8Service
  const service = new EnterpriseAiRuntimeService(prisma8, cipher)
  const originalFetch = globalThis.fetch
  let requestUrl = ''
  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestUrl = String(input)
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  try {
    const result = await service.complete('tenant-a', 'model-a', 'hello', 512)
    assert.deepEqual(whereCalls, [{ id: 'model-a', tenantId: 'tenant-a' }])
    assert.equal(selectCalls.length, 1)
    assert.equal(selectCalls[0]?.includes('createdAt'), false)
    assert.equal(selectCalls[0]?.includes('updatedAt'), false)
    assert.equal(requestUrl, 'https://ai.example/v1/chat/completions')
    assert.equal(requestBody?.model, 'gpt-test')
    assert.equal(requestBody?.max_tokens, 512)
    assert.equal(result.text, 'ok')
    assert.equal(result.modelId, 'model-a')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('公开品牌配置按 tenantSlug 读取且只暴露品牌展示状态', async () => {
  const now = prisma8Now()
  const setting = {
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
  const prisma8 = {
    client: {
      orm: {
        public: {
          Tenants: {
            where: ({ slug }: { slug?: string }) => ({
              select: () => ({ first: async () => (slug === 'demo' ? { id: 'tenant-a', slug: 'demo' } : null) }),
            }),
          },
          EnterpriseUiSettings: {
            where: ({ tenantId }: { tenantId?: string }) => ({
              first: async () => (tenantId === 'tenant-a' ? setting : null),
            }),
          },
        },
      },
    },
  } as unknown as Prisma8Service
  const attachments = {} as any
  const service = new EnterpriseUiSettingsService(prisma8, attachments)

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

test('登录页品牌配置可在未登录时按邮箱解析所属租户', async () => {
  const now = prisma8Now()
  const setting = {
    id: 'ui-a',
    tenantId: 'tenant-a',
    theme: 'default',
    customTheme: '#008d91',
    style: 'default',
    customStyle: '#f9fbfb',
    title: '一草一木 CRM',
    slogan: '连接每一位客户',
    helpDoc: '',
    iconAttachmentId: null,
    loginLogoAttachmentId: null,
    loginImageAttachmentId: null,
    platformLogoAttachmentId: null,
    createdAt: now,
    updatedAt: now,
  }
  const prisma8 = {
    client: {
      orm: {
        public: {
          Users: {
            where: () => ({ select: () => ({ first: async () => ({ tenantId: 'tenant-a' }) }) }),
          },
          Tenants: {
            where: ({ id }: { id?: string }) => ({
              select: () => ({
                first: async () =>
                  id === 'tenant-a'
                    ? { id: 'tenant-a', slug: 'demo', status: 'ACTIVE' }
                    : null,
              }),
            }),
          },
          EnterpriseUiSettings: {
            where: ({ tenantId }: { tenantId?: string }) => ({
              first: async () => (tenantId === 'tenant-a' ? setting : null),
            }),
          },
        },
      },
    },
  } as unknown as Prisma8Service
  const service = new EnterpriseUiSettingsService(prisma8, {} as any)

  const branding = await service.getLoginBranding({ email: 'admin@demo.com' })
  assert.equal(branding.tenantSlug, 'demo')
  assert.equal(branding.title, '一草一木 CRM')
})

test('SMTP 密码加密保存、留空保留且响应不回显秘密材料', async () => {
  let row: any = null
  const mail = {
    create: async (data: any) => {
      if (row) {
        const error = new Error('duplicate tenant')
        ;(error as { sqlState?: string }).sqlState = '23505'
        throw error
      }
      row = {
        id: 'mail-a',
        ...data,
        lastTestSucceeded: null,
        lastTestMessage: null,
        lastTestedAt: null,
        createdAt: prisma8Now(),
        updatedAt: prisma8Now(),
      }
      return row
    },
    where: (where: any) => ({
      first: async () => {
        if (!row) return null
        if (where.tenantId && row.tenantId !== where.tenantId) return null
        if (where.id && row.id !== where.id) return null
        return row
      },
      update: async (data: any) => {
        if (!row) return null
        if (where.tenantId && row.tenantId !== where.tenantId) return null
        if (where.id && row.id !== where.id) return null
        row = { ...row, ...data, updatedAt: prisma8Now() }
        return row
      },
    }),
  }
  const prisma8 = {
    client: { orm: { public: { EnterpriseMailSettings: mail } } },
  } as unknown as Prisma8Service
  const probe = { test: async () => undefined } as unknown as SmtpProbeService
  const service = new EnterpriseMailSettingsService(prisma8, cipher, probe)
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

test(
  'SMTP 设置通过 Prisma 8 写入并保持 fixture readback 一致',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client
    const prisma8 = { client: prisma8Client } as Prisma8Service
    let tenantId = ''
    let probedPassword = ''
    const probe = {
      test: async ({ password }: { password: string }) => {
        probedPassword = password
      },
    } as unknown as SmtpProbeService
    const service = new EnterpriseMailSettingsService(prisma8, cipher, probe)
    const base = {
      host: 'smtp.example.com',
      port: 465,
      account: 'mailer@example.com',
      from: 'mailer@example.com',
      recipient: 'admin@example.com',
      ssl: true,
      tls: false,
    }

    try {
      const createdTenant = await createPrismaTestTenant(prisma8Client, 'prisma8-mail')
      tenantId = createdTenant.id
      const integrationUser = { ...user, tenantId }

      const first = await service.save(integrationUser, {
        ...base,
        password: 'integration-secret',
      })
      assert.equal(first.passwordConfigured, true)
      assert.equal('passwordCiphertext' in first, false)

      const firstDb = await prisma8Client.orm.public.EnterpriseMailSettings.where({ tenantId }).first()
      assert.ok(firstDb)
      assert.ok(firstDb.id)
      assert.equal(firstDb.passwordCiphertext, 'enc:integration-secret')

      await new Promise((resolve) => setTimeout(resolve, 20))
      await service.save(integrationUser, { ...base, password: '' })
      const secondDb = await prisma8Client.orm.public.EnterpriseMailSettings.where({ tenantId }).first()
      assert.ok(secondDb)
      assert.equal(secondDb.passwordCiphertext, firstDb.passwordCiphertext)
      assert.equal(
        prisma8TimestampToDate(secondDb.updatedAt).getTime() >
          prisma8TimestampToDate(firstDb.updatedAt).getTime(),
        true,
      )

      const tested = await service.test(integrationUser, { ...base, password: '' })
      assert.equal(tested.success, true)
      assert.equal(probedPassword, 'integration-secret')
      const testedDb = await prisma8Client.orm.public.EnterpriseMailSettings.where({ tenantId }).first()
      assert.ok(testedDb)
      assert.equal(testedDb?.lastTestSucceeded, true)
      assert.equal(testedDb?.lastTestMessage, 'SMTP 连接与认证成功')
      assert.ok(testedDb?.lastTestedAt)
    } finally {
      if (tenantId) {
        await prisma8Client.orm.public.EnterpriseMailSettings.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)

test('AI 模型 API Key 留空保留，路由策略只接受当前租户真实模型并保持顺序', async () => {
  const now = prisma8Now()
  const models: any[] = []
  let routes: any[] = []
  type Predicate = (row: any) => boolean

  const fields = new Proxy(
    {},
    {
      get: (_target, key: string) => ({
        eq: (value: unknown): Predicate => (row) => row[key] === value,
        neq: (value: unknown): Predicate => (row) => row[key] !== value,
        in: (values: unknown[]): Predicate => (row) => values.includes(row[key]),
      }),
    },
  )
  const toPredicate = (where: any): Predicate => {
    if (typeof where === 'function') return where(fields)
    return (row) => Object.entries(where).every(([key, value]) => row[key] === value)
  }
  const project = (row: any, selected?: string[]) => {
    if (!row || !selected) return row
    return Object.fromEntries(selected.map((field) => [field, row[field]]))
  }
  const modelCollection = (predicates: Predicate[] = [], selected?: string[]): any => ({
    where(where: any) {
      return modelCollection([...predicates, toPredicate(where)], selected)
    },
    select(...fieldsToSelect: string[]) {
      return modelCollection(predicates, fieldsToSelect)
    },
    async first() {
      return project(models.find((row) => predicates.every((predicate) => predicate(row))) ?? null, selected)
    },
    async all() {
      return models
        .filter((row) => predicates.every((predicate) => predicate(row)))
        .map((row) => project(row, selected))
    },
    async create(data: any) {
      const row = {
        id: `model-${models.length + 1}`,
        apiKeyCiphertext: null,
        apiKeyIv: null,
        apiKeyAuthTag: null,
        apiKeyKeyVersion: null,
        ...data,
        createdAt: now,
      }
      models.push(row)
      return project(row, selected)
    },
    async update(data: any) {
      const row = models.find((item) => predicates.every((predicate) => predicate(item)))
      if (!row) return null
      Object.assign(row, data)
      return project(row, selected)
    },
  })
  const routeCollection = (predicates: Predicate[] = []): any => ({
    where(where: any) {
      return routeCollection([...predicates, toPredicate(where)])
    },
    async deleteAll() {
      const deleted = routes.filter((row) => predicates.every((predicate) => predicate(row)))
      routes = routes.filter((row) => !predicates.every((predicate) => predicate(row)))
      return deleted
    },
    async createAll(data: any[]) {
      const created = data.map((item, index) => ({
        id: `route-${routes.length + index + 1}`,
        ...item,
        createdAt: now,
      }))
      routes.push(...created)
      return created
    },
  })
  const orm = {
    public: {
      EnterpriseAiModels: modelCollection(),
      EnterpriseAiModelRoutes: routeCollection(),
    },
  }
  const prisma8 = {
    client: {
      orm,
      transaction: async (callback: any) => callback({ orm }),
    },
  } as unknown as Prisma8Service
  const service = new EnterpriseAiModelsService(prisma8, cipher)
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

test(
  'AI 模型 Prisma 8 transaction/createAll 写入保持 fixture readback 一致',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client
    const prisma8 = { client: prisma8Client } as Prisma8Service
    let tenantId = ''
    const service = new EnterpriseAiModelsService(prisma8, cipher)
    const base = {
      modelName: 'gpt-test',
      provider: 'OpenAI' as const,
      apiUrl: 'https://api.example.com/v1',
      enable: true,
      temperature: 0.7,
      maxTokens: 2048,
      topP: 0.9,
    }

    try {
      const createdTenant = await createPrismaTestTenant(prisma8Client, 'prisma8-ai-models')
      tenantId = createdTenant.id
      const integrationUser = { ...user, tenantId }

      const primary = await service.create(integrationUser, {
        ...base,
        displayName: '主模型',
        apiKey: 'integration-secret',
      })
      const secondary = await service.create(integrationUser, {
        ...base,
        displayName: '备用模型',
        apiKey: 'secondary-secret',
      })

      const keywordRows = await service.list(tenantId, '备用')
      assert.deepEqual(
        keywordRows.map((row) => row.id),
        [secondary.id],
      )

      const primaryDb = await prisma8Client.orm.public.EnterpriseAiModels.where({
        id: primary.id,
      }).first()
      assert.ok(primaryDb)
      assert.equal(primaryDb.tenantId, tenantId)
      assert.equal(primaryDb.apiKeyCiphertext, 'enc:integration-secret')
      assert.ok(primaryDb.updatedAt)

      await new Promise((resolve) => setTimeout(resolve, 20))
      await service.update(integrationUser, primary.id, {
        ...base,
        displayName: '主模型',
        apiKey: '',
      })
      const updatedDb = await prisma8Client.orm.public.EnterpriseAiModels.where({
        id: primary.id,
      }).first()
      assert.ok(updatedDb)
      assert.equal(updatedDb.apiKeyCiphertext, primaryDb.apiKeyCiphertext)
      assert.equal(
        prisma8TimestampToDate(updatedDb.updatedAt).getTime() >
          prisma8TimestampToDate(primaryDb.updatedAt).getTime(),
        true,
      )

      await service.updateRouteStrategy(tenantId, [secondary.id, primary.id])
      const routeDb = await prisma8Client.orm.public.EnterpriseAiModelRoutes.where({ tenantId })
        .orderBy((row) => row.sort.asc())
        .all()
      assert.deepEqual(
        routeDb.map((route) => route.modelId),
        [secondary.id, primary.id],
      )
      assert.equal(routeDb.length, 2)
      assert.equal(routeDb.every((route) => Boolean(route.id) && Boolean(route.updatedAt)), true)
      assert.deepEqual(await service.getRouteStrategy(tenantId), {
        modelIds: [secondary.id, primary.id],
      })

      await service.remove(tenantId, secondary.id)
      const secondaryDb = await prisma8Client.orm.public.EnterpriseAiModels.where({
        id: secondary.id,
      }).first()
      const routesAfterRemove = await prisma8Client.orm.public.EnterpriseAiModelRoutes.where({
        tenantId,
      })
        .orderBy((row) => row.sort.asc())
        .all()
      assert.equal(secondaryDb, null)
      assert.deepEqual(
        routesAfterRemove.map((route) => route.modelId),
        [primary.id],
      )
    } finally {
      if (tenantId) {
        await prisma8Client.orm.public.EnterpriseAiModelRoutes.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.EnterpriseAiModels.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)

test('术语发现只能处理一次，采纳在同一事务创建术语并回写 ADOPTED', async () => {
  const now = prisma8Now()
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
  const categories = {
    where: ({ id, tenantId }: { id?: string; tenantId?: string }) => ({
      first: async () =>
        (!id || id === category.id) && (!tenantId || tenantId === category.tenantId) ? category : null,
    }),
  }
  const terms = {
    where: () => ({ select: () => ({ first: async () => null }) }),
    create: async (data: any) => {
      term = { id: 'term-a', ...data, createdAt: now, updatedAt: data.updatedAt ?? now }
      return term
    },
  }
  const discoveries = {
    where: ({ id, tenantId }: { id?: string; tenantId?: string }) => ({
      first: async () =>
        (!id || id === discovery.id) && (!tenantId || tenantId === discovery.tenantId)
          ? discovery
          : null,
      update: async (data: any) => {
        Object.assign(discovery, data)
        return discovery
      },
    }),
  }
  const orm = {
    public: {
      EnterpriseTermCategories: categories,
      EnterpriseTerms: terms,
      EnterpriseTermDiscoveries: discoveries,
    },
  }
  const prisma8 = {
    client: {
      orm,
      transaction: async (callback: (tx: { orm: typeof orm }) => Promise<unknown>) => callback({ orm }),
    },
  } as unknown as Prisma8Service
  const service = new EnterpriseTermsService(prisma8)
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
  const now = prisma8Now()
  const executions: any[] = [
    {
      id: 'execution-running',
      tenantId: 'tenant-a',
      taskId: 'task-a',
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
  const executionCollection = (criteria: Record<string, unknown> = {}) => ({
    where(next: Record<string, unknown>) {
      return executionCollection({ ...criteria, ...next })
    },
    async first() {
      return (
        executions.find((item) =>
          Object.entries(criteria).every(([key, value]) => item[key] === value),
        ) ?? null
      )
    },
    async update(data: Record<string, unknown>) {
      const row = executions.find((item) =>
        Object.entries(criteria).every(([key, value]) => item[key] === value),
      )
      if (!row) return null
      Object.assign(row, data)
      return row
    },
    async delete() {
      const index = executions.findIndex((item) =>
        Object.entries(criteria).every(([key, value]) => item[key] === value),
      )
      return index >= 0 ? executions.splice(index, 1)[0] : null
    },
  })
  const tasks = [
    { id: 'task-a', name: '巡检任务' },
    { id: 'task-b', name: '其他租户任务' },
  ]
  const prisma8 = {
    client: {
      orm: {
        public: {
          EnterpriseGlobalTaskExecutions: executionCollection(),
          EnterpriseGlobalTasks: {
            where: () => ({
              select: () => ({ all: async () => tasks }),
            }),
          },
        },
      },
    },
  } as unknown as Prisma8Service
  const service = new EnterpriseGlobalTasksService(prisma8, {
    complete: async () => {
      throw new Error('本测试不应调用 AI runtime')
    },
  } as never)

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
