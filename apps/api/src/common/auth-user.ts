import type { DataScope } from '../generated/prisma/client'

/** 认证守卫附加到请求上的当前用户（含角色权限与数据范围） */
export interface AuthUser {
  id: string
  tenantId: string
  email: string
  name: string
  deptId: string | null
  leaderId: string | null
  roleId: string | null
  permissions: string[]
  dataScope: DataScope
  scopeDeptIds: string[]
}

declare module 'express' {
  interface Request {
    user?: AuthUser
  }
}
