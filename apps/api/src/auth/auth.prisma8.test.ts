import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { UnauthorizedException } from '@nestjs/common'
import type { Prisma8Service } from '../prisma/prisma8.service'
import { openPrismaTestDatabase } from '../testing/prisma-test-db'
import type { AuthContextCacheService } from '../common/services/auth-context-cache.service'
import { AuthService } from './auth.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'AuthService 使用 Prisma 8 保持注册、登录、refresh、改密与 LoginLog 会话语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client
    const suffix = randomUUID().replaceAll('-', '')
    const email = `p8-auth-${suffix}@example.com`
    const tenantName = `Prisma8 Auth ${suffix.slice(0, 8)}`
    const secrets: Record<string, string> = {
      JWT_ACCESS_SECRET: `access-${suffix}`,
      JWT_REFRESH_SECRET: `refresh-${suffix}`,
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
    }
    const config = {
      get: (key: string) => secrets[key],
      getOrThrow: (key: string) => {
        const value = secrets[key]
        if (!value) throw new Error(`missing ${key}`)
        return value
      },
    } as unknown as ConfigService
    const invalidated: string[] = []
    const authCache = {
      invalidate: async (userId: string) => {
        invalidated.push(userId)
        return true
      },
    } as unknown as AuthContextCacheService
    const service = new AuthService(
      { client: prisma8Client } as Prisma8Service,
      new JwtService(),
      config,
      authCache,
    )

    let tenantId = ''
    try {
      const registered = await service.register({
        tenantName,
        name: '认证管理员',
        email,
        password: 'old-password-123',
      })
      tenantId = registered.user.tenantId
      assert.equal(registered.user.email, email)
      assert.equal(registered.user.tenantName, tenantName)
      assert.equal(registered.user.deptName, tenantName)
      assert.deepEqual(registered.user.permissions, ['*'])
      assert.equal(registered.user.roles[0]?.name, '管理员')

      const persistedUser = await prisma8Client.orm.public.Users.where({ id: registered.user.id })
        .select('deptId', 'authVersion', 'defaultPwd')
        .first()
      assert.ok(persistedUser)
      const persistedRoleLink = await prisma8Client.orm.public.UserRoles.where({
        tenantId,
        userId: registered.user.id,
      })
        .select('roleId')
        .first()
      assert.ok(persistedRoleLink)
      const persistedRole = await prisma8Client.orm.public.Roles.where({
        id: persistedRoleLink.roleId,
      })
        .select('isSystem', 'permissions')
        .first()
      assert.ok(persistedRole)
      assert.equal(persistedRole.isSystem, true)
      assert.deepEqual(persistedRole.permissions, ['*'])
      assert.ok(persistedUser.deptId)

      const login = await service.login(
        { email: email.toUpperCase(), password: 'old-password-123' },
        { ip: '127.0.0.1', userAgent: 'prisma8-auth-gate' },
      )
      assert.equal(login.user.id, registered.user.id)
      assert.equal((await service.me(registered.user.id)).tenantSlug, registered.user.tenantSlug)
      assert.equal((await service.refresh(registered.refreshToken)).user.id, registered.user.id)

      await assert.rejects(
        () => service.login({ email, password: 'wrong-password' }),
        UnauthorizedException,
      )
      const logs = await prisma8Client.orm.public.LoginLogs.where({
        userId: registered.user.id,
        authType: 'PASSWORD',
      })
        .select('success', 'message')
        .all()
      assert.equal(logs.some((item) => item.success), true)
      assert.equal(logs.some((item) => !item.success && item.message === '邮箱或密码错误'), true)

      await service.recordExternalLoginFailure(
        {
          tenantId,
          userId: registered.user.id,
          email,
          authType: 'WECOM',
          externalSubject: 'external-subject',
        },
        '外部认证失败',
      )
      const externalFailureLogs = await prisma8Client.orm.public.LoginLogs.where({
        tenantId,
        userId: registered.user.id,
        authType: 'WECOM',
        success: false,
      })
        .select('id')
        .all()
      assert.equal(externalFailureLogs.length, 1)

      await service.changePassword(
        registered.user.id,
        'old-password-123',
        'new-password-456',
      )
      const changed = await prisma8Client.orm.public.Users.where({ id: registered.user.id })
        .select('authVersion', 'defaultPwd')
        .first()
      assert.ok(changed)
      assert.equal(changed.authVersion, 1)
      assert.equal(changed.defaultPwd, false)
      assert.deepEqual(invalidated, [registered.user.id])
      await assert.rejects(() => service.refresh(registered.refreshToken), UnauthorizedException)

      const relogin = await service.login({ email, password: 'new-password-456' })
      assert.equal(relogin.user.id, registered.user.id)
      assert.equal((await service.refresh(relogin.refreshToken)).user.id, registered.user.id)
    } finally {
      if (tenantId) {
        await prisma8Client.orm.public.LoginLogs.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Subscriptions.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.UserRoles.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Users.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Roles.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Departments.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
