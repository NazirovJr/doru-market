/**
 * `LogoutUseCase` (EP-01, DTJ-026, SRS-API-029) — отзыв ТОЛЬКО текущей
 * `auth_sessions`-записи по `refreshToken`, с проверкой владения.
 *
 * Контракт (DTJ-026 §3.1):
 *   1. `tokenHash = sha256(refreshToken)` → `authSessions.findByRefreshHash`.
 *   2. Сессия не найдена → идемпотентный `Result.ok(undefined)`. Не раскрывать
 *      существование/не-существование refresh-токена (SRS-API-028).
 *   3. `session.userId !== currentUserId` → идемпотентный `Result.ok`. Защита
 *      от логаута ЧУЖОЙ сессии через подставленный чужой refresh-токен в
 *      теле при своём валидном access-токене — оба должны принадлежать
 *      одному пользователю. НЕ ошибка (не раскрываем существование).
 *   4. Сессия уже revoked → идемпотентный `Result.ok` (повторный logout —
 *      нормальный сценарий: клиент мог попытаться logout дважды).
 *   5. Иначе: `uow.run` → `authSessions.revokeOneById(sessionId, 'user_logout', now)`.
 *
 * Архитектура (C1, C5, C7, C13, C14, C15, C17, Ж2, Ж8):
 *   - `execute()` ≤30 LOC, делегирует одной приватной функции.
 *   - 3 DI-инъекции (`AuthSessionsRepository`, `UnitOfWorkPort`, опосредованно
 *     `Clock`/`refreshGen` НЕ нужны — sha256 считается локально).
 *   - sha256 через `node:crypto.createHash` (как в `RefreshTokenUseCase`).
 */
import { createHash } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { type Result, ok } from '@dorutj/domain-kernel'
import {
  AUTH_SESSIONS_REPOSITORY,
  type AuthSessionsRepository,
} from '@/modules/auth/application/ports/auth-sessions.repository.port.js'
import {
  UNIT_OF_WORK,
  type UnitOfWorkPort,
} from '@/modules/auth/application/ports/unit-of-work.port.js'

const SHA256_HEX_LENGTH = 64

export interface LogoutInput {
  readonly refreshToken: string
  /** `userId` из JWT-claims (`@CurrentUser().sub`) — AuthGuard подтверждает валидность токена. */
  readonly currentUserId: string
}

export type LogoutResult = Result<void, never>

@Injectable()
export class LogoutUseCase {
  constructor(
    @Inject(AUTH_SESSIONS_REPOSITORY) private readonly authSessions: AuthSessionsRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWorkPort,
  ) {}

  async execute(input: LogoutInput): Promise<LogoutResult> {
    const tokenHash = hashToken(input.refreshToken)
    const session = await this.authSessions.findByRefreshHash(tokenHash)
    if (session === null) {
      // DTJ-026 §3.1: «Given сессия не найдена/не принадлежит текущему
      // пользователю → идемпотентный успех».
      return ok(undefined)
    }
    if (session.userId !== input.currentUserId) {
      // Чужая сессия — тихий успех, НЕ ошибка (SRS-API-029, защита от
      // enumeration через `403 FORBIDDEN`).
      return ok(undefined)
    }
    if (session.isRevoked()) {
      // Шаг 4 контракта (см. JSDoc выше): повторный logout — нормальный
      // идемпотентный сценарий, НЕ вызываем `revokeOneById` повторно.
      return ok(undefined)
    }
    const now = new Date()
    await this.uow.run(async (tx) => {
      await this.authSessions.revokeOneById({ tx, sessionId: session.id, reason: 'user_logout', now })
    })
    return ok(undefined)
  }
}

/** sha256(opaque refresh) → 64 hex. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, SHA256_HEX_LENGTH)
}
