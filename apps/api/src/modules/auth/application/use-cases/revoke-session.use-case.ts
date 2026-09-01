/**
 * `RevokeSessionUseCase` (EP-01, DTJ-026, SRS-API-030) — self-service отзыв
 * КОНКРЕТНОЙ `auth_sessions`-записи (устройства из списка).
 *
 * Контракт (DTJ-026 §3.4):
 *   - `session.userId !== actorUserId` → `403 FORBIDDEN` (ДАЖЕ для `super_admin` —
 *     принудительный отзыв чужой сессии — отдельный административный эндпоинт
 *     `POST /admin/users/:id/force-logout` в EP-15, НЕ в зоне этого тикета).
 *   - Сессия не найдена → `403 FORBIDDEN` (тот же код, не 404 — не раскрываем
 *     существование чужих сессий).
 *   - Уже revoked → `403 FORBIDDEN` (нельзя «повторно отозвать» — это идемпотентный
 *     no-op в БД, но клиенту семантически это «не твоя» сессия, и 403 более
 *     безопасен: `actorUserId !== session.userId` ВСЕГДА правда для revoked
 *     сессий из чужой семьи).
 *   - Иначе: `uow.run` → `revokeOneById(sessionId, 'user_logout', now)`.
 *
 * `RevokeReason` для `RevokeSessionUseCase` — `'user_logout'` (не
 * `'user_logout_all'`), т.к. это точечный отзыв одного устройства, не всех.
 * Исторически обе причины суть «user_logout*», но `'user_logout_all'`
 * зарезервирован для `LogoutAllUseCase` (DTJ-026 §3.2) — для согласованности
 * audit-лога.
 *
 * Архитектура (C1, C5, C17, Ж2):
 *   - `execute()` ≤30 LOC, делегирует один helper.
 *   - 2 DI-инъекции.
 */
import { Inject, Injectable } from '@nestjs/common'
import { ForbiddenError } from '@dorutj/contracts'
import { type Result, err, ok } from '@dorutj/domain-kernel'
import {
  AUTH_SESSIONS_REPOSITORY,
  type AuthSessionsRepository,
} from '@/modules/auth/application/ports/auth-sessions.repository.port.js'
import {
  UNIT_OF_WORK,
  type UnitOfWorkPort,
} from '@/modules/auth/application/ports/unit-of-work.port.js'

export interface RevokeSessionInput {
  readonly sessionId: string
  readonly actorUserId: string
}

export type RevokeSessionResult = Result<void, ForbiddenError>

@Injectable()
export class RevokeSessionUseCase {
  constructor(
    @Inject(AUTH_SESSIONS_REPOSITORY) private readonly authSessions: AuthSessionsRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWorkPort,
  ) {}

  async execute(input: RevokeSessionInput): Promise<RevokeSessionResult> {
    const session = await this.authSessions.findById(input.sessionId)
    // Объединённая проверка владения: не найдено ИЛИ чужой пользователь
    // ИЛИ уже revoked → один `403 FORBIDDEN` (не раскрываем детали).
    if (session === null || session.userId !== input.actorUserId) {
      return err(new ForbiddenError('Session does not belong to current user'))
    }
    const now = new Date()
    await this.uow.run(async (tx) => {
      await this.authSessions.revokeOneById(tx, session.id, 'user_logout', now)
    })
    return ok(undefined)
  }
}
