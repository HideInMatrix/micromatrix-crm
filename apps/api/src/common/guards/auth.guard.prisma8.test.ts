import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { UnauthorizedException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type { ExecutionContext, Type } from '@nestjs/common'
import type { Reflector } from '@nestjs/core'
import type { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator'
import type { AuthContextCacheService } from '../services/auth-context-cache.service'
import { AuthGuard } from './auth.guard'

const databaseUrl = process.env['DATABASE_URL']

function executionContext(request: Request): ExecutionContext {
  return {
    getHandler: () => (() => undefined),
    getClass: () => class TestController {} as Type<unknown>,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext
}

test(
  'AuthGuard 使用 Prisma 8 校验 API Key 并显式装配 User/UserRole/Role',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const suffix = randomUUID().replaceAll('-', '')

    await fixtureDb.$connect()
    await prisma8Client.connect()
    let tenantId: string | null = null
    try {
      const tenant = await fixtureDb.tenant.create({
        data: { name: `Prisma8 auth guard ${suffix}`, slug: `p8-auth-${suffix}` },
      })
      tenantId = tenant.id
      const user = await fixtureDb.user.create({
        data: {
          tenantId: tenant.id,
          name: 'API User',
          email: `api-${suffix}@example.com`,
          passwordHash: 'not-used',
        },
      })
      const role = await fixtureDb.role.create({
        data: {
          tenantId: tenant.id,
          name: `API Role ${suffix}`,
          permissions: ['menu:customer', 'customer:read'],
          dataScope: 'CUSTOM',
          scopeDeptIds: [],
        },
      })
      await fixtureDb.userRole.create({
        data: { tenantId: tenant.id, userId: user.id, roleId: role.id },
      })
      const apiKey = await fixtureDb.userApiKey.create({
        data: {
          userId: user.id,
          accessKey: `ak_${suffix}`,
          secretKey: `sk_${suffix}`,
          forever: true,
        },
      })

      let cachedUserId: string | null = null
      const cache = {
        get: async () => null,
        set: async (userId: string) => {
          cachedUserId = userId
        },
      } as unknown as AuthContextCacheService
      const reflector = {
        getAllAndOverride: (key: unknown) => (key === IS_PUBLIC_KEY ? false : []),
      } as unknown as Reflector
      const guard = new AuthGuard(
        {} as JwtService,
        reflector,
        {} as ConfigService,
        { client: prisma8Client } as Prisma8Service,
        cache,
      )
      const request = {
        headers: {
          'x-access-key': apiKey.accessKey,
          'x-secret-key': apiKey.secretKey,
        },
      } as unknown as Request

      assert.equal(await guard.canActivate(executionContext(request)), true)
      assert.equal(cachedUserId, user.id)
      assert.equal(request.user?.id, user.id)
      assert.equal(request.user?.tenantId, tenant.id)
      assert.deepEqual(request.user?.permissions.sort(), ['customer:read', 'menu:customer'])
      assert.equal(request.user?.roles[0]?.dataScope, 'CUSTOM')

      await fixtureDb.userApiKey.update({
        where: { id: apiKey.id },
        data: { forever: false, expireAt: new Date('2020-01-01T00:00:00.000Z') },
      })
      await assert.rejects(
        () => guard.canActivate(executionContext(request)),
        (error) => error instanceof UnauthorizedException,
      )
    } finally {
      if (tenantId) {
        await fixtureDb.userApiKey.deleteMany({ where: { user: { tenantId } } })
        await fixtureDb.userRole.deleteMany({ where: { tenantId } })
        await fixtureDb.role.deleteMany({ where: { tenantId } })
        await fixtureDb.user.deleteMany({ where: { tenantId } })
        await fixtureDb.tenant.deleteMany({ where: { id: tenantId } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
