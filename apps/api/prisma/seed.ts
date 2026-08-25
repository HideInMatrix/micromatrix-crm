import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import * as bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '../src/generated/prisma/client'

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL']! })
const prisma = new PrismaClient({ adapter })

async function main() {
  // ===== 套餐（商业化预留） =====
  const freePlan = await prisma.plan.upsert({
    where: { code: 'free' },
    update: {},
    create: { code: 'free', name: '免费版', price: 0, maxUsers: 5 },
  })
  await prisma.plan.upsert({
    where: { code: 'pro' },
    update: {},
    create: { code: 'pro', name: '专业版', price: 99, maxUsers: 50 },
  })

  // ===== 租户 =====
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo' },
    update: {},
    create: { name: '微矩阵（演示租户）', slug: 'demo' },
  })

  const hasSubscription = await prisma.subscription.findFirst({ where: { tenantId: tenant.id } })
  if (!hasSubscription) {
    await prisma.subscription.create({
      data: {
        tenantId: tenant.id,
        planId: freePlan.id,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      },
    })
  }

  // ===== 组织架构 =====
  const findOrCreateDept = async (name: string, parentId?: string) => {
    const found = await prisma.department.findFirst({ where: { tenantId: tenant.id, name } })
    if (found) return found
    return prisma.department.create({ data: { tenantId: tenant.id, name, parentId } })
  }
  const rootDept = await findOrCreateDept('微矩阵科技')
  const salesDept = await findOrCreateDept('销售部', rootDept.id)
  const salesTeam1 = await findOrCreateDept('销售一部', salesDept.id)
  const salesTeam2 = await findOrCreateDept('销售二部', salesDept.id)

  // ===== 角色 =====
  const adminRole = await prisma.role.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: '管理员' } },
    update: { permissions: ['*'], dataScope: 'ALL', isSystem: true },
    create: {
      tenantId: tenant.id,
      name: '管理员',
      permissions: ['*'],
      dataScope: 'ALL',
      isSystem: true,
      remark: '系统内置角色，拥有全部权限',
    },
  })

  const salesPerms = [
    'menu:dashboard',
    'menu:lead',
    'lead:create',
    'lead:update',
    'menu:customer',
    'customer:create',
    'customer:update',
    'customer:team',
    'contact:read',
    'contact:create',
    'contact:update',
    'contact:delete',
    'menu:opportunity',
    'opportunity:create',
    'opportunity:update',
    'opportunity:stage',
    'menu:product',
    'menu:quote',
    'quote:create',
    'quote:update',
    'quote:submit',
    'menu:contract',
    'contract:create',
    'contract:update',
    'contract:submit',
    'receivable:manage',
    'invoice:manage',
    'invoiceTitle:manage',
    'menu:order',
    'order:create',
    'order:update',
    'menu:approval',
  ]
  const managerPerms = [
    ...salesPerms,
    'lead:assign',
    'lead:delete',
    'lead:import',
    'lead:export',
    'leadPool:import',
    'leadPool:export',
    'leadPool:update',
    'leadPool:delete',
    'customer:assign',
    'customer:merge',
    'customer:delete',
    'customer:import',
    'customer:export',
    'contact:import',
    'contact:export',
    'customerPool:import',
    'customerPool:export',
    'customerPool:update',
    'customerPool:delete',
    'opportunity:delete',
    'product:create',
    'product:update',
    'product:delete',
    'quote:delete',
    'contract:delete',
    'order:delete',
    'menu:bidding',
    'bidding:manage',
    'bidding:convert',
  ]
  const managerRole = await prisma.role.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: '销售主管' } },
    update: { dataScope: 'DEPT_AND_CHILD', permissions: managerPerms },
    create: {
      tenantId: tenant.id,
      name: '销售主管',
      permissions: managerPerms,
      dataScope: 'DEPT_AND_CHILD',
      remark: '可见本部门及下级部门数据',
    },
  })
  const salesRole = await prisma.role.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: '销售专员' } },
    update: { dataScope: 'SELF', permissions: salesPerms },
    create: {
      tenantId: tenant.id,
      name: '销售专员',
      permissions: salesPerms,
      dataScope: 'SELF',
      remark: '仅可见本人负责的数据',
    },
  })

  // ===== 成员 =====
  const upsertUser = async (input: {
    email: string
    name: string
    roleIds: string[]
    deptId: string
    leaderId?: string
    position?: string
  }) => {
    const passwordHash = await bcrypt.hash(
      input.email === 'admin@demo.com' ? 'admin123' : 'demo123',
      10,
    )
    const existing = await prisma.user.findFirst({
      where: { tenantId: tenant.id, email: input.email },
    })
    const user = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: { deptId: input.deptId, leaderId: input.leaderId },
        })
      : await prisma.user.create({
          data: {
            tenantId: tenant.id,
            email: input.email,
            passwordHash,
            name: input.name,
            deptId: input.deptId,
            leaderId: input.leaderId,
            position: input.position,
          },
        })
    await prisma.$transaction([
      prisma.userRole.deleteMany({ where: { tenantId: tenant.id, userId: user.id } }),
      prisma.userRole.createMany({
        data: input.roleIds.map((roleId) => ({ tenantId: tenant.id, userId: user.id, roleId })),
        skipDuplicates: true,
      }),
    ])
    return user
  }

  const admin = await upsertUser({
    email: 'admin@demo.com',
    name: '系统管理员',
    roleIds: [adminRole.id],
    deptId: rootDept.id,
    position: 'CEO',
  })
  const manager = await upsertUser({
    email: 'zhangwei@demo.com',
    name: '张伟',
    roleIds: [managerRole.id],
    deptId: salesDept.id,
    leaderId: admin.id,
    position: '销售总监',
  })
  const sales1 = await upsertUser({
    email: 'lina@demo.com',
    name: '李娜',
    roleIds: [salesRole.id],
    deptId: salesTeam1.id,
    leaderId: manager.id,
    position: '销售专员',
  })
  const sales2 = await upsertUser({
    email: 'wangqiang@demo.com',
    name: '王强',
    roleIds: [salesRole.id],
    deptId: salesTeam2.id,
    leaderId: manager.id,
    position: '销售专员',
  })

  await prisma.department.update({ where: { id: salesDept.id }, data: { leaderId: manager.id } })

  // ===== 演示审批流 =====
  // 保证全链路 smoke 在全新数据库上可重复运行；仅首次创建，不覆盖用户后续配置。
  const contractApprovalFlow = await prisma.approvalFlow.findFirst({
    where: { tenantId: tenant.id, formType: 'CONTRACT', deletedAt: null },
  })
  if (!contractApprovalFlow) {
    await prisma.$transaction(async (tx) => {
      const counter = await tx.approvalFlowNumberCounter.upsert({
        where: { tenantId_formType: { tenantId: tenant.id, formType: 'CONTRACT' } },
        update: { nextValue: { increment: 1 } },
        create: { tenantId: tenant.id, formType: 'CONTRACT', nextValue: 2 },
      })
      const flow = await tx.approvalFlow.create({
        data: {
          tenantId: tenant.id,
          number: `CTR-APV-${String(counter.nextValue - 1).padStart(5, '0')}`,
          formType: 'CONTRACT',
          name: '大额合同审批',
          enabled: true,
          condition: { amountGte: 80000 },
          createdById: admin.id,
          updatedById: admin.id,
        },
      })
      const version = await tx.approvalFlowVersion.create({
        data: {
          flowId: flow.id,
          tenantId: tenant.id,
          version: 1,
          createdById: admin.id,
        },
      })
      const startId = randomUUID()
      const leaderNodeId = randomUUID()
      const adminNodeId = randomUUID()
      const endId = randomUUID()
      await tx.approvalNode.create({
        data: {
          id: startId,
          flowVersionId: version.id,
          number: 'PN001',
          name: '开始',
          nodeType: 'START',
          sort: 0,
        },
      })
      await tx.approvalNode.create({
        data: {
          id: leaderNodeId,
          flowVersionId: version.id,
          number: 'PN002',
          name: '直属上级审批',
          nodeType: 'APPROVER',
          sort: 1,
          approver: {
            create: {
              approverType: 'DIRECT_LEADER',
              approverIds: [],
              mode: 'ANY',
            },
          },
        },
      })
      await tx.approvalNode.create({
        data: {
          id: adminNodeId,
          flowVersionId: version.id,
          number: 'PN003',
          name: '管理员终审',
          nodeType: 'APPROVER',
          sort: 2,
          approver: {
            create: {
              approverType: 'USER',
              approverIds: [admin.id],
              mode: 'ANY',
            },
          },
        },
      })
      await tx.approvalNode.create({
        data: {
          id: endId,
          flowVersionId: version.id,
          number: 'PN004',
          name: '结束',
          nodeType: 'END',
          sort: 3,
        },
      })
      const orderedIds = [startId, leaderNodeId, adminNodeId, endId]
      await tx.approvalNodeLink.createMany({
        data: orderedIds.slice(1).map((toNodeId, index) => ({
          id: randomUUID(),
          flowVersionId: version.id,
          fromNodeId: orderedIds[index],
          toNodeId,
          sort: index,
        })),
      })
      await tx.approvalFlow.update({
        where: { id: flow.id },
        data: { currentVersionId: version.id },
      })
    })
  }

  // ===== 演示标讯配置 =====
  // 仅启用内置 DemoProvider，保证全新数据库可直接验证抓取/去重/转线索链路。
  await prisma.biddingSource.upsert({
    where: { tenantId_provider: { tenantId: tenant.id, provider: 'demo' } },
    update: {},
    create: {
      tenantId: tenant.id,
      provider: 'demo',
      name: '演示数据源（模拟数据）',
      enabled: true,
    },
  })
  await prisma.biddingKeywordSub.upsert({
    where: { tenantId_keyword: { tenantId: tenant.id, keyword: '软件' } },
    update: {},
    create: {
      tenantId: tenant.id,
      keyword: '软件',
      enabled: true,
    },
  })

  // ===== 示例客户（覆盖不同负责人/部门，验证数据范围） =====
  const customerCount = await prisma.customer.count({ where: { tenantId: tenant.id } })
  if (customerCount === 0) {
    await prisma.customer.createMany({
      data: [
        {
          tenantId: tenant.id,
          name: '深圳市星辰科技有限公司',
          industry: '软件与信息服务',
          phone: '0755-88886666',
          email: 'contact@xingchen.example.com',
          ownerId: sales1.id,
          deptId: salesTeam1.id,
        },
        {
          tenantId: tenant.id,
          name: '广州云帆贸易有限公司',
          industry: '进出口贸易',
          phone: '020-66668888',
          email: 'hello@yunfan.example.com',
          ownerId: sales1.id,
          deptId: salesTeam1.id,
        },
        {
          tenantId: tenant.id,
          name: '北京恒远制造集团',
          industry: '装备制造',
          phone: '010-58889999',
          remark: '重点客户，季度回访',
          ownerId: sales2.id,
          deptId: salesTeam2.id,
        },
        {
          tenantId: tenant.id,
          name: '上海蓝湾数字科技',
          industry: '互联网',
          phone: '021-52001234',
          ownerId: manager.id,
          deptId: salesDept.id,
        },
        {
          tenantId: tenant.id,
          name: '杭州清风电子商务有限公司',
          industry: '电子商务',
          ownerId: admin.id,
          deptId: rootDept.id,
        },
      ],
    })
  }

  console.log('Seed 完成，演示账号（密码 admin123 / 其余 demo123）：')
  console.log('  管理员  admin@demo.com      数据范围: 全部')
  console.log('  销售主管 zhangwei@demo.com   数据范围: 本部门及下级（销售部）')
  console.log('  销售专员 lina@demo.com       数据范围: 仅本人（销售一部）')
  console.log('  销售专员 wangqiang@demo.com  数据范围: 仅本人（销售二部）')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
