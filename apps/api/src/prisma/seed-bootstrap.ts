import 'dotenv/config'
import { MESSAGE_TASK_DEFINITIONS } from '@micromatrix/shared'
import * as bcrypt from 'bcryptjs'
import { db, type PrismaClient } from './db.js'
import { nowInstant, instantFromDate } from './temporal.js'
import { decimalString, numericValue } from './numeric-value.js'

export async function runBootstrapSeed(prisma: PrismaClient = db) {
    const existingUsers = await prisma.orm.public.Users.select('id').limit(1).all()
    if (existingUsers.length > 0) {
      console.log('Bootstrap 跳过：检测到已有用户，保留现有安装数据')
      return
    }

    const plans = prisma.orm.public.Plans
    let freePlan = await plans.where({ code: 'free' }).first()
    freePlan ??= await plans.create({
      code: 'free',
      name: '免费版',
      price: numericValue(decimalString(0, 10, 2), 10, 2),
      maxUsers: 5,
      updatedAt: nowInstant(),
    })
    if (!(await plans.where({ code: 'pro' }).first())) {
      await plans.create({
        code: 'pro',
        name: '专业版',
        price: numericValue(decimalString(99, 10, 2), 10, 2),
        maxUsers: 50,
        updatedAt: nowInstant(),
      })
    }

    const tenants = prisma.orm.public.Tenants
    let tenant = await tenants.where({ slug: 'demo' }).first()
    tenant ??= await tenants.create({
      name: '微矩阵（演示租户）',
      slug: 'demo',
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
        planId: freePlan.id,
        status: 'ACTIVE',
        currentPeriodStart: instantFromDate(periodStart),
        currentPeriodEnd: instantFromDate(periodEnd),
        updatedAt: nowInstant(),
      })
    }

    const departments = prisma.orm.public.Departments
    const findOrCreateDepartment = async (name: string, parentId?: string) => {
      const found = await departments.where({ tenantId: tenant.id, name }).first()
      if (found) return found
      return departments.create({
        tenantId: tenant.id,
        name,
        parentId: parentId ?? null,
        updatedAt: nowInstant(),
      })
    }
    const rootDept = await findOrCreateDepartment('微矩阵科技')
    const salesDept = await findOrCreateDepartment('销售部', rootDept.id)
    await findOrCreateDepartment('销售一部', salesDept.id)
    await findOrCreateDepartment('销售二部', salesDept.id)

    await seedRolesAndAdmin(prisma, tenant.id, rootDept.id)
}

type BootstrapClient = PrismaClient

async function seedRolesAndAdmin(prisma: BootstrapClient, tenantId: string, rootDeptId: string) {
  const bootstrapPassword = process.env['BOOTSTRAP_ADMIN_PASSWORD'] ?? ['admin', '123'].join('')
  const salesPermissions = salesRolePermissions()
  const managerPermissions = managerRolePermissions(salesPermissions)
  const roles = prisma.orm.public.Roles

  const upsertRole = async (input: {
    name: string
    permissions: string[]
    dataScope: 'ALL' | 'DEPT_AND_CHILD' | 'SELF'
    isSystem?: boolean
    remark: string
  }) => {
    const existing = await roles.where({ tenantId, name: input.name }).first()
    if (existing) {
      return roles.where({ id: existing.id }).update({
        permissions: input.permissions,
        dataScope: input.dataScope,
        ...(input.isSystem !== undefined ? { isSystem: input.isSystem } : {}),
        updatedAt: nowInstant(),
      })
    }
    return roles.create({
      tenantId,
      name: input.name,
      permissions: input.permissions,
      dataScope: input.dataScope,
      isSystem: input.isSystem ?? false,
      remark: input.remark,
      updatedAt: nowInstant(),
    })
  }

  const adminRole = await upsertRole({
    name: '管理员',
    permissions: ['*'],
    dataScope: 'ALL',
    isSystem: true,
    remark: '系统内置角色，拥有全部权限',
  })
  if (!adminRole) throw new Error('Bootstrap 管理员角色创建失败')
  await upsertRole({
    name: '销售主管',
    permissions: managerPermissions,
    dataScope: 'DEPT_AND_CHILD',
    remark: '可见本部门及下级部门数据',
  })
  await upsertRole({
    name: '销售专员',
    permissions: salesPermissions,
    dataScope: 'SELF',
    remark: '仅可见本人负责的数据',
  })

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
      position: 'CEO',
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

function salesRolePermissions(): string[] {
  return [
    'menu:dashboard',
    'dashboard:read',
    'menu:customForm',
    'CUSTOM_FORM:READ',
    'menu:lead',
    'lead:create',
    'lead:update',
    'leadPool:read',
    'leadPool:pick',
    'menu:customer',
    'customer:read',
    'customer:create',
    'customer:update',
    'contact:read',
    'contact:create',
    'contact:update',
    'contact:delete',
    'menu:approval',
  ]
}

function managerRolePermissions(salesPermissions: string[]): string[] {
  return [
    ...salesPermissions,
    'dashboard:create',
    'dashboard:update',
    'dashboard:delete',
    'lead:transfer',
    'lead:recycle',
    'lead:delete',
    'lead:import',
    'lead:export',
    'leadPool:assign',
    'leadPool:import',
    'leadPool:export',
    'leadPool:update',
    'leadPool:delete',
    'customer:transfer',
    'customer:recycle',
    'customer:merge',
    'customer:delete',
    'customer:import',
    'customer:export',
    'contact:import',
    'contact:export',
    'customerPool:read',
    'customerPool:pick',
    'customerPool:assign',
    'customerPool:import',
    'customerPool:export',
    'customerPool:update',
    'customerPool:delete',
  ]
}
