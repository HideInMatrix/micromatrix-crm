import { randomUUID } from 'node:crypto'
import { createPrisma8Client, type Prisma8Client } from '../prisma/prisma8-client'
import { prisma8Now } from '../prisma/prisma8-temporal'

export interface PrismaTestDatabase {
  client: Prisma8Client
  close(): Promise<void>
}

export async function openPrismaTestDatabase(databaseUrl: string): Promise<PrismaTestDatabase> {
  const client = await createPrisma8Client(databaseUrl)
  await client.connect()
  return {
    client,
    close: () => client.close(),
  }
}

export function prismaTestToken(): string {
  return randomUUID().replaceAll('-', '')
}

export async function createPrismaTestTenant(
  client: Prisma8Client,
  prefix: string,
): Promise<{ id: string; name: string; slug: string }> {
  const token = prismaTestToken()
  return client.orm.public.Tenants
    .select('id', 'name', 'slug')
    .create({
      name: `${prefix} ${token.slice(0, 8)}`,
      slug: `${prefix.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${token}`,
      updatedAt: prisma8Now(),
    })
}

export async function createPrismaTestUser(
  client: Prisma8Client,
  input: {
    tenantId: string
    name?: string
    email?: string | null
    passwordHash?: string
    deptId?: string | null
    status?: 'ACTIVE' | 'DISABLED'
  },
): Promise<{ id: string; tenantId: string; name: string; email: string | null }> {
  const token = prismaTestToken()
  return client.orm.public.Users
    .select('id', 'tenantId', 'name', 'email')
    .create({
      tenantId: input.tenantId,
      name: input.name ?? `Prisma test user ${token.slice(0, 8)}`,
      email: input.email === undefined ? `p8-test-${token}@example.com` : input.email,
      passwordHash: input.passwordHash ?? 'not-used',
      deptId: input.deptId ?? null,
      status: input.status ?? 'ACTIVE',
      updatedAt: prisma8Now(),
    })
}

export async function createPrismaTestDepartment(
  client: Prisma8Client,
  input: {
    tenantId: string
    name: string
    parentId?: string | null
    sort?: number
  },
): Promise<{ id: string; tenantId: string; name: string; parentId: string | null }> {
  return client.orm.public.Departments
    .select('id', 'tenantId', 'name', 'parentId')
    .create({
      tenantId: input.tenantId,
      name: input.name,
      parentId: input.parentId ?? null,
      sort: input.sort ?? 0,
      updatedAt: prisma8Now(),
    })
}
