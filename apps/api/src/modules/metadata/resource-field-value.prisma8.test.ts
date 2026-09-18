import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { FieldVO } from '@micromatrix/shared'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Id32, prisma8Varchar, prisma8Varchars } from '../../prisma/prisma8-varchar'
import { openPrismaTestDatabase } from '../../testing/prisma-test-db'
import type { ModuleFormsService } from './module-forms.service'
import {
  RESOURCE_FIELD_TYPES,
  ResourceFieldValueService,
} from './resource-field-value.service'

const databaseUrl = process.env['DATABASE_URL']

function shortId(prefix: string) {
  return `${prefix}${randomUUID().replaceAll('-', '')}`.slice(0, 32)
}

const filterFields: FieldVO[] = [
  {
    id: 'p8-field-score',
    module: 'customer',
    key: 'cf_score',
    label: '评分',
    type: 'number',
    required: false,
    system: false,
    hidden: false,
    options: null,
    config: null,
    sort: 1,
    span: 12,
    showInList: true,
    listWidth: null,
  },
  {
    id: 'p8-field-tags',
    module: 'customer',
    key: 'cf_tags',
    label: '标签',
    type: 'multiselect',
    required: false,
    system: false,
    hidden: false,
    options: [
      { label: '重点', value: 'important' },
      { label: '普通', value: 'normal' },
    ],
    config: null,
    sort: 2,
    span: 12,
    showInList: true,
    listWidth: null,
  },
  {
    id: 'p8-field-date',
    module: 'customer',
    key: 'cf_date',
    label: '日期',
    type: 'datetime',
    required: false,
    system: false,
    hidden: false,
    options: null,
    config: null,
    sort: 3,
    span: 12,
    showInList: true,
    listWidth: null,
  },
]

test(
  'Metadata Prisma 8 raw filter 覆盖 14 类静态资源表并保持组织隔离与字段语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8 = testDb.client
    const moduleForms = {
      listFields: async () => filterFields,
    } as unknown as ModuleFormsService
    const service = new ResourceFieldValueService(
      moduleForms,
      { client: prisma8 } as Prisma8Service,
    )
    const organizationId = shortId('p8meta')
    const otherOrganizationId = shortId('p8other')
    const actorId = shortId('p8user')
    const timestamp = BigInt(Date.now())
    const customerIds: string[] = []

    try {
      for (const resourceType of RESOURCE_FIELD_TYPES) {
        assert.deepEqual(
          await service.filterResourceIds(shortId('empty'), resourceType, []),
          [],
          `${resourceType} static resource-table query should execute`,
        )
      }

      const actor = prisma8Varchar(actorId, 32)
      const target = await prisma8.orm.public.Customer
        .select('id')
        .create({
          id: prisma8Id32(),
          name: prisma8Varchar(`Prisma8 Metadata ${randomUUID()}`, 255),
          organizationId: prisma8Varchar(organizationId, 32),
          createTime: timestamp,
          updateTime: timestamp,
          createUser: actor,
          updateUser: actor,
        })
      const lowScore = await prisma8.orm.public.Customer
        .select('id')
        .create({
          id: prisma8Id32(),
          name: prisma8Varchar(`Prisma8 Metadata low ${randomUUID()}`, 255),
          organizationId: prisma8Varchar(organizationId, 32),
          createTime: timestamp,
          updateTime: timestamp,
          createUser: actor,
          updateUser: actor,
        })
      const otherTenant = await prisma8.orm.public.Customer
        .select('id')
        .create({
          id: prisma8Id32(),
          name: prisma8Varchar(`Prisma8 Metadata other ${randomUUID()}`, 255),
          organizationId: prisma8Varchar(otherOrganizationId, 32),
          createTime: timestamp,
          updateTime: timestamp,
          createUser: actor,
          updateUser: actor,
        })
      customerIds.push(target.id, lowScore.id, otherTenant.id)

      await prisma8.orm.public.CustomerField.createAll([
          { resourceId: target.id, fieldId: 'p8-field-score', fieldValue: '88' },
          {
            resourceId: target.id,
            fieldId: 'p8-field-date',
            fieldValue: '2026-09-10T12:00:00.000Z',
          },
          { resourceId: lowScore.id, fieldId: 'p8-field-score', fieldValue: '40' },
          {
            resourceId: lowScore.id,
            fieldId: 'p8-field-date',
            fieldValue: '2026-08-10T12:00:00.000Z',
          },
          { resourceId: otherTenant.id, fieldId: 'p8-field-score', fieldValue: '88' },
          {
            resourceId: otherTenant.id,
            fieldId: 'p8-field-date',
            fieldValue: '2026-09-10T12:00:00.000Z',
          },
        ].map((item) => ({
          id: prisma8Id32(),
          resourceId: item.resourceId,
          fieldId: prisma8Varchar(item.fieldId, 32),
          fieldValue: prisma8Varchar(item.fieldValue, 255),
        })))
      await prisma8.orm.public.CustomerFieldBlob.createAll([
          {
            resourceId: target.id,
            fieldId: 'p8-field-tags',
            fieldValue: JSON.stringify(['important']),
          },
          {
            resourceId: lowScore.id,
            fieldId: 'p8-field-tags',
            fieldValue: JSON.stringify(['normal']),
          },
          {
            resourceId: otherTenant.id,
            fieldId: 'p8-field-tags',
            fieldValue: JSON.stringify(['important']),
          },
        ].map((item) => ({
          id: prisma8Id32(),
          resourceId: item.resourceId,
          fieldId: prisma8Varchar(item.fieldId, 32),
          fieldValue: item.fieldValue,
        })))

      assert.deepEqual(
        await service.filterResourceIds(organizationId, 'customer', [
          { key: 'cf_score', op: 'gte', value: 60 },
          { key: 'cf_tags', op: 'contains', value: 'important' },
          { key: 'cf_date', op: 'gte', value: '2026-09-01T00:00:00.000Z' },
        ]),
        [target.id],
      )
      assert.deepEqual(
        await service.filterResourceIds(otherOrganizationId, 'customer', [
          { key: 'cf_score', op: 'gte', value: 60 },
          { key: 'cf_tags', op: 'contains', value: 'important' },
        ]),
        [otherTenant.id],
      )
    } finally {
      if (customerIds.length) {
        await prisma8.orm.public.Customer
          .where((row) => row.id.in(prisma8Varchars(customerIds, 32)))
          .deleteAll()
      }
      await testDb.close()
    }
  },
)
