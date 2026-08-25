import type { DataScope } from '../generated/prisma/client'

export interface AuthRole {
  id: string
  name: string
  permissions: string[]
  dataScope: DataScope
  scopeDeptIds: string[]
}

/** 认证守卫附加到请求上的当前用户（含角色权限与数据范围） */
export interface AuthUser {
  id: string
  tenantId: string
  email: string | null
  name: string
  deptId: string | null
  leaderId: string | null
  roles: AuthRole[]
  permissions: string[]
}

interface UserWithRoleLinks {
  id: string
  tenantId: string
  email: string | null
  name: string
  deptId: string | null
  leaderId: string | null
  userRoles: Array<{ role: AuthRole }>
}

/** 将 Prisma 用户与角色关联统一转换成请求认证上下文。 */
export function toAuthUser(user: UserWithRoleLinks): AuthUser {
  const roles = user.userRoles.map(({ role }) => ({
    id: role.id,
    name: role.name,
    permissions: role.permissions,
    dataScope: role.dataScope,
    scopeDeptIds: role.scopeDeptIds,
  }))
  return {
    id: user.id,
    tenantId: user.tenantId,
    email: user.email,
    name: user.name,
    deptId: user.deptId,
    leaderId: user.leaderId,
    roles,
    permissions: [...new Set(roles.flatMap((role) => role.permissions))],
  }
}

declare module 'express' {
  interface Request {
    user?: AuthUser
  }
}
