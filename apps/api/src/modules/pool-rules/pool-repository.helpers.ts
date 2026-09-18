import type { Prisma8Client } from '../../prisma/prisma8-client.js'

type Prisma8Transaction = Parameters<Parameters<Prisma8Client['transaction']>[0]>[0]

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

export async function loadUserScopeTokensPrisma8(
  tx: Prisma8Transaction,
  organizationId: string,
  userId: string,
): Promise<Set<string>> {
  const user = await tx.orm.public.Users.where({
    id: userId,
    tenantId: organizationId,
    status: 'ACTIVE',
  })
    .select('id', 'deptId')
    .first()
  if (!user) return new Set()

  const id = String(user.id)
  const tokens = new Set([id, `user:${id}`])
  const userRoles = await tx.orm.public.UserRoles.where({ userId: id }).select('roleId').all()
  for (const { roleId } of userRoles) {
    const role = String(roleId)
    tokens.add(role)
    tokens.add(`role:${role}`)
  }
  if (!user.deptId) return tokens
  const departments = await tx.orm.public.Departments.where({ tenantId: organizationId })
    .select('id', 'parentId')
    .all()
  const parentMap = new Map(
    departments.map((department) => [
      String(department.id),
      department.parentId ? String(department.parentId) : null,
    ]),
  )
  let departmentId: string | null = String(user.deptId)
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

export async function resolveScopeUserIdsPrisma8(
  tx: Prisma8Transaction,
  organizationId: string,
  scopeIds: string[],
): Promise<Set<string>> {
  const users = await tx.orm.public.Users.where({ tenantId: organizationId, status: 'ACTIVE' })
    .select('id', 'deptId')
    .all()
  if (scopeIds.includes('*')) return new Set(users.map((user) => String(user.id)))

  const departments = await tx.orm.public.Departments.where({ tenantId: organizationId })
    .select('id', 'parentId')
    .all()
  const departmentIds = new Set(departments.map((department) => String(department.id)))
  const children = new Map<string, string[]>()
  for (const department of departments) {
    if (!department.parentId) continue
    const parentId = String(department.parentId)
    children.set(parentId, [...(children.get(parentId) ?? []), String(department.id)])
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
  const roles = await tx.orm.public.Roles.where({ tenantId: organizationId }).select('id').all()
  const roleIds = new Set(roles.map((role) => String(role.id)))
  const selectedRoles = new Set(
    scopeIds
      .map((scopeId) => (scopeId.startsWith('role:') ? scopeId.slice(5) : scopeId))
      .filter((scopeId) => roleIds.has(scopeId)),
  )
  const userIds = users.map((user) => String(user.id))
  const relations = userIds.length
    ? await tx.orm.public.UserRoles.where((row) => row.userId.in(userIds))
        .select('userId', 'roleId')
        .all()
    : []
  const rolesByUser = new Map<string, Set<string>>()
  for (const relation of relations) {
    const userId = String(relation.userId)
    const set = rolesByUser.get(userId) ?? new Set<string>()
    set.add(String(relation.roleId))
    rolesByUser.set(userId, set)
  }
  return new Set(
    users
      .filter((user) => {
        const userId = String(user.id)
        return (
          explicitUsers.has(userId) ||
          (!!user.deptId && selectedDepartments.has(String(user.deptId))) ||
          [...(rolesByUser.get(userId) ?? [])].some((roleId) => selectedRoles.has(roleId))
        )
      })
      .map((user) => String(user.id)),
  )
}
