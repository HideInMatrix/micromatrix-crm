import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import * as bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '../src/generated/prisma/client'
import { MODULE_SYSTEM_FIELDS } from '../src/modules/metadata/system-fields'

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
          data: {
            deptId: input.deptId,
            leaderId: input.leaderId,
            passwordHash,
            defaultPwd: true,
          },
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
            defaultPwd: true,
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

  // ===== Cordys 模块表单与动态字段 =====
  const now = BigInt(Date.now())
  const ensureModuleForm = async (formKey: 'lead' | 'customer' | 'contact') => {
    const form = await prisma.sysModuleForm.upsert({
      where: { organizationId_formKey: { organizationId: tenant.id, formKey } },
      update: { updateTime: now, updateUser: admin.id },
      create: {
        formKey,
        organizationId: tenant.id,
        createTime: now,
        updateTime: now,
        createUser: admin.id,
        updateUser: admin.id,
        blob: { create: { prop: '{}' } },
      },
    })

    for (const template of MODULE_SYSTEM_FIELDS[formKey] ?? []) {
      const prop = JSON.stringify({
        key: template.key,
        required: template.required ?? false,
        system: template.system ?? true,
        hidden: template.hidden ?? false,
        options: template.options ?? null,
        config: template.config ?? null,
        span: template.span ?? 12,
        showInList: template.showInList ?? true,
        listWidth: template.listWidth ?? null,
      })
      const existing = await prisma.sysModuleField.findFirst({
        where: { formId: form.id, internalKey: template.key },
      })
      if (existing) {
        await prisma.sysModuleField.update({
          where: { id: existing.id },
          data: {
            name: template.label,
            type: template.type,
            pos: BigInt(template.sort),
            updateTime: now,
            updateUser: admin.id,
            blob: {
              upsert: {
                create: { prop },
                update: { prop },
              },
            },
          },
        })
      } else {
        await prisma.sysModuleField.create({
          data: {
            formId: form.id,
            internalKey: template.key,
            name: template.label,
            type: template.type,
            mobile: false,
            pos: BigInt(template.sort),
            createUser: admin.id,
            updateUser: admin.id,
            createTime: now,
            updateTime: now,
            blob: { create: { prop } },
          },
        })
      }
    }

    return form
  }

  const leadForm = await ensureModuleForm('lead')
  const customerForm = await ensureModuleForm('customer')
  const contactForm = await ensureModuleForm('contact')

  const ensureSeedCustomField = async (
    formId: string,
    key: string,
    name: string,
    type: 'text' | 'textarea',
    pos: number,
  ) => {
    const prop = JSON.stringify({
      key,
      required: false,
      system: false,
      hidden: false,
      options: null,
      config: null,
      span: type === 'textarea' ? 24 : 12,
      showInList: type !== 'textarea',
      listWidth: type === 'textarea' ? null : 120,
    })
    const existing = await prisma.sysModuleField.findFirst({
      where: { formId, internalKey: key },
    })
    if (existing) {
      return prisma.sysModuleField.update({
        where: { id: existing.id },
        data: {
          name,
          type,
          pos: BigInt(pos),
          updateTime: now,
          updateUser: admin.id,
          blob: { upsert: { create: { prop }, update: { prop } } },
        },
      })
    }
    return prisma.sysModuleField.create({
      data: {
        formId,
        internalKey: key,
        name,
        type,
        mobile: false,
        pos: BigInt(pos),
        createUser: admin.id,
        updateUser: admin.id,
        createTime: now,
        updateTime: now,
        blob: { create: { prop } },
      },
    })
  }

  await ensureSeedCustomField(leadForm.id, 'cf_notes', '线索备注', 'textarea', 6)
  await ensureSeedCustomField(contactForm.id, 'cf_position', '职位', 'text', 5)
  await ensureSeedCustomField(contactForm.id, 'cf_notes', '联系人备注', 'textarea', 6)

  const customerDynamicFields = await prisma.sysModuleField.findMany({
    where: { formId: customerForm.id },
  })
  const customerFieldIds = new Map(
    customerDynamicFields.map((field) => [field.internalKey ?? field.id, field.id]),
  )
  const leadDynamicFields = await prisma.sysModuleField.findMany({
    where: { formId: leadForm.id },
  })
  const leadFieldIds = new Map(
    leadDynamicFields.map((field) => [field.internalKey ?? field.id, field.id]),
  )
  const contactFields = await prisma.sysModuleField.findMany({ where: { formId: contactForm.id } })
  const contactFieldIds = new Map(
    contactFields.map((field) => [field.internalKey ?? field.id, field.id]),
  )

  // ===== Cordys 多线索池 / 多客户公海 / 容量 =====
  const ensureCluePool = async (
    name: string,
    scopeIds: string[],
    ownerIds: string[],
    auto: boolean,
  ) => {
    const found = await prisma.cluePool.findFirst({ where: { organizationId: tenant.id, name } })
    if (found) return found
    return prisma.cluePool.create({
      data: {
        name,
        scopeId: JSON.stringify(scopeIds),
        organizationId: tenant.id,
        ownerId: JSON.stringify(ownerIds),
        enable: true,
        auto,
        createTime: now,
        updateTime: now,
        createUser: admin.id,
        updateUser: admin.id,
        pickRule: {
          create: {
            limitOnNumber: true,
            pickNumber: 20,
            limitPreOwner: true,
            pickIntervalDays: 7,
            limitNew: false,
            newPickInterval: null,
            createTime: now,
            updateTime: now,
            createUser: admin.id,
            updateUser: admin.id,
          },
        },
        recycleRule: {
          create: {
            operator: 'AND',
            condition: null,
            createTime: now,
            updateTime: now,
            createUser: admin.id,
            updateUser: admin.id,
          },
        },
      },
    })
  }
  const ensureCustomerPool = async (
    name: string,
    scopeIds: string[],
    ownerIds: string[],
    auto: boolean,
  ) => {
    const found = await prisma.customerPool.findFirst({
      where: { organizationId: tenant.id, name },
    })
    if (found) return found
    return prisma.customerPool.create({
      data: {
        name,
        scopeId: JSON.stringify(scopeIds),
        organizationId: tenant.id,
        ownerId: JSON.stringify(ownerIds),
        enable: true,
        auto,
        createTime: now,
        updateTime: now,
        createUser: admin.id,
        updateUser: admin.id,
        pickRule: {
          create: {
            limitOnNumber: true,
            pickNumber: 10,
            limitPreOwner: true,
            pickIntervalDays: 14,
            limitNew: false,
            newPickInterval: null,
            createTime: now,
            updateTime: now,
            createUser: admin.id,
            updateUser: admin.id,
          },
        },
        recycleRule: {
          create: {
            operator: 'AND',
            condition: null,
            createTime: now,
            updateTime: now,
            createUser: admin.id,
            updateUser: admin.id,
          },
        },
      },
    })
  }

  const cluePoolGeneral = await ensureCluePool(
    '默认线索池',
    [salesDept.id],
    [manager.id, sales1.id, sales2.id],
    true,
  )
  const cluePoolChannel = await ensureCluePool(
    '渠道线索池',
    [salesTeam1.id],
    [manager.id, sales1.id],
    false,
  )
  const customerPoolGeneral = await ensureCustomerPool(
    '默认客户公海',
    [salesDept.id],
    [manager.id, sales1.id, sales2.id],
    true,
  )
  const customerPoolPriority = await ensureCustomerPool(
    '重点客户公海',
    [salesTeam2.id],
    [manager.id, sales2.id],
    false,
  )

  const clueHiddenFieldId = leadFieldIds.get('phone')
  if (clueHiddenFieldId) {
    await prisma.cluePoolHiddenField.upsert({
      where: {
        poolId_fieldId: { poolId: cluePoolChannel.id, fieldId: clueHiddenFieldId },
      },
      update: {},
      create: { poolId: cluePoolChannel.id, fieldId: clueHiddenFieldId },
    })
  }
  const customerHiddenFieldId = customerFieldIds.get('cf_email')
  if (customerHiddenFieldId) {
    await prisma.customerPoolHiddenField.upsert({
      where: {
        poolId_fieldId: {
          poolId: customerPoolPriority.id,
          fieldId: customerHiddenFieldId,
        },
      },
      update: {},
      create: { poolId: customerPoolPriority.id, fieldId: customerHiddenFieldId },
    })
  }

  if ((await prisma.clueCapacity.count({ where: { organizationId: tenant.id } })) === 0) {
    await prisma.clueCapacity.createMany({
      data: [
        {
          organizationId: tenant.id,
          scopeId: JSON.stringify([salesTeam1.id]),
          capacity: 80,
          createTime: now,
          updateTime: now,
          createUser: admin.id,
          updateUser: admin.id,
        },
        {
          organizationId: tenant.id,
          scopeId: JSON.stringify([salesTeam2.id]),
          capacity: 80,
          createTime: now,
          updateTime: now,
          createUser: admin.id,
          updateUser: admin.id,
        },
      ],
    })
  }
  if ((await prisma.customerCapacity.count({ where: { organizationId: tenant.id } })) === 0) {
    await prisma.customerCapacity.createMany({
      data: [
        {
          organizationId: tenant.id,
          scopeId: JSON.stringify([salesTeam1.id]),
          capacity: 120,
          filter: null,
          createTime: now,
          updateTime: now,
          createUser: admin.id,
          updateUser: admin.id,
        },
        {
          organizationId: tenant.id,
          scopeId: JSON.stringify([salesTeam2.id]),
          capacity: 120,
          filter: null,
          createTime: now,
          updateTime: now,
          createUser: admin.id,
          updateUser: admin.id,
        },
      ],
    })
  }

  // ===== Cordys 用户视图（五类资源） =====
  const userViewSeeds = [
    {
      resourceType: 'CLUE',
      name: '我的重点线索',
      condition: { name: 'cf_level', operator: 'eq', value: 'A', valueType: 'STRING' },
    },
    { resourceType: 'CLUE_POOL', name: '可领取线索', condition: null },
    {
      resourceType: 'CUSTOMER',
      name: '我的重点客户',
      condition: {
        name: 'cf_industry',
        operator: 'eq',
        value: '软件与信息服务',
        valueType: 'STRING',
      },
    },
    {
      resourceType: 'CUSTOMER_CONTACT',
      name: '有效联系人',
      condition: { name: 'enable', operator: 'eq', value: 'true', valueType: 'BOOLEAN' },
    },
    { resourceType: 'CUSTOMER_POOL', name: '可领取客户', condition: null },
  ] as const
  for (const [index, seed] of userViewSeeds.entries()) {
    const view = await prisma.sysUserView.upsert({
      where: {
        organizationId_userId_resourceType_name: {
          organizationId: tenant.id,
          userId: admin.id,
          resourceType: seed.resourceType,
          name: seed.name,
        },
      },
      update: { enable: true, updateTime: now, updateUser: admin.id },
      create: {
        userId: admin.id,
        name: seed.name,
        fixed: index === 0,
        resourceType: seed.resourceType,
        organizationId: tenant.id,
        pos: BigInt((index + 1) * 4096),
        enable: true,
        searchMode: 'AND',
        createTime: now,
        updateTime: now,
        createUser: admin.id,
        updateUser: admin.id,
      },
    })
    if (
      seed.condition &&
      (await prisma.sysUserViewCondition.count({ where: { sysUserViewId: view.id } })) === 0
    ) {
      await prisma.sysUserViewCondition.create({
        data: {
          sysUserViewId: view.id,
          name: seed.condition.name,
          value: seed.condition.value,
          valueType: seed.condition.valueType,
          type: null,
          multipleValue: false,
          operator: seed.condition.operator,
          childrenValue: null,
          createTime: now,
          updateTime: now,
          createUser: admin.id,
          updateUser: admin.id,
        },
      })
    }
  }

  // ===== Cordys 仪表板目录 / 资源 / 收藏 =====
  let dashboardModule = await prisma.dashboardModule.findFirst({
    where: { organizationId: tenant.id, name: '默认文件夹' },
  })
  dashboardModule ??= await prisma.dashboardModule.create({
    data: {
      organizationId: tenant.id,
      name: '默认文件夹',
      parentId: 'NONE',
      pos: 4096n,
      createTime: now,
      updateTime: now,
      createUser: admin.id,
      updateUser: admin.id,
    },
  })
  let dashboard = await prisma.dashboard.findFirst({
    where: { organizationId: tenant.id, dashboardModuleId: dashboardModule.id, name: '销售概览' },
  })
  dashboard ??= await prisma.dashboard.create({
    data: {
      name: '销售概览',
      resourceUrl: 'https://example.com/dashboard/sales-overview',
      dashboardModuleId: dashboardModule.id,
      organizationId: tenant.id,
      pos: 4096n,
      scopeId: JSON.stringify([salesDept.id]),
      description: 'W3.4 演示仪表板资源，供目录、Scope、收藏与嵌入链路验收使用',
      createTime: now,
      updateTime: now,
      createUser: admin.id,
      updateUser: admin.id,
    },
  })
  await prisma.dashboardCollection.upsert({
    where: { userId_dashboardId: { userId: admin.id, dashboardId: dashboard.id } },
    update: { updateTime: now, updateUser: admin.id },
    create: {
      userId: admin.id,
      dashboardId: dashboard.id,
      createTime: now,
      updateTime: now,
      createUser: admin.id,
      updateUser: admin.id,
    },
  })

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

  // ===== Cordys 业务样例（直接主表 + 分域动态字段值） =====
  const customerCount = await prisma.customer.count({ where: { organizationId: tenant.id } })
  if (customerCount === 0) {
    const customers = [
      [
        '深圳市星辰科技有限公司',
        sales1.id,
        '软件与信息服务',
        '0755-88886666',
        'contact@xingchen.example.com',
        '',
      ],
      [
        '广州云帆贸易有限公司',
        sales1.id,
        '进出口贸易',
        '020-66668888',
        'hello@yunfan.example.com',
        '',
      ],
      ['北京恒远制造集团', sales2.id, '装备制造', '010-58889999', '', '重点客户，季度回访'],
      ['上海蓝湾数字科技', manager.id, '互联网', '021-52001234', '', ''],
      ['杭州清风电子商务有限公司', admin.id, '电子商务', '', '', ''],
    ] as const
    for (const [name, owner, industry, phone, email, remark] of customers) {
      const created = await prisma.customer.create({
        data: {
          name,
          owner,
          collectionTime: now,
          createTime: now,
          updateTime: now,
          createUser: admin.id,
          updateUser: admin.id,
          inSharedPool: false,
          organizationId: tenant.id,
        },
      })
      const normalValues = [
        ['cf_industry', industry],
        ['cf_phone', phone],
        ['cf_email', email],
      ] as const
      for (const [key, value] of normalValues) {
        const fieldId = customerFieldIds.get(key)
        if (fieldId && value) {
          await prisma.customerField.create({
            data: { resourceId: created.id, fieldId, fieldValue: value },
          })
        }
      }
      const remarkFieldId = customerFieldIds.get('cf_remark')
      if (remarkFieldId && remark) {
        await prisma.customerFieldBlob.create({
          data: { resourceId: created.id, fieldId: remarkFieldId, fieldValue: remark },
        })
      }
    }
  }

  const sourceFieldId = leadFieldIds.get('cf_source')
  const levelFieldId = leadFieldIds.get('cf_level')
  const notesFieldId = leadFieldIds.get('cf_notes')
  let activeClueSample = await prisma.clue.findFirst({
    where: { organizationId: tenant.id, name: '华南数字化升级项目' },
  })
  activeClueSample ??= await prisma.clue.create({
    data: {
      name: '华南数字化升级项目',
      owner: sales1.id,
      stage: 'NEW',
      contact: '陈经理',
      phone: '13800000001',
      organizationId: tenant.id,
      createTime: now,
      updateTime: now,
      createUser: admin.id,
      updateUser: admin.id,
      inSharedPool: false,
      collectionTime: now,
    },
  })
  if (sourceFieldId) {
    await prisma.clueField.upsert({
      where: {
        resourceId_fieldId: { resourceId: activeClueSample.id, fieldId: sourceFieldId },
      },
      update: { fieldValue: '官网表单' },
      create: {
        resourceId: activeClueSample.id,
        fieldId: sourceFieldId,
        fieldValue: '官网表单',
      },
    })
  }
  if (levelFieldId) {
    await prisma.clueField.upsert({
      where: {
        resourceId_fieldId: { resourceId: activeClueSample.id, fieldId: levelFieldId },
      },
      update: { fieldValue: 'A' },
      create: {
        resourceId: activeClueSample.id,
        fieldId: levelFieldId,
        fieldValue: 'A',
      },
    })
  }
  if (notesFieldId) {
    await prisma.clueFieldBlob.upsert({
      where: {
        resourceId_fieldId: { resourceId: activeClueSample.id, fieldId: notesFieldId },
      },
      update: { fieldValue: '来自官网的重点演示线索' },
      create: {
        resourceId: activeClueSample.id,
        fieldId: notesFieldId,
        fieldValue: '来自官网的重点演示线索',
      },
    })
  }
  const poolClueSample = await prisma.clue.findFirst({
    where: { organizationId: tenant.id, name: '公海演示线索' },
  })
  if (!poolClueSample) {
    await prisma.clue.create({
      data: {
        name: '公海演示线索',
        owner: null,
        stage: 'NEW',
        organizationId: tenant.id,
        createTime: now,
        updateTime: now,
        createUser: admin.id,
        updateUser: admin.id,
        inSharedPool: true,
        poolId: cluePoolGeneral.id,
      },
    })
  }

  if (
    (await prisma.customer.count({ where: { organizationId: tenant.id, inSharedPool: true } })) ===
    0
  ) {
    await prisma.customer.create({
      data: {
        name: '公海演示客户',
        owner: null,
        poolId: customerPoolGeneral.id,
        createTime: now,
        updateTime: now,
        createUser: admin.id,
        updateUser: admin.id,
        inSharedPool: true,
        organizationId: tenant.id,
      },
    })
  }

  const firstCustomer = await prisma.customer.findFirst({
    where: { organizationId: tenant.id, inSharedPool: false },
    orderBy: { createTime: 'asc' },
  })
  if (firstCustomer) {
    let contact = await prisma.customerContact.findFirst({
      where: { organizationId: tenant.id, customerId: firstCustomer.id, name: '陈经理' },
    })
    contact ??= await prisma.customerContact.create({
      data: {
        customerId: firstCustomer.id,
        name: '陈经理',
        phone: '13900000001',
        owner: sales1.id,
        createTime: now,
        updateTime: now,
        createUser: admin.id,
        updateUser: admin.id,
        enable: true,
        organizationId: tenant.id,
      },
    })

    const contactPositionFieldId = contactFieldIds.get('cf_position')
    if (contactPositionFieldId) {
      await prisma.customerContactField.upsert({
        where: {
          resourceId_fieldId: { resourceId: contact.id, fieldId: contactPositionFieldId },
        },
        update: { fieldValue: '技术负责人' },
        create: {
          resourceId: contact.id,
          fieldId: contactPositionFieldId,
          fieldValue: '技术负责人',
        },
      })
    }
    const contactNotesFieldId = contactFieldIds.get('cf_notes')
    if (contactNotesFieldId) {
      await prisma.customerContactFieldBlob.upsert({
        where: {
          resourceId_fieldId: { resourceId: contact.id, fieldId: contactNotesFieldId },
        },
        update: { fieldValue: '负责数字化升级项目的技术评估' },
        create: {
          resourceId: contact.id,
          fieldId: contactNotesFieldId,
          fieldValue: '负责数字化升级项目的技术评估',
        },
      })
    }

    await prisma.customerCollaboration.upsert({
      where: { customerId_userId: { customerId: firstCustomer.id, userId: sales2.id } },
      update: {
        collaborationType: 'COLLABORATION',
        updateTime: now,
        updateUser: admin.id,
      },
      create: {
        customerId: firstCustomer.id,
        userId: sales2.id,
        collaborationType: 'COLLABORATION',
        createTime: now,
        updateTime: now,
        createUser: admin.id,
        updateUser: admin.id,
      },
    })

    const relatedCustomer = await prisma.customer.findFirst({
      where: {
        organizationId: tenant.id,
        inSharedPool: false,
        id: { not: firstCustomer.id },
      },
      orderBy: { createTime: 'asc' },
    })
    if (relatedCustomer) {
      await prisma.customerRelation.upsert({
        where: {
          sourceCustomerId_targetCustomerId: {
            sourceCustomerId: firstCustomer.id,
            targetCustomerId: relatedCustomer.id,
          },
        },
        update: {},
        create: {
          sourceCustomerId: firstCustomer.id,
          targetCustomerId: relatedCustomer.id,
          createTime: now,
        },
      })
    }

    const convertedClue = await prisma.clue.findFirst({
      where: { organizationId: tenant.id, name: '已转换演示线索' },
    })
    if (!convertedClue) {
      await prisma.clue.create({
        data: {
          name: '已转换演示线索',
          owner: sales2.id,
          lastStage: 'NEW',
          stage: 'FOLLOWING',
          contact: '周经理',
          phone: '13800000002',
          organizationId: tenant.id,
          createTime: now,
          updateTime: now,
          createUser: admin.id,
          updateUser: admin.id,
          transitionType: 'CUSTOMER',
          transitionId: firstCustomer.id,
          inSharedPool: false,
          collectionTime: now,
        },
      })
    }

    const historyStart = now - 14n * 24n * 60n * 60n * 1000n
    const historyEnd = now - 7n * 24n * 60n * 60n * 1000n
    const activeClue = await prisma.clue.findFirst({
      where: {
        organizationId: tenant.id,
        inSharedPool: false,
        transitionType: { not: 'CUSTOMER' },
      },
      orderBy: { createTime: 'asc' },
    })
    if (activeClue && (await prisma.clueOwner.count({ where: { clueId: activeClue.id } })) === 0) {
      await prisma.clueOwner.create({
        data: {
          clueId: activeClue.id,
          owner: manager.id,
          collectionTime: historyStart,
          endTime: historyEnd,
          operator: admin.id,
          reasonId: null,
        },
      })
    }
    if ((await prisma.customerOwner.count({ where: { customerId: firstCustomer.id } })) === 0) {
      await prisma.customerOwner.create({
        data: {
          customerId: firstCustomer.id,
          owner: manager.id,
          collectionTime: historyStart,
          endTime: historyEnd,
          operator: admin.id,
          reasonId: null,
        },
      })
    }
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
