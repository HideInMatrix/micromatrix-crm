import 'dotenv/config'
import { MODULE_SYSTEM_FIELDS } from '../src/modules/metadata/system-fields'
import { createPrisma8Client } from '../src/prisma/prisma8-client'
import { createLegacyId32 } from '../src/common/legacy-id'
import { prisma8Now } from '../src/prisma/prisma8-temporal'
import { jsonValue } from '../src/prisma/json-value'
import { runPrisma8BootstrapSeed } from './seed-bootstrap-prisma8'
import * as bcrypt from 'bcryptjs'

const databaseUrl = process.env['DATABASE_URL']

type DemoClient = Awaited<ReturnType<typeof createPrisma8Client>>

export async function runPrisma8DemoSeed() {
  if (!databaseUrl) throw new Error('DATABASE_URL 未配置')
  await runPrisma8BootstrapSeed()

  const prisma = await createPrisma8Client(databaseUrl)
  await prisma.connect()
  try {
    const tenant = await prisma.orm.public.Tenants.where({ slug: 'demo' }).first()
    if (!tenant) throw new Error('Demo tenant 不存在')
    const admin = await prisma.orm.public.Users.where({
      tenantId: tenant.id,
      email: 'admin@demo.com',
    }).first()
    if (!admin) throw new Error('Demo admin 不存在')

    const departments = await prisma.orm.public.Departments.where({ tenantId: tenant.id }).all()
    const byDepartmentName = new Map(departments.map((item) => [item.name, item]))
    const rootDept = byDepartmentName.get('微矩阵科技')
    const salesDept = byDepartmentName.get('销售部')
    const salesTeam1 = byDepartmentName.get('销售一部')
    const salesTeam2 = byDepartmentName.get('销售二部')
    if (!rootDept || !salesDept || !salesTeam1 || !salesTeam2) {
      throw new Error('Demo 部门基础数据不完整')
    }

    const roles = await prisma.orm.public.Roles.where({ tenantId: tenant.id }).all()
    const byRoleName = new Map(roles.map((item) => [item.name, item]))
    const managerRole = byRoleName.get('销售主管')
    const salesRole = byRoleName.get('销售专员')
    if (!managerRole || !salesRole) throw new Error('Demo 角色基础数据不完整')

    const manager = await upsertDemoUser(prisma, {
      tenantId: tenant.id,
      email: 'zhangwei@demo.com',
      name: '张伟',
      deptId: salesDept.id,
      leaderId: admin.id,
      position: '销售总监',
      roleIds: [managerRole.id],
      privilegedPassword: true,
    })
    const sales1 = await upsertDemoUser(prisma, {
      tenantId: tenant.id,
      email: 'lina@demo.com',
      name: '李娜',
      deptId: salesTeam1.id,
      leaderId: manager.id,
      position: '销售专员',
      roleIds: [salesRole.id],
    })
    const sales2 = await upsertDemoUser(prisma, {
      tenantId: tenant.id,
      email: 'wangqiang@demo.com',
      name: '王强',
      deptId: salesTeam2.id,
      leaderId: manager.id,
      position: '销售专员',
      roleIds: [salesRole.id],
    })
    await prisma.orm.public.Departments.where({ id: salesDept.id }).update({
      leaderId: manager.id,
      updatedAt: prisma8Now(),
    })

    await seedDemoFormsAndStages(prisma, tenant.id, admin.id)
    await seedDemoPoolsAndViews(prisma, {
      tenantId: tenant.id,
      adminId: admin.id,
      managerId: manager.id,
      sales1Id: sales1.id,
      sales2Id: sales2.id,
      salesDeptId: salesDept.id,
      salesTeam1Id: salesTeam1.id,
      salesTeam2Id: salesTeam2.id,
    })
    await seedDemoDashboardApprovalBidding(prisma, tenant.id, admin.id, salesDept.id)
    await seedDemoBusinessSamples(prisma, {
      tenantId: tenant.id,
      adminId: admin.id,
      managerId: manager.id,
      sales1Id: sales1.id,
      sales2Id: sales2.id,
    })
  } finally {
    await prisma.close()
  }
}

async function upsertDemoUser(
  prisma: DemoClient,
  input: {
    tenantId: string
    email: string
    name: string
    deptId: string
    leaderId: string
    position: string
    roleIds: string[]
    privilegedPassword?: boolean
  },
) {
  const users = prisma.orm.public.Users
  const password = input.privilegedPassword
    ? (process.env['DEMO_MANAGER_PASSWORD'] ?? ['admin', '123'].join(''))
    : (process.env['DEMO_USER_PASSWORD'] ?? ['demo', '123'].join(''))
  const passwordHash = await bcrypt.hash(password, 10)
  let user = await users.where({ tenantId: input.tenantId, email: input.email }).first()
  if (user) {
    user = await users.where({ id: user.id }).update({
      deptId: input.deptId,
      leaderId: input.leaderId,
      passwordHash,
      defaultPwd: true,
      updatedAt: prisma8Now(),
    })
  } else {
    user = await users.create({
      tenantId: input.tenantId,
      email: input.email,
      passwordHash,
      name: input.name,
      deptId: input.deptId,
      leaderId: input.leaderId,
      position: input.position,
      defaultPwd: true,
      updatedAt: prisma8Now(),
    })
  }
  if (!user) throw new Error(`Demo user 创建失败: ${input.email}`)

  await prisma.transaction(async (tx) => {
    await tx.orm.public.UserRoles.where({ tenantId: input.tenantId, userId: user.id }).deleteAll()
    await tx.orm.public.UserRoles.createAll(
      input.roleIds.map((roleId) => ({
        tenantId: input.tenantId,
        userId: user!.id,
        roleId,
        updatedAt: prisma8Now(),
      })),
    )
  })
  return user
}

async function seedDemoFormsAndStages(prisma: DemoClient, tenantId: string, adminId: string) {
  const organizationId = tenantId
  const actorId = adminId
  const now = BigInt(Date.now())
  const forms = prisma.orm.public.SysModuleForm
  const fields = prisma.orm.public.SysModuleField
  const fieldBlobs = prisma.orm.public.SysModuleFieldBlob
  const formBlobs = prisma.orm.public.SysModuleFormBlob

  const ensureModuleForm = async (
    formKey:
      | 'lead'
      | 'customer'
      | 'contact'
      | 'contract'
      | 'contractPaymentPlan'
      | 'contractPaymentRecord'
      | 'order'
      | 'followRecord'
      | 'followPlan',
  ) => {
    const key = formKey
    let form = await forms.where({ organizationId, formKey: key }).first()
    if (form) {
      form = await forms.where({ id: form.id }).update({ updateTime: now, updateUser: actorId })
    } else {
      form = await forms.create({
        id: createLegacyId32(),
        formKey: key,
        organizationId,
        createTime: now,
        updateTime: now,
        createUser: actorId,
        updateUser: actorId,
      })
    }
    if (!form) throw new Error(`模块表单创建失败: ${formKey}`)
    if (!(await formBlobs.where({ id: form.id }).first())) {
      await formBlobs.create({ id: form.id, prop: '{}' })
    }

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
      const internalKey = template.key
      let field = await fields.where({ formId: form.id, internalKey }).first()
      if (field) {
        field = await fields.where({ id: field.id }).update({
          name: template.label,
          _type: template.type,
          mobile: template.mobile ?? false,
          pos: BigInt(template.sort),
          updateTime: now,
          updateUser: actorId,
        })
      } else {
        field = await fields.create({
          id: createLegacyId32(),
          formId: form.id,
          internalKey,
          name: template.label,
          _type: template.type,
          mobile: template.mobile ?? false,
          pos: BigInt(template.sort),
          createUser: actorId,
          updateUser: actorId,
          createTime: now,
          updateTime: now,
        })
      }
      if (!field) throw new Error(`模块字段创建失败: ${formKey}.${template.key}`)
      const blob = await fieldBlobs.where({ id: field.id }).first()
      if (blob) await fieldBlobs.where({ id: field.id }).update({ prop })
      else await fieldBlobs.create({ id: field.id, prop })
    }
    return form
  }

  const leadForm = await ensureModuleForm('lead')
  await ensureModuleForm('customer')
  const contactForm = await ensureModuleForm('contact')
  await ensureModuleForm('contract')
  await ensureModuleForm('contractPaymentPlan')
  await ensureModuleForm('contractPaymentRecord')
  await ensureModuleForm('order')
  const followRecordForm = await ensureModuleForm('followRecord')
  await ensureModuleForm('followPlan')

  const followRecordBlob = await formBlobs.where({ id: followRecordForm.id }).first()
  const followRecordProp = JSON.parse(followRecordBlob?.prop || '{}') as Record<string, unknown>
  if (!followRecordProp['linkProp']) {
    followRecordProp['linkProp'] = {
      lead: [{ key: 'CLUE_TO_RECORD', linkFields: [] }],
      customer: [{ key: 'CUSTOMER_TO_RECORD', linkFields: [] }],
      opportunity: [{ key: 'OPPORTUNITY_TO_RECORD', linkFields: [] }],
      followPlan: [{ key: 'PLAN_TO_RECORD', linkFields: [] }],
    }
    await formBlobs.where({ id: followRecordForm.id }).update({
      prop: JSON.stringify(followRecordProp),
    })
  }

  await seedStages(prisma, organizationId, actorId, now)
  await ensureSeedCustomField(
    prisma,
    leadForm.id,
    actorId,
    now,
    'cf_notes',
    '线索备注',
    'textarea',
    6,
  )
  await ensureSeedCustomField(
    prisma,
    contactForm.id,
    actorId,
    now,
    'cf_position',
    '职位',
    'text',
    5,
  )
  await ensureSeedCustomField(
    prisma,
    contactForm.id,
    actorId,
    now,
    'cf_notes',
    '联系人备注',
    'textarea',
    6,
  )
}

async function seedStages(
  prisma: DemoClient,
  organizationId: string,
  actorId: string,
  now: bigint,
) {
  const contractStages = [
    ['待签署', 'AFOOT'],
    ['已签署', 'AFOOT'],
    ['合同变更', 'AFOOT'],
    ['履行中', 'AFOOT'],
    ['履行完毕', 'AFOOT'],
    ['合同完结', 'END'],
    ['作废', 'END'],
  ] as const
  for (const [index, [name, type]] of contractStages.entries()) {
    const collection = prisma.orm.public.ContractStageConfig
    let row = await collection.where({ organizationId, name: name }).first()
    const data = {
      _type: type,
      pos: BigInt(index + 1),
      afootRollBack: true,
      endRollBack: false,
      circulationType: 'NORMAL',
      updateTime: now,
      updateUser: actorId,
    }
    if (row) row = await collection.where({ id: row.id }).update(data)
    else {
      row = await collection.create({
        id: createLegacyId32(),
        name: name,
        organizationId,
        createTime: now,
        createUser: actorId,
        ...data,
      })
    }
    if (!row) throw new Error(`合同阶段创建失败: ${name}`)
  }

  const orderStages = [
    ['新建', 'AFOOT'],
    ['待发货', 'AFOOT'],
    ['部分发货', 'AFOOT'],
    ['已发货', 'AFOOT'],
    ['待验收', 'AFOOT'],
    ['已完成', 'END'],
    ['已作废', 'END'],
  ] as const
  for (const [index, [name, type]] of orderStages.entries()) {
    const collection = prisma.orm.public.SalesOrderStageConfig
    let row = await collection.where({ organizationId, name: name }).first()
    const data = {
      _type: type,
      pos: BigInt(index + 1),
      afootRollBack: true,
      endRollBack: false,
      circulationType: 'NORMAL',
      updateTime: now,
      updateUser: actorId,
    }
    if (row) row = await collection.where({ id: row.id }).update(data)
    else {
      row = await collection.create({
        id: createLegacyId32(),
        name: name,
        organizationId,
        createTime: now,
        createUser: actorId,
        ...data,
      })
    }
    if (!row) throw new Error(`订单阶段创建失败: ${name}`)
  }
}

async function ensureSeedCustomField(
  prisma: DemoClient,
  formId: string,
  actorId: string,
  now: bigint,
  key: string,
  name: string,
  type: 'text' | 'textarea',
  pos: number,
) {
  const fields = prisma.orm.public.SysModuleField
  const blobs = prisma.orm.public.SysModuleFieldBlob
  const internalKey = key
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
  let field = await fields.where({ formId, internalKey }).first()
  if (field) {
    field = await fields.where({ id: field.id }).update({
      name: name,
      _type: type,
      pos: BigInt(pos),
      updateTime: now,
      updateUser: actorId,
    })
  } else {
    field = await fields.create({
      id: createLegacyId32(),
      formId,
      internalKey,
      name: name,
      _type: type,
      mobile: false,
      pos: BigInt(pos),
      createUser: actorId,
      updateUser: actorId,
      createTime: now,
      updateTime: now,
    })
  }
  if (!field) throw new Error(`演示字段创建失败: ${key}`)
  if (await blobs.where({ id: field.id }).first())
    await blobs.where({ id: field.id }).update({ prop })
  else await blobs.create({ id: field.id, prop })
  return field
}

async function seedDemoPoolsAndViews(
  prisma: DemoClient,
  input: {
    tenantId: string
    adminId: string
    managerId: string
    sales1Id: string
    sales2Id: string
    salesDeptId: string
    salesTeam1Id: string
    salesTeam2Id: string
  },
) {
  const organizationId = input.tenantId
  const actorId = input.adminId
  const now = BigInt(Date.now())

  const ensureCluePool = async (
    name: string,
    scopeIds: string[],
    ownerIds: string[],
    auto: boolean,
  ) => {
    const pools = prisma.orm.public.CluePool
    let pool = await pools.where({ organizationId, name: name }).first()
    if (!pool) {
      pool = await pools.create({
        id: createLegacyId32(),
        name: name,
        scopeId: JSON.stringify(scopeIds),
        organizationId,
        ownerId: JSON.stringify(ownerIds),
        enable: true,
        auto,
        createTime: now,
        updateTime: now,
        createUser: actorId,
        updateUser: actorId,
      })
    }
    if (!pool) throw new Error(`线索池创建失败: ${name}`)

    const pickRules = prisma.orm.public.CluePoolPickRule
    if (!(await pickRules.where({ poolId: pool.id }).first())) {
      await pickRules.create({
        id: createLegacyId32(),
        poolId: pool.id,
        limitOnNumber: true,
        pickNumber: 20,
        limitPreOwner: true,
        pickIntervalDays: 7,
        limitNew: false,
        newPickInterval: null,
        createTime: now,
        updateTime: now,
        createUser: actorId,
        updateUser: actorId,
      })
    }
    const recycleRules = prisma.orm.public.CluePoolRecycleRule
    if (!(await recycleRules.where({ poolId: pool.id }).first())) {
      await recycleRules.create({
        id: createLegacyId32(),
        poolId: pool.id,
        operator: 'AND',
        condition: null,
        createTime: now,
        updateTime: now,
        createUser: actorId,
        updateUser: actorId,
      })
    }
    return pool
  }

  const ensureCustomerPool = async (
    name: string,
    scopeIds: string[],
    ownerIds: string[],
    auto: boolean,
  ) => {
    const pools = prisma.orm.public.CustomerPool
    let pool = await pools.where({ organizationId, name: name }).first()
    if (!pool) {
      pool = await pools.create({
        id: createLegacyId32(),
        name: name,
        scopeId: JSON.stringify(scopeIds),
        organizationId,
        ownerId: JSON.stringify(ownerIds),
        enable: true,
        auto,
        createTime: now,
        updateTime: now,
        createUser: actorId,
        updateUser: actorId,
      })
    }
    if (!pool) throw new Error(`客户公海创建失败: ${name}`)

    const pickRules = prisma.orm.public.CustomerPoolPickRule
    if (!(await pickRules.where({ poolId: pool.id }).first())) {
      await pickRules.create({
        id: createLegacyId32(),
        poolId: pool.id,
        limitOnNumber: true,
        pickNumber: 10,
        limitPreOwner: true,
        pickIntervalDays: 14,
        limitNew: false,
        newPickInterval: null,
        createTime: now,
        updateTime: now,
        createUser: actorId,
        updateUser: actorId,
      })
    }
    const recycleRules = prisma.orm.public.CustomerPoolRecycleRule
    if (!(await recycleRules.where({ poolId: pool.id }).first())) {
      await recycleRules.create({
        id: createLegacyId32(),
        poolId: pool.id,
        operator: 'AND',
        condition: null,
        createTime: now,
        updateTime: now,
        createUser: actorId,
        updateUser: actorId,
      })
    }
    return pool
  }

  const cluePoolChannel = await ensureCluePool(
    '渠道线索池',
    [input.salesTeam1Id],
    [input.managerId, input.sales1Id],
    false,
  )
  await ensureCluePool(
    '默认线索池',
    [input.salesDeptId],
    [input.managerId, input.sales1Id, input.sales2Id],
    true,
  )
  const customerPoolPriority = await ensureCustomerPool(
    '重点客户公海',
    [input.salesTeam2Id],
    [input.managerId, input.sales2Id],
    false,
  )
  await ensureCustomerPool(
    '默认客户公海',
    [input.salesDeptId],
    [input.managerId, input.sales1Id, input.sales2Id],
    true,
  )

  const forms = prisma.orm.public.SysModuleForm
  const leadForm = await forms.where({ organizationId, formKey: 'lead' }).first()
  const customerForm = await forms.where({ organizationId, formKey: 'customer' }).first()
  if (!leadForm || !customerForm) throw new Error('Pool 隐藏字段依赖的模块表单不存在')
  const fields = prisma.orm.public.SysModuleField
  const phoneField = await fields.where({ formId: leadForm.id, internalKey: 'phone' }).first()
  const emailField = await fields
    .where({ formId: customerForm.id, internalKey: 'cf_email' })
    .first()
  if (phoneField) {
    const hiddenFields = prisma.orm.public.CluePoolHiddenField
    const fieldId = phoneField.id
    if (!(await hiddenFields.where({ poolId: cluePoolChannel.id, fieldId }).first())) {
      await hiddenFields.create({ poolId: cluePoolChannel.id, fieldId })
    }
  }
  if (emailField) {
    const hiddenFields = prisma.orm.public.CustomerPoolHiddenField
    const fieldId = emailField.id
    if (!(await hiddenFields.where({ poolId: customerPoolPriority.id, fieldId }).first())) {
      await hiddenFields.create({ poolId: customerPoolPriority.id, fieldId })
    }
  }

  const clueCapacities = prisma.orm.public.ClueCapacity
  if ((await clueCapacities.where({ organizationId }).all()).length === 0) {
    await clueCapacities.createAll(
      [input.salesTeam1Id, input.salesTeam2Id].map((departmentId) => ({
        id: createLegacyId32(),
        organizationId,
        scopeId: JSON.stringify([departmentId]),
        capacity: 80,
        createTime: now,
        updateTime: now,
        createUser: actorId,
        updateUser: actorId,
      })),
    )
  }
  const customerCapacities = prisma.orm.public.CustomerCapacity
  if ((await customerCapacities.where({ organizationId }).all()).length === 0) {
    await customerCapacities.createAll(
      [input.salesTeam1Id, input.salesTeam2Id].map((departmentId) => ({
        id: createLegacyId32(),
        organizationId,
        scopeId: JSON.stringify([departmentId]),
        capacity: 120,
        filter: null,
        createTime: now,
        updateTime: now,
        createUser: actorId,
        updateUser: actorId,
      })),
    )
  }

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
  const views = prisma.orm.public.SysUserView
  const conditions = prisma.orm.public.SysUserViewCondition
  for (const [index, seed] of userViewSeeds.entries()) {
    const resourceType = seed.resourceType
    const name = seed.name
    let view = await views.where({ organizationId, userId: actorId, resourceType, name }).first()
    if (view) {
      view = await views.where({ id: view.id }).update({
        enable: true,
        updateTime: now,
        updateUser: actorId,
      })
    } else {
      view = await views.create({
        id: createLegacyId32(),
        userId: actorId,
        name,
        fixed: index === 0,
        resourceType,
        organizationId,
        pos: BigInt((index + 1) * 4096),
        enable: true,
        searchMode: 'AND',
        createTime: now,
        updateTime: now,
        createUser: actorId,
        updateUser: actorId,
      })
    }
    if (!view) throw new Error(`用户视图创建失败: ${seed.name}`)
    if (seed.condition && (await conditions.where({ sysUserViewId: view.id }).all()).length === 0) {
      await conditions.create({
        id: createLegacyId32(),
        sysUserViewId: view.id,
        name: seed.condition.name,
        value: seed.condition.value,
        valueType: seed.condition.valueType,
        _type: null,
        multipleValue: false,
        operator: seed.condition.operator,
        childrenValue: null,
        createTime: now,
        updateTime: now,
        createUser: actorId,
        updateUser: actorId,
      })
    }
  }
}

async function seedDemoDashboardApprovalBidding(
  prisma: DemoClient,
  tenantId: string,
  adminId: string,
  salesDeptId: string,
) {
  const organizationId = tenantId
  const actorId = adminId
  const now = BigInt(Date.now())

  const modules = prisma.orm.public.DashboardModule
  let dashboardModule = await modules.where({ organizationId, name: '默认文件夹' }).first()
  if (!dashboardModule) {
    dashboardModule = await modules.create({
      id: createLegacyId32(),
      organizationId,
      name: '默认文件夹',
      parentId: 'NONE',
      pos: 4096n,
      createTime: now,
      updateTime: now,
      createUser: actorId,
      updateUser: actorId,
    })
  }
  if (!dashboardModule) throw new Error('Demo 仪表板目录创建失败')

  const dashboards = prisma.orm.public.Dashboard
  let dashboard = await dashboards
    .where({
      organizationId,
      dashboardModuleId: dashboardModule.id,
      name: '销售概览',
    })
    .first()
  if (!dashboard) {
    dashboard = await dashboards.create({
      id: createLegacyId32(),
      name: '销售概览',
      resourceUrl: 'https://example.com/dashboard/sales-overview',
      dashboardModuleId: dashboardModule.id,
      organizationId,
      pos: 4096n,
      scopeId: JSON.stringify([salesDeptId]),
      description: 'W3.4 演示仪表板资源，供目录、Scope、收藏与嵌入链路验收使用',
      createTime: now,
      updateTime: now,
      createUser: actorId,
      updateUser: actorId,
    })
  }
  if (!dashboard) throw new Error('Demo 仪表板创建失败')

  const collections = prisma.orm.public.DashboardCollection
  let collection = await collections.where({ userId: actorId, dashboardId: dashboard.id }).first()
  if (collection) {
    collection = await collections.where({ id: collection.id }).update({
      updateTime: now,
      updateUser: actorId,
    })
  } else {
    collection = await collections.create({
      id: createLegacyId32(),
      userId: actorId,
      dashboardId: dashboard.id,
      createTime: now,
      updateTime: now,
      createUser: actorId,
      updateUser: actorId,
    })
  }
  if (!collection) throw new Error('Demo 仪表板收藏创建失败')

  const flows = prisma.orm.public.ApprovalFlows
  const existingFlow = await flows
    .where({ tenantId, formType: 'CONTRACT', deletedAt: null })
    .first()
  if (!existingFlow) {
    await prisma.transaction(async (tx) => {
      const counters = tx.orm.public.ApprovalFlowNumberCounters
      let counter = await counters.where({ tenantId, formType: 'CONTRACT' }).first()
      const currentNumber = counter?.nextValue ?? 1
      if (counter) {
        counter = await counters.where({ id: counter.id }).update({
          nextValue: currentNumber + 1,
          updatedAt: prisma8Now(),
        })
      } else {
        counter = await counters.create({
          tenantId,
          formType: 'CONTRACT',
          nextValue: 2,
          updatedAt: prisma8Now(),
        })
      }
      if (!counter) throw new Error('Demo 审批编号计数器创建失败')

      const flow = await tx.orm.public.ApprovalFlows.create({
        tenantId,
        number: `CTR-APV-${String(currentNumber).padStart(5, '0')}`,
        formType: 'CONTRACT',
        name: '大额合同审批',
        enabled: true,
        condition: jsonValue({ amountGte: 80000 }),
        createdById: adminId,
        updatedById: adminId,
        updatedAt: prisma8Now(),
      })
      const version = await tx.orm.public.ApprovalFlowVersions.create({
        flowId: flow.id,
        tenantId,
        version: 1,
        createdById: adminId,
      })

      const nodes = tx.orm.public.ApprovalNodes
      const start = await nodes.create({
        flowVersionId: version.id,
        number: 'PN001',
        name: '开始',
        nodeType: 'START',
        sort: 0,
      })
      const leader = await nodes.create({
        flowVersionId: version.id,
        number: 'PN002',
        name: '直属上级审批',
        nodeType: 'APPROVER',
        sort: 1,
      })
      const finalApprover = await nodes.create({
        flowVersionId: version.id,
        number: 'PN003',
        name: '管理员终审',
        nodeType: 'APPROVER',
        sort: 2,
      })
      const end = await nodes.create({
        flowVersionId: version.id,
        number: 'PN004',
        name: '结束',
        nodeType: 'END',
        sort: 3,
      })

      const approvers = tx.orm.public.ApprovalNodeApprovers
      await approvers.create({
        nodeId: leader.id,
        approverType: 'DIRECT_LEADER',
        approverIds: [],
        mode: 'ANY',
      })
      await approvers.create({
        nodeId: finalApprover.id,
        approverType: 'USER',
        approverIds: [adminId],
        mode: 'ANY',
      })
      await tx.orm.public.ApprovalNodeLinks.createAll([
        { flowVersionId: version.id, fromNodeId: start.id, toNodeId: leader.id, sort: 0 },
        {
          flowVersionId: version.id,
          fromNodeId: leader.id,
          toNodeId: finalApprover.id,
          sort: 1,
        },
        { flowVersionId: version.id, fromNodeId: finalApprover.id, toNodeId: end.id, sort: 2 },
      ])
      const updated = await tx.orm.public.ApprovalFlows.where({ id: flow.id }).update({
        currentVersionId: version.id,
        updatedAt: prisma8Now(),
      })
      if (!updated) throw new Error('Demo 审批流 currentVersion 写入失败')
    })
  }

  const sources = prisma.orm.public.BiddingSources
  if (!(await sources.where({ tenantId, provider: 'demo' }).first())) {
    await sources.create({
      tenantId,
      provider: 'demo',
      name: '演示数据源（模拟数据）',
      enabled: true,
      updatedAt: prisma8Now(),
    })
  }
  const keywords = prisma.orm.public.BiddingKeywordSubs
  if (!(await keywords.where({ tenantId, keyword: '软件' }).first())) {
    await keywords.create({
      tenantId,
      keyword: '软件',
      enabled: true,
    })
  }
}

async function seedDemoBusinessSamples(
  prisma: DemoClient,
  input: {
    tenantId: string
    adminId: string
    managerId: string
    sales1Id: string
    sales2Id: string
  },
) {
  const organizationId = input.tenantId
  const actorId = input.adminId
  const managerId = input.managerId
  const sales1Id = input.sales1Id
  const sales2Id = input.sales2Id
  const now = BigInt(Date.now())

  const forms = prisma.orm.public.SysModuleForm
  const customerForm = await forms.where({ organizationId, formKey: 'customer' }).first()
  const leadForm = await forms.where({ organizationId, formKey: 'lead' }).first()
  const contactForm = await forms.where({ organizationId, formKey: 'contact' }).first()
  if (!customerForm || !leadForm || !contactForm) {
    throw new Error('Demo 业务样例依赖的模块表单不存在')
  }

  const customerFieldIds = new Map(
    (await prisma.orm.public.SysModuleField.where({ formId: customerForm.id }).all()).map(
      (field) => [field.internalKey, field.id],
    ),
  )
  const leadFieldIds = new Map(
    (await prisma.orm.public.SysModuleField.where({ formId: leadForm.id }).all()).map((field) => [
      field.internalKey,
      field.id,
    ]),
  )
  const contactFieldIds = new Map(
    (await prisma.orm.public.SysModuleField.where({ formId: contactForm.id }).all()).map(
      (field) => [field.internalKey, field.id],
    ),
  )

  const customers = prisma.orm.public.Customer
  if ((await customers.where({ organizationId }).all()).length === 0) {
    const seeds = [
      [
        '深圳市星辰科技有限公司',
        sales1Id,
        '软件与信息服务',
        '0755-88886666',
        'contact@xingchen.example.com',
        '',
      ],
      [
        '广州云帆贸易有限公司',
        sales1Id,
        '进出口贸易',
        '020-66668888',
        'hello@yunfan.example.com',
        '',
      ],
      ['北京恒远制造集团', sales2Id, '装备制造', '010-58889999', '', '重点客户，季度回访'],
      ['上海蓝湾数字科技', managerId, '互联网', '021-52001234', '', ''],
      ['杭州清风电子商务有限公司', actorId, '电子商务', '', '', ''],
    ] as const
    for (const [name, owner, industry, phone, email, remark] of seeds) {
      const customer = await customers.create({
        id: createLegacyId32(),
        name: name,
        owner,
        collectionTime: now,
        createTime: now,
        updateTime: now,
        createUser: actorId,
        updateUser: actorId,
        inSharedPool: false,
        organizationId,
      })
      const normalValues = [
        ['cf_industry', industry],
        ['cf_phone', phone],
        ['cf_email', email],
      ] as const
      for (const [key, value] of normalValues) {
        const fieldId = customerFieldIds.get(key)
        if (!fieldId || !value) continue
        await prisma.orm.public.CustomerField.create({
          id: createLegacyId32(),
          resourceId: customer.id,
          fieldId,
          fieldValue: value,
        })
      }
      const remarkFieldId = customerFieldIds.get('cf_remark')
      if (remarkFieldId && remark) {
        await prisma.orm.public.CustomerFieldBlob.create({
          id: createLegacyId32(),
          resourceId: customer.id,
          fieldId: remarkFieldId,
          fieldValue: remark,
        })
      }
    }
  }

  const clues = prisma.orm.public.Clue
  let activeClue = await clues.where({ organizationId, name: '华南数字化升级项目' }).first()
  if (!activeClue) {
    activeClue = await clues.create({
      id: createLegacyId32(),
      name: '华南数字化升级项目',
      owner: sales1Id,
      stage: 'NEW',
      contact: '陈经理',
      phone: '13800000001',
      organizationId,
      createTime: now,
      updateTime: now,
      createUser: actorId,
      updateUser: actorId,
      inSharedPool: false,
      collectionTime: now,
    })
  }
  if (!activeClue) throw new Error('Demo 活跃线索创建失败')

  const sourceFieldId = leadFieldIds.get('cf_source')
  const levelFieldId = leadFieldIds.get('cf_level')
  const notesFieldId = leadFieldIds.get('cf_notes')
  if (sourceFieldId) await upsertClueField(prisma, activeClue.id, sourceFieldId, '官网表单')
  if (levelFieldId) await upsertClueField(prisma, activeClue.id, levelFieldId, 'A')
  if (notesFieldId) {
    await upsertClueFieldBlob(prisma, activeClue.id, notesFieldId, '来自官网的重点演示线索')
  }

  const cluePool = await prisma.orm.public.CluePool.where({
    organizationId,
    name: '默认线索池',
  }).first()
  if (!cluePool) throw new Error('Demo 默认线索池不存在')
  if (!(await clues.where({ organizationId, name: '公海演示线索' }).first())) {
    await clues.create({
      id: createLegacyId32(),
      name: '公海演示线索',
      owner: null,
      stage: 'NEW',
      organizationId,
      createTime: now,
      updateTime: now,
      createUser: actorId,
      updateUser: actorId,
      inSharedPool: true,
      poolId: cluePool.id,
    })
  }

  const customerPool = await prisma.orm.public.CustomerPool.where({
    organizationId,
    name: '默认客户公海',
  }).first()
  if (!customerPool) throw new Error('Demo 默认客户公海不存在')
  if ((await customers.where({ organizationId, inSharedPool: true }).all()).length === 0) {
    await customers.create({
      id: createLegacyId32(),
      name: '公海演示客户',
      owner: null,
      poolId: customerPool.id,
      createTime: now,
      updateTime: now,
      createUser: actorId,
      updateUser: actorId,
      inSharedPool: true,
      organizationId,
    })
  }

  const firstCustomer = await customers
    .where({ organizationId, inSharedPool: false })
    .orderBy((row) => row.createTime.asc())
    .first()
  if (!firstCustomer) return

  const contacts = prisma.orm.public.CustomerContact
  let contact = await contacts
    .where({
      organizationId,
      customerId: firstCustomer.id,
      name: '陈经理',
    })
    .first()
  if (!contact) {
    contact = await contacts.create({
      id: createLegacyId32(),
      customerId: firstCustomer.id,
      name: '陈经理',
      phone: '13900000001',
      owner: sales1Id,
      createTime: now,
      updateTime: now,
      createUser: actorId,
      updateUser: actorId,
      enable: true,
      organizationId,
    })
  }
  if (!contact) throw new Error('Demo 联系人创建失败')

  const contactPositionFieldId = contactFieldIds.get('cf_position')
  if (contactPositionFieldId) {
    await upsertContactField(prisma, contact.id, contactPositionFieldId, '技术负责人')
  }
  const contactNotesFieldId = contactFieldIds.get('cf_notes')
  if (contactNotesFieldId) {
    await upsertContactFieldBlob(
      prisma,
      contact.id,
      contactNotesFieldId,
      '负责数字化升级项目的技术评估',
    )
  }

  const collaborations = prisma.orm.public.CustomerCollaboration
  let collaboration = await collaborations
    .where({ customerId: firstCustomer.id, userId: sales2Id })
    .first()
  if (collaboration) {
    collaboration = await collaborations.where({ id: collaboration.id }).update({
      collaborationType: 'COLLABORATION',
      updateTime: now,
      updateUser: actorId,
    })
  } else {
    collaboration = await collaborations.create({
      id: createLegacyId32(),
      customerId: firstCustomer.id,
      userId: sales2Id,
      collaborationType: 'COLLABORATION',
      createTime: now,
      updateTime: now,
      createUser: actorId,
      updateUser: actorId,
    })
  }
  if (!collaboration) throw new Error('Demo 客户协作关系创建失败')

  const ordinaryCustomers = await customers
    .where({ organizationId, inSharedPool: false })
    .orderBy((row) => row.createTime.asc())
    .all()
  const relatedCustomer = ordinaryCustomers.find((item) => item.id !== firstCustomer.id)
  if (relatedCustomer) {
    const relations = prisma.orm.public.CustomerRelation
    if (
      !(await relations
        .where({ sourceCustomerId: firstCustomer.id, targetCustomerId: relatedCustomer.id })
        .first())
    ) {
      await relations.create({
        id: createLegacyId32(),
        sourceCustomerId: firstCustomer.id,
        targetCustomerId: relatedCustomer.id,
        createTime: now,
      })
    }
  }

  if (!(await clues.where({ organizationId, name: '已转换演示线索' }).first())) {
    await clues.create({
      id: createLegacyId32(),
      name: '已转换演示线索',
      owner: sales2Id,
      lastStage: 'NEW',
      stage: 'FOLLOWING',
      contact: '周经理',
      phone: '13800000002',
      organizationId,
      createTime: now,
      updateTime: now,
      createUser: actorId,
      updateUser: actorId,
      transitionType: 'CUSTOMER',
      transitionId: firstCustomer.id,
      inSharedPool: false,
      collectionTime: now,
    })
  }

  const historyStart = now - 14n * 24n * 60n * 60n * 1000n
  const historyEnd = now - 7n * 24n * 60n * 60n * 1000n
  const activeHistoryClue = (
    await clues
      .where({ organizationId, inSharedPool: false })
      .orderBy((row) => row.createTime.asc())
      .all()
  ).find((item) => item.transitionType !== 'CUSTOMER')
  if (activeHistoryClue) {
    const owners = prisma.orm.public.ClueOwner
    if (!(await owners.where({ clueId: activeHistoryClue.id }).first())) {
      await owners.create({
        id: createLegacyId32(),
        clueId: activeHistoryClue.id,
        owner: managerId,
        collectionTime: historyStart,
        endTime: historyEnd,
        operator: actorId,
        reasonId: null,
      })
    }
  }
  const customerOwners = prisma.orm.public.CustomerOwner
  if (!(await customerOwners.where({ customerId: firstCustomer.id }).first())) {
    await customerOwners.create({
      id: createLegacyId32(),
      customerId: firstCustomer.id,
      owner: managerId,
      collectionTime: historyStart,
      endTime: historyEnd,
      operator: actorId,
      reasonId: null,
    })
  }

  console.log('Seed 完成，演示账号已初始化')
}

async function upsertClueField(
  prisma: DemoClient,
  resourceId: string,
  fieldId: string,
  value: string,
) {
  const collection = prisma.orm.public.ClueField
  const existing = await collection.where({ resourceId, fieldId }).first()
  if (existing) {
    await collection.where({ id: existing.id }).update({ fieldValue: value })
    return
  }
  await collection.create({
    id: createLegacyId32(),
    resourceId,
    fieldId,
    fieldValue: value,
  })
}

async function upsertClueFieldBlob(
  prisma: DemoClient,
  resourceId: string,
  fieldId: string,
  value: string,
) {
  const collection = prisma.orm.public.ClueFieldBlob
  const existing = await collection.where({ resourceId, fieldId }).first()
  if (existing) {
    await collection.where({ id: existing.id }).update({ fieldValue: value })
    return
  }
  await collection.create({ id: createLegacyId32(), resourceId, fieldId, fieldValue: value })
}

async function upsertContactField(
  prisma: DemoClient,
  resourceId: string,
  fieldId: string,
  value: string,
) {
  const collection = prisma.orm.public.CustomerContactField
  const existing = await collection.where({ resourceId, fieldId }).first()
  if (existing) {
    await collection.where({ id: existing.id }).update({ fieldValue: value })
    return
  }
  await collection.create({
    id: createLegacyId32(),
    resourceId,
    fieldId,
    fieldValue: value,
  })
}

async function upsertContactFieldBlob(
  prisma: DemoClient,
  resourceId: string,
  fieldId: string,
  value: string,
) {
  const collection = prisma.orm.public.CustomerContactFieldBlob
  const existing = await collection.where({ resourceId, fieldId }).first()
  if (existing) {
    await collection.where({ id: existing.id }).update({ fieldValue: value })
    return
  }
  await collection.create({ id: createLegacyId32(), resourceId, fieldId, fieldValue: value })
}
