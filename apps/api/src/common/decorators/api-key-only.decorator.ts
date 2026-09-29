import { SetMetadata } from '@nestjs/common'

export const API_KEY_ONLY_KEY = 'apiKeyOnly'

/** 仅允许通过 X-Access-Key / X-Secret-Key 调用，拒绝普通 JWT 登录态。 */
export const ApiKeyOnly = () => SetMetadata(API_KEY_ONLY_KEY, true)
