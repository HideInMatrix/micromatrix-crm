/** JWT 载荷（仅存最小信息，用户详情由认证守卫按需加载） */
export interface JwtPayload {
  sub: string
  tenantId: string
  email: string
}
