/**
 * `LogoutAllUseCase` (EP-01, DTJ-026, SRS-API-029) — отзыв ВСЕХ сессий
 * текущего пользователя независимо от `family_id` (в отличие от
 * reuse-detection, который отзывает одну `family_id`).
 *
 * Контракт (DTJ-026 §3.2):
 *   - `authSessions.revokeAllByUserId(userId, reason='user_logout_all', now)`
 *     (один `UPDATE`, все `family_id` этого `userId`).
 *
 * Use case НЕ возвращает `Result` (нет ошибок) — это fire-and-forget.
 * Idempotency: повторный вызов revoke'ит 0 сессий (уже revoked), это
 * нормальный сценарий.
 *
 * Защита от self-DoS: если у пользователя 100 устройств, `logout-all`
 * — ОДИН UPDATE; нет риска таймаута.
 *
 * Архитектура (C1, C5, C17, Ж2):
 *   - `execute()` ≤15 LOC.
 *   - 2 DI-инъекции.
 */
import { Inject, Injectable } from '@nestjs/common'
import {
  AUTH_SESSIONS_REPOSITORY,
  type AuthSessionsRepository,
} from '@/modules/auth/application/ports/auth-sessions.repository.port.js'
import {
  UNIT_OF_WORK,
  type UnitOfWorkPort,
} from '@/modules/auth/application/ports/unit-of-work.port.js'

export interface LogoutAllInput {
  /** `userId` из JWT-claims. Не нужен refreshToken — endpoint не принимает тело. */
  readonly userId: string
}

@Injectable()
export class LogoutAllUseCase {
  constructor(
    @Inject(AUTH_SESSIONS_REPOSITORY) private readonly authSessions: AuthSessionsRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWorkPort,
  ) {}

  async execute(input: LogoutAllInput): Promise<void> {
    const now = new Date()
    await this.uow.run(async (tx) => {
      await this.authSessions.revokeAllByUserId(tx, input.userId, 'user_logout_all', now)
    })
  }
}
