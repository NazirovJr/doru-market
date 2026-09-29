export const SESSION_STATUS_CACHE = Symbol.for('@dorutj/auth/session-status-cache')

export type SessionStatus = 'active' | 'revoked'

export interface SessionStatusCachePort {
  get(sessionId: string): Promise<SessionStatus | null>
  /** Не перезаписывает уже записанный статус: гонка чтения БД с отзывом не должна воскресить сессию. */
  rememberActive(sessionId: string): Promise<void>
  markRevoked(sessionIds: readonly string[]): Promise<void>
}
