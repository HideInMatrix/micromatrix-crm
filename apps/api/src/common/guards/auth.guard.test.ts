import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { UnauthorizedException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type { ExecutionContext, Type } from '@nestjs/common'
import type { Reflector } from '@nestjs/core'
import type { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import type { PrismaService } from '../../prisma/prisma.service'
import { nowInstant, instantFromDate } from '../../prisma/temporal'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator'
import type { AuthContextCacheService } from '../services/auth-context-cache.service'
import { AuthGuard } from './auth.guard'

const databaseUrl = process.env['DATABASE_URL']

function executionContext(request: Request): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class TestController {} as Type<unknown>,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext
}

test(
  'AuthGuard 使用 Prisma 校验 API Key 并显式装配 User/UserRole/Role',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prismaClient = testDb.client
    const suffix = randomUUID().replaceAll('-', '')

    let tenantId: string | null = null
    let userId: string | null = null
    try {
      const tenant = await createPrismaTestTenant(prismaClient, 'p8-auth-guard')
      tenantId = tenant.id
      const user = await createPrismaTestUser(prismaClient, {
        tenantId: tenant.id,
        name: 'API User',
        email: `api-${suffix}@example.com`,
      })
      userId = user.id
      const role = await prismaClient.orm.public.Roles.select(
        'id',
        'name',
        'permissions',
        'dataScope',
        'scopeDeptIds',
      ).create({
        tenantId: tenant.id,
        name: `API Role ${suffix}`,
        permissions: ['menu:customer', 'customer:read'],
        dataScope: 'CUSTOM',
        scopeDeptIds: [],
        updatedAt: nowInstant(),
      })
      await prismaClient.orm.public.UserRoles.create({
        tenantId: tenant.id,
        userId: user.id,
        roleId: role.id,
        updatedAt: nowInstant(),
      })
      const apiKey = await prismaClient.orm.public.UserKey.select(
        'id',
        'accessKey',
        'secretKey',
      ).create({
        createUser: user.id,
        accessKey: `ak_${suffix}`,
        secretKey: `sk_${suffix}`,
        forever: true,
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
        { client: prismaClient } as PrismaService,
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

      await prismaClient.orm.public.UserKey.where({ id: apiKey.id }).update({
        forever: false,
        expireTime: instantFromDate(new Date('2020-01-01T00:00:00.000Z')),
      })
      await assert.rejects(
        () => guard.canActivate(executionContext(request)),
        (error) => error instanceof UnauthorizedException,
      )
    } finally {
      if (userId) await prismaClient.orm.public.UserKey.where({ createUser: userId }).deleteAll()
      if (tenantId) {
        await prismaClient.orm.public.UserRoles.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.Roles.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.Users.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
