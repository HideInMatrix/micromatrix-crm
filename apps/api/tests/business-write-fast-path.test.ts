import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { AuthUser } from '../src/common/auth-user'
import type { CustomersService } from '../src/customers/customers.service'
import type { LeadsService } from '../src/modules/leads/leads.service'

const id = () => randomUUID().replaceAll('-', '')

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid')
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname))
  assert.equal(url.pathname, '/crm_round2_outbox_test')
  const { PrismaService } = await import('../src/prisma.service')
  const { nowInstant } = await import('../src/prisma/temporal')
  const { ModuleFormsService } = await import('../src/modules/metadata/module-forms.service')
  const { ResourceFieldValueService } =
    await import('../src/modules/metadata/resource-field-value.service')
  const { PoolRecycleTaskService } =
    await import('../src/modules/pool-rules/pool-recycle-task.service')
  const { ResourceRecycleConditionEvaluator } =
    await import('../src/modules/pool-rules/resource-recycle-condition-evaluator.service')
  const { CustomersService } = await import('../src/customers/customers.service')
  const { LeadsService } = await import('../src/modules/leads/leads.service')
  const { ExternalEventPerformance } = await import('../src/common/external-event-performance')
  const prisma = new PrismaService()
  const orm = prisma.client.orm.public
  const tenantId = id()
  const actor = id()
  const user: AuthUser = {
    id: actor,
    tenantId,
    name: 'fixture',
    email: null,
    deptId: null,
    leaderId: null,
    roles: [],
    permissions: ['*'],
  }
  const forms = new ModuleFormsService(prisma)
  const fields = new ResourceFieldValueService(forms, prisma)
  const recycle = new PoolRecycleTaskService(
    prisma,
    new ResourceRecycleConditionEvaluator(),
    {} as never,
  )
  const now = BigInt(Date.now())
  const timestamps = { createTime: now, updateTime: now, createUser: actor, updateUser: actor }
  const poolId = id()
  const metadata = {
    fieldsMap: async (tenant: string, form: string) =>
      new Map((await forms.listFields(tenant, form)).map((field) => [field.key, field])),
    hasUniqueRule: async () => false,
  }
  // Keep actual public create/transaction services and real DB field/recycle code.
  // Stub unrelated response projection, permission scope and provider notifications.
  const common = {
    prisma,
    metadata,
    moduleForms: forms,
    fieldValues: fields,
    recycleTasks: recycle,
    pools: { assertCapacityForOwner: async () => {} },
    notifications: { send: async () => 0 },
    dataScope: { directOwnerFilter: async () => ({ owner: actor }) },
    toSingleVO: async (_user: AuthUser, row: unknown) => row,
  }
  const customers = Object.assign(
    Object.create(CustomersService.prototype),
    common,
  ) as CustomersService
  const leads = Object.assign(Object.create(LeadsService.prototype), common, {
    customers,
  }) as LeadsService
  try {
    await orm.Tenants.create({
      id: tenantId,
      name: 'write fixture',
      slug: tenantId,
      updatedAt: nowInstant(),
    })
    await orm.Users.create({
      id: actor,
      tenantId,
      name: 'fixture',
      passwordHash: 'unused-test-fixture',
      updatedAt: nowInstant(),
    })
    const unique = await forms.createField(
      tenantId,
      'lead',
      { label: 'Fixture unique', type: 'text', required: true, config: { unique: true } },
      actor,
    )
    const note = await forms.createField(
      tenantId,
      'lead',
      { label: 'Fixture note', type: 'textarea' },
      actor,
    )
    const file = await forms.createField(
      tenantId,
      'lead',
      { label: 'Fixture file', type: 'attachment' },
      actor,
    )
    const file2 = await forms.createField(
      tenantId,
      'lead',
      { label: 'Fixture file 2', type: 'attachment' },
      actor,
    )
    const customerField = await forms.createField(
      tenantId,
      'customer',
      { label: 'Fixture customer field', type: 'text' },
      actor,
    )
    const recordField = await forms.createField(
      tenantId,
      'followRecord',
      { label: 'Fixture record', type: 'text' },
      actor,
    )
    const recordBlob = await forms.createField(
      tenantId,
      'followRecord',
      { label: 'Fixture record blob', type: 'textarea' },
      actor,
    )
    const planField = await forms.createField(
      tenantId,
      'followPlan',
      { label: 'Fixture plan', type: 'text' },
      actor,
    )
    const planBlob = await forms.createField(
      tenantId,
      'followPlan',
      { label: 'Fixture plan blob', type: 'textarea' },
      actor,
    )

    const original = await forms.getConfig(tenantId, 'lead')
    const internals = forms as unknown as { ensureForm: (...args: unknown[]) => Promise<unknown> }
    const ensureForm = internals.ensureForm.bind(forms)
    let repairs = 0
    internals.ensureForm = (...args) => {
      repairs++
      return ensureForm(...args)
    }
    assert.deepEqual(await forms.getConfig(tenantId, 'lead'), original)
    assert.deepEqual(
      await prisma.client.transaction((tx) => forms.listFieldsInTransaction(tx, tenantId, 'lead')),
      original.fields,
    )
    assert.equal(repairs, 0, 'initialized config must not execute ensureForm')
    const form = await orm.SysModuleForm.where({
      organizationId: tenantId,
      formKey: 'lead',
    }).first()
    assert.ok(form)
    await orm.SysModuleFormBlob.where({ id: form.id }).deleteAndCount()
    await forms.getConfig(tenantId, 'lead')
    assert.equal(repairs, 1, 'missing blob must still be repaired')
    assert.ok(await orm.SysModuleFormBlob.where({ id: form.id }).first())
    const system = await orm.SysModuleField.where({ formId: form.id, internalKey: 'name' }).first()
    assert.ok(system)
    await orm.SysModuleField.where({ id: system.id }).update({
      mobile: false,
      updateUser: system.createUser,
      updateTime: system.createTime,
    })
    await forms.getConfig(tenantId, 'lead')
    assert.equal((await orm.SysModuleField.where({ id: system.id }).first())?.mobile, true)
    await orm.SysModuleField.where({ id: system.id }).update({
      mobile: false,
      updateTime: system.createTime + 1n,
    })
    await forms.getConfig(tenantId, 'lead')
    assert.equal(
      (await orm.SysModuleField.where({ id: system.id }).first())?.mobile,
      false,
      'intentional mobile setting is preserved',
    )
    console.log('Initialized form reads, blob repair and intentional mobile configuration passed.')

    const add = (value: string, extra: Record<string, unknown> = {}) =>
      leads.create(user, { name: 'fixture lead', customData: { [unique.key]: value, ...extra } })
    const find = async (leadId: string) => {
      const row = await orm.Clue.where({ organizationId: tenantId, id: leadId }).first()
      assert.ok(row)
      return row
    }
    const external = (
      value: string,
      extra: Record<string, unknown> = {},
      perf?: InstanceType<typeof ExternalEventPerformance>,
    ) =>
      prisma.client.transaction((tx) =>
        leads.createPreparedExternalLeadInTransaction(
          user,
          {
            dto: { name: 'fixture external', customData: { [unique.key]: value, ...extra } },
            owner: { id: actor, deptId: null },
            targetPool: null,
            uniqueScope: undefined,
          } as never,
          tx,
          perf,
        ),
      )
    const count = async () => (await orm.Clue.where({ organizationId: tenantId }).all()).length
    const attachment = () =>
      orm.Attachments.create({
        tenantId,
        uploaderId: actor,
        name: 'fixture.txt',
        path: 'fixture/no-file',
        size: 1,
        mime: 'text/plain',
      })
    const uploaded = await attachment()
    const first = await add('manual', { [note.key]: 'long note', [file.key]: [uploaded.id] })
    const stored = await fields.load(tenantId, 'clue', [first.id])
    assert.deepEqual(stored.get(first.id), {
      [unique.key]: 'manual',
      [note.key]: 'long note',
      [file.key]: [uploaded.id],
    })
    assert.equal((await orm.Attachments.where({ id: uploaded.id }).first())?.targetId, first.id)
    await prisma.client.transaction((tx) =>
      fields.save(tenantId, 'clue', first.id, { [note.key]: '' }, 'update', tx, actor),
    )
    assert.equal(
      (await fields.load(tenantId, 'clue', [first.id])).get(first.id)?.[note.key],
      undefined,
    )

    const before = await count()
    const race = await Promise.allSettled([add('same value'), external('same value')])
    assert.equal(race.filter((row) => row.status === 'fulfilled').length, 1)
    for (const row of race)
      if (row.status === 'rejected') assert.match(String(row.reason), /不能重复/)
    assert.equal(await count(), before + 1)
    const temp = await attachment()
    await assert.rejects(external('manual', { [file.key]: [temp.id] }), /不能重复/)
    assert.equal((await orm.Attachments.where({ id: temp.id }).first())?.targetId, null)
    await assert.rejects(
      external('different', { [file.key]: [temp.id], [file2.key]: [temp.id] }),
      /多个/,
    )
    await assert.rejects(external('different', { [file.key]: [uploaded.id] }), /其他业务对象/)
    await assert.rejects(external(''), /必填/)
    await assert.rejects(external('different', { unknown_key: 'x' }), /不存在或不可写/)
    await assert.rejects(
      prisma.client.transaction((tx) =>
        fields.saveNew(tenantId, 'clue', { id: first.id, organizationId: id() }, {}, tx, actor),
      ),
      /业务数据不存在/,
    )
    assert.equal(await count(), before + 1)
    let arrivals = 0
    let release!: () => void
    const ready = new Promise<void>((resolve) => {
      release = resolve
    })
    const concurrentInsert = () =>
      prisma.client.transaction(async (tx) => {
        const created = await tx.orm.public.Clue.create({
          id: id(),
          name: 'fixture',
          organizationId: tenantId,
          owner: actor,
          collectionTime: now,
          ...timestamps,
        })
        if (++arrivals === 2) release()
        await ready
        await fields.saveNew(
          tenantId,
          'clue',
          created,
          { [unique.key]: 'locked duplicate' },
          tx,
          actor,
        )
        return created
      })
    const locked = await Promise.allSettled([concurrentInsert(), concurrentInsert()])
    assert.equal(arrivals, 2)
    assert.equal(locked.filter((result) => result.status === 'fulfilled').length, 1)
    for (const result of locked)
      if (result.status === 'rejected') assert.match(String(result.reason), /不能重复/)
    assert.equal(await count(), before + 2)
    console.log(
      'Manual/external concurrent unique checks, locked fresh insert race, update deletion, file binding, rollback and tenant guard passed.',
    )

    // New resource snapshots must still schedule real automatic recycle plans.
    await orm.CluePool.create({
      id: poolId,
      name: 'fixture pool',
      organizationId: tenantId,
      ownerId: '["*"]',
      scopeId: '["*"]',
      auto: true,
      enable: true,
      ...timestamps,
    })
    await orm.CluePoolRecycleRule.create({
      id: id(),
      poolId,
      operator: 'AND',
      condition: JSON.stringify([
        {
          column: 'storageTime',
          operator: 'DYNAMICS',
          value: 'CUSTOM,2,BEFORE_MINUTE',
          scope: ['Picked'],
        },
      ]),
      ...timestamps,
    })
    let tick = 0
    const perf = new ExternalEventPerformance(true, () => (tick += 100))
    const source = await external('with-plan', {}, perf)
    const taskQuery = () =>
      orm.PoolRecycleTask.where({
        organizationId: tenantId,
        resourceType: 'lead',
        resourceId: source.id,
      })
    const task = await taskQuery().first()
    assert.ok(task)
    assert.equal(task.status, 'PENDING')
    assert.equal(task.generation, 1)
    assert.equal(task.expectedOwnerId, actor)
    assert.equal(task.dueAt, source.collectionTime! + 120001n)
    await prisma.client.transaction((tx) =>
      recycle.refreshLeadInTransaction(tx, tenantId, source.id),
    )
    assert.equal((await taskQuery().first())?.generation, 2)
    // Newest matching automatic pool without a rule still shadows the older rule.
    const newerPoolId = id()
    await orm.CluePool.create({
      id: newerPoolId,
      name: 'newer pool',
      organizationId: tenantId,
      ownerId: '["*"]',
      scopeId: '["*"]',
      auto: true,
      enable: true,
      ...timestamps,
      createTime: now + 1n,
    })
    await prisma.client.transaction((tx) =>
      recycle.refreshLeadInTransaction(tx, tenantId, source.id),
    )
    assert.equal((await taskQuery().first())?.status, 'CANCELED')
    assert.equal((await taskQuery().first())?.generation, 3)
    await orm.CluePool.where({ id: newerPoolId }).deleteAndCount()
    await prisma.client.transaction((tx) =>
      recycle.refreshLeadInTransaction(tx, tenantId, source.id),
    )
    assert.equal((await taskQuery().first())?.status, 'PENDING')

    // Use actual new-field writes for follow records/plans and verify batched
    // copy preserves both storage types, source records, and convertedRecordId.
    for (let i = 0; i < 3; i++) {
      await prisma.client.transaction(async (tx) => {
        const record = await tx.orm.public.FollowUpRecords.create({
          tenantId,
          targetType: 'lead',
          targetId: source.id,
          content: 'record ' + i,
          ownerId: actor,
          ownerName: 'fixture',
          createdById: actor,
          updatedAt: nowInstant(),
        })
        await fields.saveNew(
          tenantId,
          'followRecord',
          record,
          { [recordField.key]: 'record ' + i, [recordBlob.key]: 'record blob ' + i },
          tx,
          actor,
        )
        const plan = await tx.orm.public.FollowUpPlans.create({
          tenantId,
          targetType: 'lead',
          targetId: source.id,
          content: 'plan ' + i,
          ownerId: actor,
          createdById: actor,
          status: 'COMPLETED',
          converted: true,
          convertedRecordId: record.id,
          updatedAt: nowInstant(),
        })
        await fields.saveNew(
          tenantId,
          'followPlan',
          plan,
          { [planField.key]: 'plan ' + i, [planBlob.key]: 'plan blob ' + i },
          tx,
          actor,
        )
      })
    }
    const manualCustomer = await customers.create(user, {
      name: 'manual customer',
      customData: { [customerField.key]: 'manual customer value' },
    })
    assert.equal(
      (await fields.load(tenantId, 'customer', [manualCustomer.id])).get(manualCustomer.id)?.[
        customerField.key
      ],
      'manual customer value',
    )
    const preparedCustomer = await customers.prepareCreateForTransaction(user, {
      name: 'converted',
      customData: { [customerField.key]: 'converted value' },
    })
    const conversion = {
      lead: source,
      customerCreateDto: {
        name: 'converted',
        customData: { [customerField.key]: 'converted value' },
      },
      customerPrepared: preparedCustomer,
      associationPrepared: { ownerMap: new Map([[actor, { id: actor, deptId: null }]]) },
      allowUnassignedOwner: false,
    }
    const generation = (await taskQuery().first())?.generation
    const beforeCustomers = (await orm.Customer.where({ organizationId: tenantId }).all()).length
    await assert.rejects(
      prisma.client.transaction(async (tx) => {
        await leads.convertResolvedLeadInTransaction(user, conversion, tx)
        throw new Error('forced conversion rollback')
      }),
      /forced conversion rollback/,
    )
    assert.equal((await find(source.id)).transitionId, null)
    assert.equal((await taskQuery().first())?.generation, generation)
    assert.equal(
      (await orm.Customer.where({ organizationId: tenantId }).all()).length,
      beforeCustomers,
    )
    assert.equal(
      (await orm.FollowUpRecords.where({ tenantId, targetType: 'customer' }).all()).length,
      0,
    )
    assert.equal(
      (await orm.FollowUpPlans.where({ tenantId, targetType: 'customer' }).all()).length,
      0,
    )
    const converted = await prisma.client.transaction((tx) =>
      leads.convertResolvedLeadInTransaction(user, conversion, tx, perf),
    )
    assert.equal((await find(source.id)).transitionId, converted.customerId)
    assert.equal((await taskQuery().first())?.status, 'CANCELED')
    const records = await orm.FollowUpRecords.where({
      tenantId,
      targetType: 'customer',
      targetId: converted.customerId,
    }).all()
    const plans = await orm.FollowUpPlans.where({
      tenantId,
      targetType: 'customer',
      targetId: converted.customerId,
    }).all()
    assert.equal(records.length, 3)
    assert.equal(plans.length, 3)
    const recordValues = await fields.load(
      tenantId,
      'followRecord',
      records.map((row) => row.id),
    )
    const planValues = await fields.load(
      tenantId,
      'followPlan',
      plans.map((row) => row.id),
    )
    for (let i = 0; i < 3; i++) {
      const r = records.find((row) => row.content === 'record ' + i)!
      const p = plans.find((row) => row.content === 'plan ' + i)!
      assert.equal(p.convertedRecordId, r.id)
      assert.equal(p.converted, true)
      assert.deepEqual(recordValues.get(r.id), {
        [recordField.key]: 'record ' + i,
        [recordBlob.key]: 'record blob ' + i,
      })
      assert.deepEqual(planValues.get(p.id), {
        [planField.key]: 'plan ' + i,
        [planBlob.key]: 'plan blob ' + i,
      })
    }
    assert.equal(
      (await orm.FollowUpRecords.where({ tenantId, targetType: 'lead', targetId: source.id }).all())
        .length,
      3,
    )
    assert.equal(
      (await orm.FollowUpPlans.where({ tenantId, targetType: 'lead', targetId: source.id }).all())
        .length,
      3,
    )
    let stages: Record<string, number> = {}
    perf.finish('convert', true, (line) => {
      stages = JSON.parse(line).stagesMs
    })
    for (const stage of [
      'lead_insert',
      'customer_insert',
      'field_save',
      'recycle_refresh',
      'conversion_recheck',
      'follow_artifact_copy',
      'conversion_associate',
      'recycle_cancel',
    ]) {
      assert.ok(stage in stages, 'missing stage ' + stage)
    }
    console.log(
      'Real recycle scheduling, shadowing, generation, customer creation, follow artifact copying and sub-stage diagnostics passed.',
    )

    // Actual internal transition uses the same customer path. No external notification provider is called.
    const internalLead = await add('internal-transition')
    const internal = await leads.transitionCustomer(user, {
      clueId: internalLead.id,
      name: 'internal transition',
    })
    assert.equal((await find(internalLead.id)).transitionId, internal.customerId)
    const transformLead = await add('internal-transform')
    const transformed = await leads.transform(user, { clueId: transformLead.id })
    assert.equal((await find(transformLead.id)).transitionId, transformed.customerId)
    console.log('Internal CRM transition and transform paths passed.')

    // Exercise the actual configured-event entry, mapping, owner scope, preparation,
    // transactional writes, Inbox fencing, audit and durable notification intents.
    const { MetadataService } = await import('../src/modules/metadata/metadata.service')
    const { DataScopeService } = await import('../src/common/services/data-scope.service')
    const { CluePoolRepository } = await import('../src/modules/pool-rules/clue-pool.repository')
    const { CustomerPoolRepository } =
      await import('../src/modules/pool-rules/customer-pool.repository')
    const { PoolRuleCalculator } =
      await import('../src/modules/pool-rules/pool-rule-calculator.service')
    const { ResourcePoolsService } =
      await import('../src/modules/pool-rules/resource-pools.service')
    const { ExternalResourceResolverService } =
      await import('../src/modules/external-events/external-resource-resolver.service')
    const { ExternalEventTemplatesService } =
      await import('../src/modules/external-events/external-event-templates.service')
    const { ExternalEventsService } =
      await import('../src/modules/external-events/external-events.service')
    const { ExternalEventNotificationOutboxService } =
      await import('../src/modules/notifications/external-event-notification-outbox.service')
    const recipient = id()
    await orm.Users.create({
      id: recipient,
      tenantId,
      name: 'fixture recipient',
      passwordHash: 'unused-fixture',
      updatedAt: nowInstant(),
    })
    await orm.ExternalUserMappings.create({
      tenantId,
      userId: recipient,
      provider: 'WECOM',
      externalId: 'fixture-recipient',
      externalKey: 'fixture-recipient',
      updatedAt: nowInstant(),
    })
    const calculator = new PoolRuleCalculator()
    const realPools = new ResourcePoolsService(
      prisma,
      new CluePoolRepository(prisma, calculator, recycle),
      new CustomerPoolRepository(prisma, calculator, recycle),
      {} as never,
    )
    const realMetadata = new MetadataService(forms)
    const realScope = new DataScopeService(prisma)
    const actualCommon = {
      ...common,
      metadata: realMetadata,
      dataScope: realScope,
      pools: realPools,
    }
    const actualCustomers = Object.assign(
      Object.create(CustomersService.prototype),
      actualCommon,
    ) as CustomersService
    const actualLeads = Object.assign(Object.create(LeadsService.prototype), actualCommon, {
      customers: actualCustomers,
    }) as LeadsService
    const resolver = new ExternalResourceResolverService(
      prisma,
      realScope,
      realMetadata,
      fields,
      realPools,
    )
    const templates = new ExternalEventTemplatesService(
      prisma,
      realMetadata,
      resolver,
      actualCustomers,
      actualLeads,
    )
    const outbox = new ExternalEventNotificationOutboxService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    )
    const events = new ExternalEventsService(
      prisma,
      resolver,
      actualCustomers,
      actualLeads,
      outbox,
      templates,
    )
    const apiUser: AuthUser = {
      ...user,
      roles: [
        { id: id(), name: 'fixture admin', dataScope: 'ALL', permissions: ['*'], scopeDeptIds: [] },
      ],
    }
    const baseConfig = {
      actions: { convertLead: false, updateCustomer: false },
      matches: [],
      fields: [],
      owner: null,
    }
    const createTemplate = await templates.create(apiUser, {
      name: 'fixture create',
      enabled: true,
      apiKeyUserId: actor,
      config: {
        ...baseConfig,
        flow: {
          target: 'lead',
          action: 'create',
          nameExternalKey: 'studentName',
          owner: { externalKey: 'ownerId', provider: 'WECOM' },
          fields: [
            { source: 'event', externalKey: 'unique', fieldKey: unique.key },
            { source: 'event', externalKey: 'phone', fieldKey: 'phone' },
            {
              source: 'event',
              externalKey: 'pool',
              fieldKey: '__leadPool',
              valueMap: [{ externalValue: 'fixture', crmValue: poolId }],
            },
          ],
        },
      },
    })
    const convertTemplate = await templates.create(apiUser, {
      name: 'fixture convert',
      enabled: true,
      apiKeyUserId: actor,
      config: {
        ...baseConfig,
        matches: [{ externalKey: 'phone', crmFieldKey: 'phone' }],
        flow: {
          target: 'lead',
          action: 'convert',
          owner: { externalKey: 'ownerId', provider: 'WECOM' },
          fields: [],
        },
      },
    })
    const request = {
      eventType: createTemplate.eventType,
      externalEventId: 'fixture-create',
      data: {
        studentName: 'fixture configured',
        unique: 'configured-unique',
        phone: '00000000001',
        ownerId: 'fixture-recipient',
      },
    }
    const createResult = await events.executeConfigured(apiUser, request)
    assert.equal(createResult.replayed, false)
    assert.equal(createResult.attempts, 1)
    assert.equal((await find(createResult.resolvedId!)).owner, recipient)
    const duplicateResult = await events.executeConfigured(apiUser, request)
    assert.equal(duplicateResult.resolvedId, createResult.resolvedId)
    assert.equal(duplicateResult.replayed, true)
    await assert.rejects(
      events.executeConfigured(apiUser, {
        ...request,
        data: { ...request.data, studentName: 'different' },
      }),
      /不同请求内容/,
    )
    const conversionRequest = {
      eventType: convertTemplate.eventType,
      externalEventId: 'fixture-convert',
      data: { phone: request.data.phone, ownerId: request.data.ownerId },
    }
    const convertedResult = await events.executeConfigured(apiUser, conversionRequest)
    assert.equal(convertedResult.replayed, false)
    assert.equal(convertedResult.resolvedId, createResult.resolvedId)
    assert.equal((await find(createResult.resolvedId!)).transitionId, convertedResult.customerId)
    assert.equal(
      (await events.executeConfigured(apiUser, conversionRequest)).customerId,
      convertedResult.customerId,
    )
    const intents = await orm.ExternalEventNotification.where({ tenantId }).all()
    assert.deepEqual(intents.map((x) => x.event).sort(), [
      'CLUE_ADD',
      'CLUE_CONVERT_CUSTOMER',
      'CUSTOMER_ADD',
    ])
    assert.ok(intents.every((x) => x.recipientId === recipient))
    assert.equal(
      (await orm.ExternalEventInbox.where({ organizationId: tenantId, status: 'SUCCESS' }).all())
        .length,
      2,
    )
    assert.equal(
      (await orm.OperationLogs.where({ tenantId, module: 'externalEvent' }).all()).length,
      4,
    )
    // Revocation and template changes must be fresh across requests.
    await orm.ExternalEventTemplates.where({ id: createTemplate.id, tenantId }).update({
      enabled: false,
      updatedAt: nowInstant(),
    })
    await assert.rejects(
      events.executeConfigured(apiUser, { ...request, externalEventId: 'disabled-template' }),
      /不存在或未启用/,
    )
    console.log(
      'Configured create/convert, replay, hash conflict, audit, durable notification intents and template revocation passed.',
    )
  } finally {
    await orm.ExternalEventNotification.where({ tenantId }).deleteAndCount()
    await orm.ExternalEventInbox.where({ organizationId: tenantId }).deleteAndCount()
    await orm.ExternalEventTemplates.where({ tenantId }).deleteAndCount()
    await orm.OperationLogs.where({ tenantId }).deleteAndCount()
    await orm.ExternalUserMappings.where({ tenantId }).deleteAndCount()
    await orm.PoolRecycleTask.where({ organizationId: tenantId }).deleteAndCount()
    await orm.FollowUpPlans.where({ tenantId }).deleteAndCount()
    await orm.FollowUpRecords.where({ tenantId }).deleteAndCount()
    await orm.Attachments.where({ tenantId }).deleteAndCount()
    await orm.Clue.where({ organizationId: tenantId }).deleteAndCount()
    await orm.Customer.where({ organizationId: tenantId }).deleteAndCount()
    await orm.CluePool.where({ organizationId: tenantId }).deleteAndCount()
    await orm.SysModuleForm.where({ organizationId: tenantId }).deleteAndCount()
    await orm.Users.where({ tenantId }).deleteAndCount()
    await orm.Tenants.where({ id: tenantId }).deleteAndCount()
    await prisma.onModuleDestroy()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
