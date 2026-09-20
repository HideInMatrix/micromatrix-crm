import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { ConfigService } from '@nestjs/config'
import type { AuthUser } from '../../common/auth-user'
import type { PrismaService } from '../../prisma/prisma.service'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { AttachmentsService } from './attachments.service'

test('Attachments 使用 Prisma 保持真实磁盘 CRUD、target scope 与 domain guard 语义', async (t) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) return t.skip('DATABASE_URL 未配置')

  const uploadDir = await mkdtemp(path.join(tmpdir(), 'mmx-p8-attachments-'))
  const config = {
    getOrThrow: (key: string) => {
      if (key === 'DATABASE_URL') return databaseUrl
      throw new Error(`unknown config ${key}`)
    },
    get: (key: string) => (key === 'UPLOAD_DIR' ? uploadDir : undefined),
  } as unknown as ConfigService
  const testDb = await openPrismaTestDatabase(databaseUrl)
  const prismaClient = testDb.client
  const prisma = { client: prismaClient } as PrismaService

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const tenant = await createPrismaTestTenant(prismaClient, 'p8-attachment')
  const uploader = await createPrismaTestUser(prismaClient, {
    tenantId: tenant.id,
    email: `attachment-${suffix}@example.com`,
    passwordHash: 'test-only',
    name: '附件上传人',
  })
  const actor: AuthUser = {
    id: uploader.id,
    tenantId: tenant.id,
    email: uploader.email,
    name: uploader.name,
    deptId: null,
    leaderId: null,
    roles: [],
    permissions: [],
  }
  const service = new AttachmentsService(prisma, config)

  try {
    const first = await service.upload(
      actor,
      { originalname: 'first.txt', mimetype: 'text/plain', size: 5, buffer: Buffer.from('first') },
      'note',
      'target-a',
    )
    const second = await service.upload(
      actor,
      {
        originalname: 'second.txt',
        mimetype: 'text/plain',
        size: 6,
        buffer: Buffer.from('second'),
      },
      'note',
      'target-b',
    )
    const temporary = await service.upload(actor, {
      originalname: 'temp.txt',
      mimetype: 'text/plain',
      size: 4,
      buffer: Buffer.from('temp'),
    })
    const guarded = await service.upload(
      actor,
      {
        originalname: 'guarded.txt',
        mimetype: 'text/plain',
        size: 7,
        buffer: Buffer.from('guarded'),
      },
      'resourceField:customer',
      'customer-1',
    )

    const persisted = await prismaClient.orm.public.Attachments.where({ id: first.id }).first()
    assert.equal(persisted?.targetId, 'target-a')
    assert.equal(persisted?.uploaderId, uploader.id)

    assert.deepEqual(
      (await service.list(actor, 'note', 'target-a')).map((item) => item.id),
      [first.id],
    )
    const byTargets = await service.listByTargets(tenant.id, 'note', ['target-a', 'target-b'])
    assert.deepEqual(
      byTargets.get('target-a')?.map((item) => item.id),
      [first.id],
    )
    assert.deepEqual(
      byTargets.get('target-b')?.map((item) => item.id),
      [second.id],
    )
    assert.deepEqual(
      (await service.listByIdsFromTarget(tenant.id, [second.id, first.id], 'note', 'target-a')).map(
        (item) => item.id,
      ),
      [first.id],
    )

    await assert.rejects(() => service.download(actor, guarded.id), /必须通过所属业务数据读取/)
    assert.equal(await service.removeTemporary(tenant.id, temporary.id), true)
    assert.equal(
      await prismaClient.orm.public.Attachments.where({ id: temporary.id }).select('id').first(),
      null,
    )

    assert.equal(await service.removeFromTarget(tenant.id, first.id, 'note', 'target-a'), true)
    assert.equal(
      await prismaClient.orm.public.Attachments.where({ id: first.id }).select('id').first(),
      null,
    )
    assert.equal(await service.removeAllFromTargets(tenant.id, 'note', ['target-b']), 1)
    assert.equal(
      await prismaClient.orm.public.Attachments.where({ id: second.id }).select('id').first(),
      null,
    )
  } finally {
    await prismaClient.orm.public.Attachments.where({ tenantId: tenant.id }).deleteAll()
    await prismaClient.orm.public.Users.where({ tenantId: tenant.id }).deleteAll()
    await prismaClient.orm.public.Tenants.where({ id: tenant.id }).deleteAll()
    await testDb.close()
    await rm(uploadDir, { recursive: true, force: true })
  }
})
