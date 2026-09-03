import { Injectable } from '@nestjs/common'
import { RedisService } from '../../redis/redis.service'
import type { AuthUser } from '../auth-user'

interface CachedAuthContext {
  authVersion: number
  user: AuthUser
}

const AUTH_CONTEXT_TTL_SECONDS = 60

@Injectable()
export class AuthContextCacheService {
  constructor(private readonly redis: RedisService) {}

  get(userId: string): Promise<CachedAuthContext | null> {
    return this.redis.getJson<CachedAuthContext>(this.key(userId))
  }

  set(userId: string, authVersion: number, user: AuthUser): Promise<boolean> {
    return this.redis.setJson(
      this.key(userId),
      { authVersion, user } satisfies CachedAuthContext,
      AUTH_CONTEXT_TTL_SECONDS,
    )
  }

  invalidate(userId: string): Promise<boolean> {
    return this.redis.delete(this.key(userId))
  }

  async invalidateMany(userIds: string[]): Promise<void> {
    const ids = [...new Set(userIds.filter(Boolean))]
    if (ids.length === 0) return
    await this.redis.delete(...ids.map((id) => this.key(id)))
  }

  private key(userId: string): string {
    return `auth:context:${userId}`
  }
}
