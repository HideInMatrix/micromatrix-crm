import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException } from '@nestjs/common'
import type { ModuleFormProp } from '@micromatrix/shared'
import { ModuleFormsService } from './module-forms.service'

function validator(usedStages: string[]) {
  const service = Object.create(ModuleFormsService.prototype) as unknown as {
    prisma: {
      client: {
        orm: {
          public: {
            Clue: {
              where: (filter: { organizationId: string }) => {
                select: (field: 'stage') => {
                  all: () => Promise<Array<{ stage: string }>>
                }
              }
            }
          }
        }
      }
    }
    validateLeadStageUsage: (
      organizationId: string,
      formKey: string,
      formProp: ModuleFormProp,
    ) => Promise<void>
  }
  service.prisma = {
    client: {
      orm: {
        public: {
          Clue: {
            where: (filter) => {
              assert.equal(filter.organizationId, 'tenant-1')
              return {
                select: (field) => {
                  assert.equal(field, 'stage')
                  return { all: async () => usedStages.map((stage) => ({ stage })) }
                },
              }
            },
          },
        },
      },
    },
  }
  return service
}

const stage = (key: string, enabled = true) => ({
  key,
  name: key,
  kind: 'ACTIVE' as const,
  enabled,
})

test('删除仍被线索使用的状态时拒绝保存并指出状态标识', async () => {
  const service = validator(['NEW', 'NEW', 'ACTIVE'])
  await assert.rejects(
    service.validateLeadStageUsage('tenant-1', 'lead', {
      leadStages: [stage('ACTIVE')],
    }),
    (error: unknown) =>
      error instanceof BadRequestException &&
      error.message.includes('NEW') &&
      error.message.includes('先将相关线索迁移到其他状态'),
  )
})

test('停用仍被线索使用的状态是允许的，因为状态标识仍然保留', async () => {
  const service = validator(['NEW', 'ACTIVE'])
  await assert.doesNotReject(
    service.validateLeadStageUsage('tenant-1', 'lead', {
      leadStages: [stage('NEW', false), stage('ACTIVE')],
    }),
  )
})

test('删除没有任何线索使用的状态允许保存', async () => {
  const service = validator(['NEW', 'ACTIVE'])
  await assert.doesNotReject(
    service.validateLeadStageUsage('tenant-1', 'lead', {
      leadStages: [stage('NEW'), stage('ACTIVE')],
    }),
  )
})

test('非线索模块不执行线索状态使用校验', async () => {
  const service = validator([])
  await assert.doesNotReject(
    service.validateLeadStageUsage('tenant-1', 'customer', {
      leadStages: [stage('NEW')],
    }),
  )
})
