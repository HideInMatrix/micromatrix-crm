import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { BadGatewayException } from '@nestjs/common'
import type { ApprovalWebhookConfig } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import type { ApprovalResourceService } from './approval-resource.service'
import {
  ApprovalWebhookClient,
  ApprovalWebhookClientError,
} from './approval-webhook.client'
import { ApprovalWebhookService } from './approval-webhook.service'

const databaseUrl = process.env['DATABASE_URL']

function config(): ApprovalWebhookConfig {
  return {
    webHookEnable: true,
    webHookUrl: 'https://hooks.example.com/private/path?token=secret',
    webHookMethod: 'POST',
    webHookHeader: '{"Content-Type":"application/json"}',
    webHookBody: '{"ok":true}',
    webHookDescribe: 'Prisma 8 delivery gate',
  }
}

test(
  'ApprovalWebhook delivery 使用 Prisma 8 保持 SENT/FAILED 审计状态与 Temporal 时间字段',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const suffix = randomUUID().replaceAll('-', '')
    const tenantId = `p8-webhook-${suffix}`
    const user: AuthUser = {
      id: `u${suffix}`,
      tenantId,
      email: null,
      name: 'Webhook Tester',
      deptId: null,
      leaderId: null,
      roles: [],
      permissions: ['*'],
    }

    await fixtureDb.$connect()
    await prisma8Client.connect()
    try {
      const resources = {} as ApprovalResourceService
      const successClient = {
        send: async () => ({ httpStatus: 204, responseBytes: 12, durationMs: 34 }),
      } as unknown as ApprovalWebhookClient
      const successService = new ApprovalWebhookService(
        { client: prisma8Client } as Prisma8Service,
        resources,
        successClient,
      )

      assert.deepEqual(await successService.testConnection(user, config()), {
        ok: true,
        httpStatus: 204,
        responseBytes: 12,
        durationMs: 34,
      })

      const sent = await fixtureDb.approvalWebhookDelivery.findFirstOrThrow({
        where: { tenantId, status: 'SENT' },
        orderBy: { createdAt: 'asc' },
      })
      assert.equal(sent.source, 'TEST')
      assert.equal(sent.method, 'POST')
      assert.equal(sent.targetOrigin, 'https://hooks.example.com')
      assert.equal(sent.targetPath, '[redacted-path]')
      assert.equal(sent.httpStatus, 204)
      assert.equal(sent.responseBytes, 12)
      assert.equal(sent.durationMs, 34)
      assert.ok(sent.startedAt)
      assert.ok(sent.finishedAt)
      assert.ok(sent.updatedAt.getTime() >= sent.createdAt.getTime())

      const failedClient = {
        send: async () => {
          throw new ApprovalWebhookClientError('NETWORK', '模拟网络失败', {
            responseBytes: 7,
            durationMs: 9,
          })
        },
      } as unknown as ApprovalWebhookClient
      const failedService = new ApprovalWebhookService(
        { client: prisma8Client } as Prisma8Service,
        resources,
        failedClient,
      )

      await assert.rejects(() => failedService.testConnection(user, config()), BadGatewayException)
      const failed = await fixtureDb.approvalWebhookDelivery.findFirstOrThrow({
        where: { tenantId, status: 'FAILED' },
        orderBy: { createdAt: 'desc' },
      })
      assert.equal(failed.errorCode, 'NETWORK')
      assert.equal(failed.errorMessage, '模拟网络失败')
      assert.equal(failed.responseBytes, 7)
      assert.equal(failed.durationMs, 9)
      assert.ok(failed.startedAt)
      assert.ok(failed.finishedAt)
    } finally {
      await fixtureDb.approvalWebhookDelivery.deleteMany({ where: { tenantId } })
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
