import { Inject, Injectable } from '@nestjs/common'
import type Redis from 'ioredis'
import type { Logger } from 'pino'
import { REDIS_CLIENT } from '@/infrastructure/redis/redis.token.js'
import { PINO_LOGGER } from '@/common/logging/pino-logger.token.js'
import { ACCESS_TOKEN_TTL_SECONDS } from '@/modules/auth/application/ports/jwt-signer.port.js'
import type {
  SessionStatus,
  SessionStatusCachePort,
} from '@/modules/auth/application/ports/session-status-cache.port.js'

const KEY_PREFIX = 'auth:session-status:'

// TTL = срок жизни access-токена: после него отозванный токен всё равно не пройдёт verify.
@Injectable()
export class RedisSessionStatusCacheAdapter implements SessionStatusCachePort {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(PINO_LOGGER) private readonly logger: Logger,
  ) {}

  async get(sessionId: string): Promise<SessionStatus | null> {
    const value = await this.redis.get(KEY_PREFIX + sessionId)
    return value === 'active' || value === 'revoked' ? value : null
  }

  async rememberActive(sessionId: string): Promise<void> {
    await this.redis.set(KEY_PREFIX + sessionId, 'active', 'EX', ACCESS_TOKEN_TTL_SECONDS, 'NX')
  }

  async markRevoked(sessionIds: readonly string[]): Promise<void> {
    if (sessionIds.length === 0) {
      return
    }
    try {
      const pipeline = this.redis.pipeline()
      for (const id of sessionIds) {
        pipeline.set(KEY_PREFIX + id, 'revoked', 'EX', ACCESS_TOKEN_TTL_SECONDS)
      }
      await pipeline.exec()
    } catch (error: unknown) {
      // Отзыв в БД уже выполнен; кэш с 'active' протухнет сам через TTL.
      this.logger.error({ err: error, sessionIds }, 'session-status cache invalidation failed')
    }
  }
}
