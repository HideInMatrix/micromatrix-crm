import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException } from '@nestjs/common'
import type { FieldVO } from '@micromatrix/shared'
import type { DistributedCoordinatorService } from '../../common/services/distributed-coordinator.service'
import type { PrismaService } from '../../prisma/prisma.service'
import type { AttachmentsService } from '../attachments/attachments.service'
import { ResourceFieldAttachmentCleanupService } from './resource-field-attachment-cleanup.service'
import type { ModuleFormsService } from './module-forms.service'
import { ResourceFieldValueService } from './resource-field-value.service'

interface ValueRow {
  resourceId: string
  fieldId: string
  fieldValue: string
}

interface AttachmentRow {
  id: string
  tenantId: string
  uploaderId: string | null
  name: string
  size: number
  mime: string | null
  targetType: string | null
  targetId: string | null
  createdAt: Date
}

const fileFields = [
  {
    id: 'file-field',
    module: 'customer',
    key: 'cf_files',
    label: '附件',
    type: 'attachment',
    required: false,
    system: false,
    hidden: false,
    options: null,
    config: { accept: '.pdf,.txt', limitSize: '2MB' },
    sort: 1,
    span: 24,
    showInList: false,
    listWidth: null,
  },
  {
    id: 'picture-field',
    module: 'customer',
    key: 'cf_pictures',
    label: '图片',
    type: 'picture',
    required: false,
    system: false,
    hidden: false,
    options: null,
    config: { uploadLimit: 3, uploadSizeLimit: 2 },
    sort: 2,
    span: 24,
    showInList: false,
    listWidth: null,
  },
] as FieldVO[]

function createLifecycleHarness(initialBlob: ValueRow[] = []) {
  const normal: ValueRow[] = []
  const blob = structuredClone(initialBlob)
  const attachments: AttachmentRow[] = [
    {
      id: 'file-a',
      tenantId: 'tenant-a',
      uploaderId: 'user-a',
      name: '资料.pdf',
      size: 1024,
      mime: 'application/pdf',
      targetType: null,
      targetId: null,
      createdAt: new Date('2026-09-01T00:00:00Z'),
    },
    {
      id: 'picture-a',
      tenantId: 'tenant-a',
      uploaderId: 'user-a',
      name: '现场.png',
      size: 1024,
      mime: 'image/png',
      targetType: null,
      targetId: null,
      createdAt: new Date('2026-09-01T00:00:00Z'),
    },
    {
      id: 'foreign-temp',
      tenantId: 'tenant-a',
      uploaderId: 'user-b',
      name: '他人.pdf',
      size: 1024,
      mime: 'application/pdf',
      targetType: null,
      targetId: null,
      createdAt: new Date('2026-09-01T00:00:00Z'),
    },
    {
      id: 'bound-other',
      tenantId: 'tenant-a',
      uploaderId: 'user-a',
      name: '已绑定.pdf',
      size: 1024,
      mime: 'application/pdf',
      targetType: 'resourceField:customer',
      targetId: 'customer-b',
      createdAt: new Date('2026-09-01T00:00:00Z'),
    },
  ]

  function fieldDelegate(rows: ValueRow[]) {
    return {
      findMany: async ({ where }: { where: { resourceId: { in: string[] } } }) =>
        rows.filter((row) => where.resourceId.in.includes(row.resourceId)),
      findFirst: async () => null,
      deleteMany: async ({
        where,
      }: {
        where: { resourceId: string; fieldId: { in: string[] } }
      }) => {
        for (let index = rows.length - 1; index >= 0; index--) {
          const row = rows[index]
          if (
            row &&
            row.resourceId === where.resourceId &&
            where.fieldId.in.includes(row.fieldId)
          ) {
            rows.splice(index, 1)
          }
        }
        return { count: 1 }
      },
      createMany: async ({ data }: { data: ValueRow[] }) => {
        rows.push(...data)
        return { count: data.length }
      },
    }
  }

  const prismaRecord = {
    customer: {
      findFirst: async ({ where }: { where: { id: string; organizationId: string } }) =>
        where.id === 'customer-a' && where.organizationId === 'tenant-a' ? { id: where.id } : null,
    },
    customerField: fieldDelegate(normal),
    customerFieldBlob: fieldDelegate(blob),
    attachment: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        const ids = (where.id as { in?: string[] } | undefined)?.in
        return attachments.filter((row) => {
          if (ids && !ids.includes(row.id)) return false
          if (where.tenantId && row.tenantId !== where.tenantId) return false
          if (
            'targetType' in where &&
            typeof where.targetType === 'string' &&
            row.targetType !== where.targetType
          )
            return false
          if (
            'targetId' in where &&
            typeof where.targetId === 'string' &&
            row.targetId !== where.targetId
          )
            return false
          return true
        })
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: {
          id: { in: string[] }
          uploaderId: string
          tenantId: string
          targetType: null
          targetId: null
        }
        data: { targetType: string; targetId: string }
      }) => {
        let count = 0
        for (const row of attachments) {
          if (
            where.id.in.includes(row.id) &&
            row.tenantId === where.tenantId &&
            row.uploaderId === where.uploaderId &&
            row.targetType === null &&
            row.targetId === null
          ) {
            row.targetType = data.targetType
            row.targetId = data.targetId
            count++
          }
        }
        return { count }
      },
    },
    $queryRaw: async () => [],
  }
  const moduleForms = {
    listFields: async () => fileFields,
    listFieldsInTransaction: async () => fileFields,
  } as unknown as ModuleFormsService
  const prisma = prismaRecord as unknown as PrismaService
  return {
    service: new ResourceFieldValueService(prisma, moduleForms),
    tx: prismaRecord as never,
    attachments,
    blob,
  }
}

test('资源字段 attachment/picture 保存时事务内 claim，并以 Blob 数组往返', async () => {
  const { service, tx, attachments, blob } = createLifecycleHarness()
  await service.save(
    'tenant-a',
    'customer',
    'customer-a',
    { cf_files: ['file-a'], cf_pictures: ['picture-a'] },
    'create',
    tx,
    'user-a',
  )
  assert.deepEqual(
    attachments
      .filter((row) => ['file-a', 'picture-a'].includes(row.id))
      .map((row) => [row.id, row.targetType, row.targetId]),
    [
      ['file-a', 'resourceField:customer', 'customer-a'],
      ['picture-a', 'resourceField:customer', 'customer-a'],
    ],
  )
  assert.deepEqual(blob.map((row) => [row.fieldId, row.fieldValue]).sort(), [
    ['file-field', '["file-a"]'],
    ['picture-field', '["picture-a"]'],
  ])
  const loaded = await service.load('tenant-a', 'customer', ['customer-a'])
  assert.deepEqual(loaded.get('customer-a'), {
    cf_files: ['file-a'],
    cf_pictures: ['picture-a'],
  })
  const attachmentMap = await service.buildAttachmentMap('tenant-a', 'customer', 'customer-a')
  assert.equal(attachmentMap.cf_files?.[0]?.name, '资料.pdf')
  assert.equal(attachmentMap.cf_pictures?.[0]?.name, '现场.png')
})

test('资源字段文件拒绝他人临时文件、其他资源文件和跨字段重复绑定', async () => {
  const { service, tx } = createLifecycleHarness()
  await assert.rejects(
    () =>
      service.save(
        'tenant-a',
        'customer',
        'customer-a',
        { cf_files: ['foreign-temp'] },
        'update',
        tx,
        'user-a',
      ),
    BadRequestException,
  )
  await assert.rejects(
    () =>
      service.save(
        'tenant-a',
        'customer',
        'customer-a',
        { cf_files: ['bound-other'] },
        'update',
        tx,
        'user-a',
      ),
    BadRequestException,
  )
  await assert.rejects(
    () =>
      service.save(
        'tenant-a',
        'customer',
        'customer-a',
        { cf_files: ['file-a'], cf_pictures: ['file-a'] },
        'update',
        tx,
        'user-a',
      ),
    /不能同时绑定/,
  )
})

test('局部更新不能占用当前资源另一个未修改文件字段的附件', async () => {
  const { service, tx, attachments } = createLifecycleHarness([
    { resourceId: 'customer-a', fieldId: 'file-field', fieldValue: '["file-a"]' },
  ])
  const file = attachments.find((row) => row.id === 'file-a')
  assert.ok(file)
  file.targetType = 'resourceField:customer'
  file.targetId = 'customer-a'
  await assert.rejects(
    () =>
      service.save(
        'tenant-a',
        'customer',
        'customer-a',
        { cf_pictures: ['file-a'] },
        'update',
        tx,
        'user-a',
      ),
    /其他字段/,
  )
})

test('资源字段附件清理器保留有效引用，删除孤儿和超过 24 小时的临时文件', async () => {
  const removed: string[] = []
  const rows = [
    {
      id: 'kept',
      tenantId: 'tenant-a',
      targetType: 'resourceField:customer',
      targetId: 'customer-a',
    },
    {
      id: 'orphan',
      tenantId: 'tenant-a',
      targetType: 'resourceField:customer',
      targetId: 'customer-a',
    },
    { id: 'temporary', tenantId: 'tenant-a', targetType: null, targetId: null },
  ]
  let queried = false
  const prisma = {
    attachment: {
      findMany: async () => {
        if (queried) return []
        queried = true
        return rows
      },
    },
  } as unknown as PrismaService
  const fields = {
    isAttachmentReferenced: async (
      _tenantId: string,
      _resourceType: string,
      _resourceId: string,
      attachmentId: string,
    ) => attachmentId === 'kept',
  } as unknown as ResourceFieldValueService
  const attachments = {
    removeTemporary: async (_tenantId: string, id: string) => {
      removed.push(id)
      return true
    },
    removeFromTarget: async (_tenantId: string, id: string) => {
      removed.push(id)
      return true
    },
  } as unknown as AttachmentsService
  const coordinator = {} as DistributedCoordinatorService
  const service = new ResourceFieldAttachmentCleanupService(
    prisma,
    fields,
    attachments,
    coordinator,
  )
  const result = await service.cleanup(new Date('2026-09-06T00:00:00Z'))
  assert.deepEqual(result, { scanned: 3, deleted: 2 })
  assert.deepEqual(removed.sort(), ['orphan', 'temporary'])
})

test('资源字段附件清理 Cron 必须通过 DistributedCoordinator 执行且只调用 cleanup 核心', async () => {
  const calls: string[] = []
  const coordinator = {
    runScheduledOnce: async (key: string, slot: string, task: () => Promise<unknown>) => {
      calls.push(`coordinate:${key}:${slot}`)
      await task()
      return { executed: true }
    },
  } as unknown as DistributedCoordinatorService
  const service = new ResourceFieldAttachmentCleanupService(
    {} as PrismaService,
    {} as ResourceFieldValueService,
    {} as AttachmentsService,
    coordinator,
  )
  service.cleanup = async () => {
    calls.push('cleanup')
    return { scanned: 0, deleted: 0 }
  }

  await service.scheduledCleanup()

  assert.deepEqual(calls, ['coordinate:resource-field-attachment-cleanup:MINUTE', 'cleanup'])
})
