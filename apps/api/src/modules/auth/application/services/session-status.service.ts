import { Inject, Injectable } from '@nestjs/common'
import {
  AUTH_SESSIONS_REPOSITORY,
  type AuthSessionsRepository,
} from '@/modules/auth/application/ports/auth-sessions.repository.port.js'
import {
  SESSION_STATUS_CACHE,
  type SessionStatus,
  type SessionStatusCachePort,
} from '@/modules/auth/application/ports/session-status-cache.port.js'

/** Отозвана ли сессия access-токена: один GET в Redis, БД читается только при промахе кэша. */
@Injectable()
export class SessionStatusService {
  constructor(
    @Inject(SESSION_STATUS_CACHE) private readonly cache: SessionStatusCachePort,
    @Inject(AUTH_SESSIONS_REPOSITORY) private readonly sessions: AuthSessionsRepository,
  ) {}

  async isRevoked(sessionId: string): Promise<boolean> {
    const cached = await this.readCache(sessionId)
    if (cached !== null) {
      return cached === 'revoked'
    }
    const session = await this.sessions.findById(sessionId)
    // Неизвестная сессия не считается отозванной: подлинность токена держит подпись, отзыв — только явный.
    const revoked = session?.revokedAt != null
    await this.writeCache(sessionId, revoked)
    return revoked
  }

  private async readCache(sessionId: string): Promise<SessionStatus | null> {
    try {
      return await this.cache.get(sessionId)
    } catch {
      // Redis недоступен — проверяем по БД, а не пропускаем токен вслепую.
      return null
    }
  }

  private async writeCache(sessionId: string, revoked: boolean): Promise<void> {
    try {
      await (revoked ? this.cache.markRevoked([sessionId]) : this.cache.rememberActive(sessionId))
    } catch {
      // Кэш — оптимизация; сбой записи не должен ронять запрос.
    }
  }
}
