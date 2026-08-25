import type { Prisma } from '../../generated/prisma/client'

export function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

export function startOfLocalDay(now: bigint): bigint {
  const date = new Date(Number(now))
  date.setHours(0, 0, 0, 0)
  return BigInt(date.getTime())
}

export async function loadUserScopeTokens(
  tx: Prisma.TransactionClient,
  organizationId: string,
  userId: string,
): Promise<Set<string>> {
  const user = await tx.user.findFirst({
    where: { id: userId, tenantId: organizationId, status: 'ACTIVE' },
    select: { id: true, deptId: true },
  })
  if (!user) return new Set()

  const tokens = new Set([user.id, `user:${user.id}`])
  if (!user.deptId) return tokens
  const departments = await tx.department.findMany({
    where: { tenantId: organizationId },
    select: { id: true, parentId: true },
  })
  const parentMap = new Map(departments.map((department) => [department.id, department.parentId]))
  let departmentId: string | null = user.deptId
  while (departmentId) {
    tokens.add(departmentId)
    tokens.add(`dept:${departmentId}`)
    departmentId = parentMap.get(departmentId) ?? null
  }
  return tokens
}

export function scopeMatches(scopeId: string, userTokens: Set<string>): boolean {
  const scope = parseStringArray(scopeId)
  return scope.includes('*') || scope.some((token) => userTokens.has(token))
}

export async function resolveScopeUserIds(
  tx: Prisma.TransactionClient,
  organizationId: string,
  scopeIds: string[],
): Promise<Set<string>> {
  const users = await tx.user.findMany({
    where: { tenantId: organizationId, status: 'ACTIVE' },
    select: { id: true, deptId: true },
  })
  if (scopeIds.includes('*')) return new Set(users.map((user) => user.id))
  const departments = await tx.department.findMany({
    where: { tenantId: organizationId },
    select: { id: true, parentId: true },
  })
  const departmentIds = new Set(departments.map((department) => department.id))
  const children = new Map<string, string[]>()
  for (const department of departments) {
    if (!department.parentId) continue
    children.set(department.parentId, [...(children.get(department.parentId) ?? []), department.id])
  }
  const selectedDepartments = new Set(
    scopeIds
      .map((scopeId) => (scopeId.startsWith('dept:') ? scopeId.slice(5) : scopeId))
      .filter((scopeId) => departmentIds.has(scopeId)),
  )
  const queue = [...selectedDepartments]
  while (queue.length) {
    const current = queue.shift()!
    for (const child of children.get(current) ?? []) {
      if (selectedDepartments.has(child)) continue
      selectedDepartments.add(child)
      queue.push(child)
    }
  }
  const explicitUsers = new Set(
    scopeIds.map((scopeId) => (scopeId.startsWith('user:') ? scopeId.slice(5) : scopeId)),
  )
  return new Set(
    users
      .filter(
        (user) =>
          explicitUsers.has(user.id) || (!!user.deptId && selectedDepartments.has(user.deptId)),
      )
      .map((user) => user.id),
  )
}
