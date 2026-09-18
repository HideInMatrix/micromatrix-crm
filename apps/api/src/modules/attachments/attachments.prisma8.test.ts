import assert from 'node:assert/strict'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { ConfigService } from '@nestjs/config'
import type { AuthUser } from '../../common/auth-user'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { AttachmentsService } from './attachments.service'

test('Attachments 使用 Prisma 8 保持真实磁盘 CRUD、target scope 与 domain guard 语义', async (t) => {
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
  const fixtureDb = createPrismaFixtureClient(databaseUrl)
  const prisma8 = new Prisma8Service(config)
  await fixtureDb.$connect()
  await prisma8.onModuleInit()

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const tenant = await fixtureDb.tenant.create({
    data: { name: `p8-attachment-${suffix}`, slug: `p8-attachment-${suffix}` },
  })
  const uploader = await fixtureDb.user.create({
    data: {
      tenantId: tenant.id,
      email: `attachment-${suffix}@example.com`,
      passwordHash: 'test-only',
      name: '附件上传人',
      defaultPwd: false,
    },
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
  const service = new AttachmentsService(prisma8, config)

  try {
    const first = await service.upload(
      actor,
      { originalname: 'first.txt', mimetype: 'text/plain', size: 5, buffer: Buffer.from('first') },
      'note',
      'target-a',
    )
    const second = await service.upload(
      actor,
      { originalname: 'second.txt', mimetype: 'text/plain', size: 6, buffer: Buffer.from('second') },
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
      { originalname: 'guarded.txt', mimetype: 'text/plain', size: 7, buffer: Buffer.from('guarded') },
      'resourceField:customer',
      'customer-1',
    )

    const persisted = await fixtureDb.attachment.findUnique({ where: { id: first.id } })
    assert.equal(persisted?.targetId, 'target-a')
    assert.equal(persisted?.uploaderId, uploader.id)

    assert.deepEqual((await service.list(actor, 'note', 'target-a')).map((item) => item.id), [first.id])
    const byTargets = await service.listByTargets(tenant.id, 'note', ['target-a', 'target-b'])
    assert.deepEqual(byTargets.get('target-a')?.map((item) => item.id), [first.id])
    assert.deepEqual(byTargets.get('target-b')?.map((item) => item.id), [second.id])
    assert.deepEqual(
      (await service.listByIdsFromTarget(tenant.id, [second.id, first.id], 'note', 'target-a')).map(
        (item) => item.id,
      ),
      [first.id],
    )

    await assert.rejects(() => service.download(actor, guarded.id), /必须通过所属业务数据读取/)
    assert.equal(await service.removeTemporary(tenant.id, temporary.id), true)
    assert.equal(await fixtureDb.attachment.findUnique({ where: { id: temporary.id } }), null)

    assert.equal(await service.removeFromTarget(tenant.id, first.id, 'note', 'target-a'), true)
    assert.equal(await fixtureDb.attachment.findUnique({ where: { id: first.id } }), null)
    assert.equal(await service.removeAllFromTargets(tenant.id, 'note', ['target-b']), 1)
    assert.equal(await fixtureDb.attachment.findUnique({ where: { id: second.id } }), null)
  } finally {
    await fixtureDb.attachment.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.user.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.tenant.delete({ where: { id: tenant.id } })
    await prisma8.onModuleDestroy()
    await fixtureDb.$disconnect()
    await rm(uploadDir, { recursive: true, force: true })
  }
})
