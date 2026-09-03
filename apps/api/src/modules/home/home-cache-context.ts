import type { AuthUser } from '../../common/auth-user'

export function homeCacheUserContext(user: AuthUser) {
  return {
    id: user.id,
    deptId: user.deptId,
    permissions: [...user.permissions].sort(),
    roles: [...user.roles]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((role) => ({
        id: role.id,
        dataScope: role.dataScope,
        scopeDeptIds: [...role.scopeDeptIds].sort(),
        permissions: [...role.permissions].sort(),
      })),
  }
}
