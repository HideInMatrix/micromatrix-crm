import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envFile = readFileSync('.env', 'utf8')
  const line = envFile.split(/\r?\n/).find((item) => item.trim().startsWith('DATABASE_URL='))
  if (!line) throw new Error('W3.7 DB-011 migration smoke requires DATABASE_URL')
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

function client(connectionString: string) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}

function splitMigration(sql: string) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean)
}

async function main() {
  const source = new URL(resolveDatabaseUrl())
  const database = `w370_db011_m60_${randomUUID().replaceAll('-', '').slice(0, 10)}`
  const target = new URL(source)
  target.pathname = `/${database}`
  const managementUrl = new URL(source)
  managementUrl.pathname = '/postgres'

  let management: PrismaClient | undefined
  let prisma: PrismaClient | undefined

  try {
  console.log(`W3.7 DB-011 migration 60 smoke: ${database}`)
  management = client(managementUrl.toString())
  await management.$executeRawUnsafe(`CREATE DATABASE "${database}"`)

  prisma = client(target.toString())
  await prisma.$executeRawUnsafe(`CREATE TYPE "ApprovalTaskStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SKIPPED')`)
  await prisma.$executeRawUnsafe(`CREATE TYPE "ApprovalTaskType" AS ENUM ('APPROVAL', 'CC')`)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "approval_instances" (
      "id" TEXT NOT NULL,
      CONSTRAINT "approval_instances_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "approval_tasks" (
      "id" TEXT NOT NULL,
      "tenantId" TEXT NOT NULL,
      "instanceId" TEXT NOT NULL,
      "nodeIndex" INTEGER NOT NULL,
      "nodeName" TEXT NOT NULL,
      "approverId" TEXT NOT NULL,
      "task_type" "ApprovalTaskType" NOT NULL DEFAULT 'APPROVAL',
      "status" "ApprovalTaskStatus" NOT NULL DEFAULT 'PENDING',
      "comment" TEXT,
      "handledAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "approval_tasks_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "approval_tasks_instanceId_fkey"
        FOREIGN KEY ("instanceId") REFERENCES "approval_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `)

  await prisma.$executeRawUnsafe(`INSERT INTO "approval_instances" ("id") VALUES ('instance-legacy')`)
  await prisma.$executeRawUnsafe(`
    INSERT INTO "approval_tasks"
      ("id", "tenantId", "instanceId", "nodeIndex", "nodeName", "approverId", "status", "comment", "handledAt")
    VALUES
      ('task-approved', 'tenant-a', 'instance-legacy', 0, '主管审批', 'approver-a', 'APPROVED', '历史同意意见', CURRENT_TIMESTAMP),
      ('task-rejected', 'tenant-a', 'instance-legacy', 1, '财务审批', 'approver-b', 'REJECTED', '历史驳回意见', CURRENT_TIMESTAMP),
      ('task-pending', 'tenant-a', 'instance-legacy', 2, '总经理审批', 'approver-c', 'PENDING', NULL, NULL)
  `)

  const migration = readFileSync(
    'prisma/migrations/20260830210000_w370_approval_task_records/migration.sql',
    'utf8',
  )
  for (const statement of splitMigration(migration)) {
    await prisma.$executeRawUnsafe(statement)
  }

  const columns = await prisma.$queryRawUnsafe<Array<{ column_name: string; column_default: string | null }>>(`
    SELECT column_name, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'approval_tasks'
  `)
  const columnMap = new Map(columns.map((column) => [column.column_name, column.column_default]))
  if (columnMap.has('comment')) throw new Error('legacy approval_tasks.comment still exists')
  for (const required of ['node_id', 'node_round', 'action', 'updatedAt']) {
    if (!columnMap.has(required)) throw new Error(`approval_tasks.${required} missing after migration 60`)
  }
  if (columnMap.get('updatedAt') !== null) throw new Error('approval_tasks.updatedAt keeps an unexpected DB default')

  const recordColumns = await prisma.$queryRawUnsafe<Array<{ column_name: string; column_default: string | null }>>(`
    SELECT column_name, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'approval_records'
  `)
  const recordColumnMap = new Map(recordColumns.map((column) => [column.column_name, column.column_default]))
  if (recordColumnMap.get('updated_at') !== null) {
    throw new Error('approval_records.updated_at keeps an unexpected DB default')
  }

  const enumRows = await prisma.$queryRawUnsafe<Array<{ enumlabel: string }>>(`
    SELECT enumlabel
    FROM pg_enum
    WHERE enumtypid = '"ApprovalTaskType"'::regtype
    ORDER BY enumsortorder
  `)
  const taskTypes = enumRows.map((row) => row.enumlabel)
  if (!taskTypes.includes('SIGN') || !taskTypes.includes('BACK')) {
    throw new Error(`advanced task types missing: ${taskTypes.join(',')}`)
  }

  const tasks = await prisma.approvalTask.findMany({ orderBy: { nodeIndex: 'asc' } })
  const approved = tasks.find((task) => task.id === 'task-approved')
  const rejected = tasks.find((task) => task.id === 'task-rejected')
  const pending = tasks.find((task) => task.id === 'task-pending')
  if (approved?.action !== 'APPROVE' || approved.nodeRound !== 1 || approved.nodeId !== null) {
    throw new Error('approved historical task backfill mismatch')
  }
  if (rejected?.action !== 'REJECT' || rejected.nodeRound !== 1 || rejected.nodeId !== null) {
    throw new Error('rejected historical task backfill mismatch')
  }
  if (pending?.action !== null || pending.nodeRound !== 1 || pending.nodeId !== null) {
    throw new Error('pending historical task should remain action-less round 1')
  }

  const records = await prisma.approvalRecord.findMany({ orderBy: { taskId: 'asc' } })
  if (records.length !== 2) throw new Error(`expected 2 migrated records, got ${records.length}`)
  const approvedRecord = records.find((record) => record.taskId === 'task-approved')
  const rejectedRecord = records.find((record) => record.taskId === 'task-rejected')
  if (approvedRecord?.result !== 'APPROVE' || approvedRecord.comment !== '历史同意意见') {
    throw new Error('approved historical comment/result was not preserved')
  }
  if (rejectedRecord?.result !== 'REJECT' || rejectedRecord.comment !== '历史驳回意见') {
    throw new Error('rejected historical comment/result was not preserved')
  }

  const runtimeRecord = await prisma.approvalRecord.create({
    data: {
      tenantId: 'tenant-a',
      instanceId: 'instance-legacy',
      taskId: 'task-pending',
      nodeId: null,
      nodeRound: 1,
      result: 'APPROVE',
      comment: 'migration 60 runtime create',
      createdById: 'approver-c',
    },
  })
  if (!runtimeRecord.updatedAt) throw new Error('Prisma @updatedAt did not populate approval record')

  console.log(JSON.stringify({
    database,
    migration: 60,
    legacyTaskCommentRemoved: true,
    historicalRecordsMigrated: records.length,
    historicalActionsBackfilled: true,
    historicalNodeIdKeptNullable: true,
    taskTypes,
    prismaRuntimeRecordCreate: true,
  }, null, 2))
  } finally {
    if (prisma) await prisma.$disconnect().catch(() => undefined)
    if (!management) management = client(managementUrl.toString())
    await management.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${database}' AND pid <> pg_backend_pid()`,
    ).catch(() => undefined)
    await management.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}"`).catch(() => undefined)
    await management.$disconnect().catch(() => undefined)
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
