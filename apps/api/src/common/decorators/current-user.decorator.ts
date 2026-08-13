import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { AuthUser } from '../auth-user'

/** 取出认证守卫挂载的当前用户（含权限与数据范围） */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user
})
