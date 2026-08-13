import { SetMetadata } from '@nestjs/common'

export const PERMISSIONS_KEY = 'requiredPermissions'

/** 声明接口所需的权限码（全部满足才放行，'*' 角色不受限） */
export const RequirePermissions = (...codes: string[]) => SetMetadata(PERMISSIONS_KEY, codes)
