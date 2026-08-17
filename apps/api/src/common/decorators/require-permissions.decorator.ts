import { SetMetadata } from '@nestjs/common'

export const PERMISSIONS_KEY = 'requiredPermissions'
export const ANY_PERMISSIONS_KEY = 'requiredAnyPermissions'

/** 声明接口所需的权限码（全部满足才放行，'*' 角色不受限） */
export const RequirePermissions = (...codes: string[]) => SetMetadata(PERMISSIONS_KEY, codes)

/** 声明接口所需的权限码（满足任意一个即可，'*' 角色不受限） */
export const RequireAnyPermissions = (...codes: string[]) => SetMetadata(ANY_PERMISSIONS_KEY, codes)
