import 'dotenv/config'
import { MESSAGE_TASK_DEFINITIONS } from '@micromatrix/shared'
import * as bcrypt from 'bcryptjs'
import { createTenantSlug } from '../common/tenant-slug.js'
import { db, type PrismaClient } from './db.js'
import { nowInstant, instantFromDate } from './temporal.js'
import { decimalString, numericValue } from './numeric-value.js'

export async function runBootstrapSeed(prisma: PrismaClient = db) {
  const plans = prisma.orm.public.Plans
  let proPlan = await plans.where({ code: 'pro' }).first()
  if (proPlan) {
    proPlan = await plans.where({ id: proPlan.id }).update({
      name: '专业版',
      maxUsers: 999999,
      updatedAt: nowInstant(),
    })
  } else {
    proPlan = await plans.create({
      code: 'pro',
      name: '专业版',
      price: numericValue(decimalString(99, 10, 2), 10, 2),
      maxUsers: 999999,
      updatedAt: nowInstant(),
    })
  }
  if (!proPlan) throw new Error('Bootstrap 默认专业版套餐创建失败')

  const existingUsers = await prisma.orm.public.Users.select('id').limit(1).all()
  if (existingUsers.length > 0) {
    console.log('Bootstrap 跳过业务初始化：检测到已有用户，已校准默认专业版套餐')
    return
  }

  const tenants = prisma.orm.public.Tenants
  let tenant = await tenants.orderBy((row) => row.createdAt.asc()).first()
  tenant ??= await tenants.create({
    name: '默认企业',
    slug: createTenantSlug(),
    updatedAt: nowInstant(),
  })

  const messageTaskSettings = prisma.orm.public.MessageTaskSettings
  for (const definition of MESSAGE_TASK_DEFINITIONS) {
    const existing = await messageTaskSettings
      .where({ tenantId: tenant.id, module: definition.module, event: definition.event })
      .first()
    if (existing) continue
    await messageTaskSettings.create({
      tenantId: tenant.id,
      module: definition.module,
      event: definition.event,
      systemEnabled: definition.defaultSystemEnabled,
      emailEnabled: definition.defaultEmailEnabled,
      weComEnabled: false,
      updatedAt: nowInstant(),
    })
  }

  const subscriptions = prisma.orm.public.Subscriptions
  if (!(await subscriptions.where({ tenantId: tenant.id }).first())) {
    const periodStart = new Date()
    const periodEnd = new Date(periodStart.getTime() + 365 * 24 * 3600 * 1000)
    await subscriptions.create({
      tenantId: tenant.id,
      planId: proPlan.id,
      status: 'ACTIVE',
      currentPeriodStart: instantFromDate(periodStart),
      currentPeriodEnd: instantFromDate(periodEnd),
      updatedAt: nowInstant(),
    })
  }

  const departments = prisma.orm.public.Departments
  let rootDept = await departments
    .where({ tenantId: tenant.id, parentId: null })
    .orderBy((row) => row.createdAt.asc())
    .first()
  rootDept ??= await departments.create({
    tenantId: tenant.id,
    name: tenant.name || '默认企业',
    parentId: null,
    updatedAt: nowInstant(),
  })

  await seedAdmin(prisma, tenant.id, rootDept.id)
}

type BootstrapClient = PrismaClient

async function seedAdmin(prisma: BootstrapClient, tenantId: string, rootDeptId: string) {
  const bootstrapPassword = process.env['BOOTSTRAP_ADMIN_PASSWORD'] ?? ['admin', '123'].join('')
  const roles = prisma.orm.public.Roles
  const existingAdminRole = await roles.where({ tenantId, name: '管理员' }).first()
  const adminRole = existingAdminRole
    ? await roles.where({ id: existingAdminRole.id }).update({
        permissions: ['*'],
        dataScope: 'ALL',
        isSystem: true,
        remark: '系统内置角色，拥有全部权限',
        updatedAt: nowInstant(),
      })
    : await roles.create({
        tenantId,
        name: '管理员',
        permissions: ['*'],
        dataScope: 'ALL',
        isSystem: true,
        remark: '系统内置角色，拥有全部权限',
        updatedAt: nowInstant(),
      })
  if (!adminRole) throw new Error('Bootstrap 管理员角色创建失败')

  const users = prisma.orm.public.Users
  const passwordHash = await bcrypt.hash(bootstrapPassword, 10)
  let admin = await users.where({ tenantId, email: 'admin@demo.com' }).first()
  if (admin) {
    admin = await users.where({ id: admin.id }).update({
      deptId: rootDeptId,
      passwordHash,
      defaultPwd: true,
      updatedAt: nowInstant(),
    })
  } else {
    admin = await users.create({
      tenantId,
      email: 'admin@demo.com',
      passwordHash,
      name: '系统管理员',
      deptId: rootDeptId,
      defaultPwd: true,
      updatedAt: nowInstant(),
    })
  }
  if (!admin) throw new Error('Bootstrap 管理员创建失败')

  await prisma.transaction(async (tx) => {
    await tx.orm.public.UserRoles.where({ tenantId, userId: admin.id }).deleteAll()
    await tx.orm.public.UserRoles.create({
      tenantId,
      userId: admin.id,
      roleId: adminRole.id,
      updatedAt: nowInstant(),
    })
  })

  console.log('Bootstrap 初始化完成')
  console.log('  超级管理员 admin@demo.com')
}
