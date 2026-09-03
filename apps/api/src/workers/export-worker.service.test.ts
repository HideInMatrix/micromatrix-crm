import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException } from '@nestjs/common'
import { Job, UnrecoverableError } from 'bullmq'
import { ExportWorkerService } from './export-worker.service'

function handler(name: string, calls: string[]) {
  return {
    buildQueuedExport: async () => {
      calls.push(name)
      return { data: Buffer.from(name), rowCount: 1 }
    },
  }
}

function serviceFixture() {
  const calls: string[] = []
  const failures: string[] = []
  const completed: string[] = []
  const task = {
    id: 'task-a',
    tenantId: 'tenant-a',
    userId: 'user-a',
    module: 'customer',
    payload: { version: 1, query: {}, input: { headList: ['name'] } },
  }
  const tasks = {
    beginAttempt: async () => task,
    recoverPending: async () => ({ recovered: 0, kept: 0, failedLegacy: 0 }),
    fail: async (_id: string, message: string) => failures.push(message),
    complete: async (id: string) => {
      completed.push(id)
      return true
    },
  }
  const prisma = {
    user: {
      findUnique: async () => ({
        id: 'user-a',
        tenantId: 'tenant-a',
        name: 'User',
        email: 'u@example.com',
        phone: null,
        status: 'ACTIVE',
        deptId: null,
        leaderId: null,
        authVersion: 0,
        userRoles: [],
      }),
    },
  }
  const jobs = { startExportWorker: () => ({}) }
  const instance = new ExportWorkerService(
    jobs as never,
    prisma as never,
    tasks as never,
    handler('customer', calls) as never,
    handler('contact', calls) as never,
    handler('lead', calls) as never,
    handler('opportunity', calls) as never,
    handler('product', calls) as never,
    handler('price', calls) as never,
    handler('businessTitle', calls) as never,
    handler('contractInvoice', calls) as never,
    handler('contractPaymentPlan', calls) as never,
    handler('contractPaymentRecord', calls) as never,
    handler('order', calls) as never,
  )
  return { instance, calls, failures, completed, task, tasks }
}

const payload = { version: 1, query: {}, input: {} } as const
const user = { id: 'user-a', tenantId: 'tenant-a' } as never

test('13 个导出 module key 全部路由到对应业务 handler', async () => {
  const { instance, calls } = serviceFixture()
  const routes = [
    ['customer', 'customer'],
    ['customer_pool', 'customer'],
    ['contact', 'contact'],
    ['lead', 'lead'],
    ['lead_pool', 'lead'],
    ['opportunity', 'opportunity'],
    ['product', 'product'],
    ['price', 'price'],
    ['businessTitle', 'businessTitle'],
    ['contractInvoice', 'contractInvoice'],
    ['contractPaymentPlan', 'contractPaymentPlan'],
    ['contractPaymentRecord', 'contractPaymentRecord'],
    ['order', 'order'],
  ] as const
  for (const [module] of routes) await instance.route(module, user, payload)
  assert.deepEqual(
    calls,
    routes.map(([, handlerName]) => handlerName),
  )
})

test('确定性业务错误立即写 FAILED 并转为 UnrecoverableError', async () => {
  const { instance, failures } = serviceFixture()
  instance.route = async () => {
    throw new BadRequestException('导出字段已失效')
  }
  const job = { data: { taskId: 'task-a' }, opts: { attempts: 3 }, attemptsMade: 0 } as Job<any>
  await assert.rejects(() => instance.process(job), (error: unknown) => error instanceof UnrecoverableError)
  assert.deepEqual(failures, ['导出字段已失效'])
})

test('瞬时错误在最后一次 attempt 前不写 FAILED，最后一次才收敛', async () => {
  const first = serviceFixture()
  first.instance.route = async () => {
    throw new Error('temporary db error')
  }
  await assert.rejects(() =>
    first.instance.process({ data: { taskId: 'task-a' }, opts: { attempts: 3 }, attemptsMade: 0 } as Job<any>),
  )
  assert.equal(first.failures.length, 0)

  const last = serviceFixture()
  last.instance.route = async () => {
    throw new Error('temporary db error')
  }
  await assert.rejects(() =>
    last.instance.process({ data: { taskId: 'task-a' }, opts: { attempts: 3 }, attemptsMade: 2 } as Job<any>),
  )
  assert.deepEqual(last.failures, ['temporary db error'])
})

test('成功构建后统一交给 ExportTasksService 以 PENDING CAS 完成', async () => {
  const { instance, completed } = serviceFixture()
  await instance.process({ data: { taskId: 'task-a' }, opts: { attempts: 3 }, attemptsMade: 0 } as Job<any>)
  assert.deepEqual(completed, ['task-a'])
})
