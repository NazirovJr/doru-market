/**
 * `AuthSessionsRepository` (EP-01, DTJ-024/025/026, SRS-API-023/025/026/027/029/030) —
 * порт для материализованных сессий.
 *
 * Контракт:
 *   - `create(input)` — создать первую сессию цепочки. `input.refreshTokenHash`
 *     уже посчитан вызывающим кодом; `familyId` равен `input.id` (DTJ-024 §3.6).
 *     Репозиторий НЕ генерирует opaque refresh (это инфраструктурная
 *     ответственность, см. `CryptoRefreshTokenPort`).
 *   - `findById(id)` — для `auth_sessions.revoke` (DTJ-026) и аудита.
 *   - `findActiveByUserId(userId, now)` — список активных сессий (DTJ-026).
 *   - `findByRefreshHash(hash)` — для refresh-rotation (DTJ-025).
 *   - `revokeCurrentAndCreateNext(input, tx)` (DTJ-025 §2.6) — атомарная
 *     операция refresh-rotation: помечает текущую строку `rotated_at = now()`
 *     и создаёт НОВУЮ запись с тем же `familyId` / `absoluteExpiresAt`,
 *     `userId`/deviceLabel/userAgent/ipAddress скопированы, новый
 *     `refreshTokenHash`. Внутри `uow.run` — обязательно в транзакции.
 *   - `revokeAllByFamilyId({ tx, familyId, reason, now })` (DTJ-025 §2.3) —
 *     атомарный `UPDATE ... SET revoked_at = now(), revoke_reason = :reason
 *     WHERE family_id = :fid AND revoked_at IS NULL`. Используется при
 *     detect-reuse — отзывает ВСЕ `auth_sessions` с тем же `family_id`.
 *     Внутри `uow.run`. Именованный параметр-объект (C-стиль, max-params).
 *   - `revokeOneById({ tx, sessionId, reason, now })` (DTJ-026 §3.1) — атомарный
 *     `UPDATE ... SET revoked_at = now(), revoke_reason = :reason WHERE id = :id
 *     AND revoked_at IS NULL`. Используется в `LogoutUseCase` (текущая
 *     сессия) и `RevokeSessionUseCase` (конкретное устройство из списка).
 *     Возвращает количество отозванных строк (0 если уже revoked/не найдено).
 *   - `revokeAllByUserId({ tx, userId, reason, now })` (DTJ-026 §3.2) — атомарный
 *     `UPDATE ... WHERE user_id = :uid AND revoked_at IS NULL`. `LogoutAllUseCase`.
 *   - `updateLastSeenAt(sessionId, now, tx)` (DTJ-026, не вызывается в R1 —
 *     место для будущего heartbeat'а; см. также `RefreshTokenUseCase`,
 *     где `last_seen_at` обновляется через DML в составе `rotate`).
 *     Намеренно оставлен в контракте с пометкой «R2+» — для предотвращения
 *     регрессии при миграции.
 */
export const AUTH_SESSIONS_REPOSITORY = Symbol.for('@dorutj/auth/auth-sessions-repository')

import { type UnitOfWorkTx } from './unit-of-work.port.js'
import { type AuthSession } from '../../domain/value-objects/auth-session.vo.js'

export interface CreateAuthSessionInput {
  readonly id: string
  readonly tenantId: string
  readonly userId: string
  readonly refreshTokenHash: string
  readonly deviceLabel: string
  readonly userAgent: string
  readonly ipAddress: string
  readonly absoluteExpiresAt: Date
  readonly createdAt: Date
}

/**
 * [DTJ-025, SRS-API-026] Параметры атомарной ротации refresh-токена.
 * Используется в `AuthSessionsRepository.revokeCurrentAndCreateNext`.
 */
export interface RotateAuthSessionInput {
  /** id новой строки (предыдущая остаётся, `rotated_at` на ней заполняется). */
  readonly nextId: string
  readonly tenantId: string
  readonly userId: string
  readonly familyId: string
  readonly deviceLabel: string
  readonly userAgent: string
  readonly ipAddress: string
  /** sha256 уже посчитан вызывающим кодом (use case через `RefreshTokenGeneratorPort`). */
  readonly newRefreshTokenHash: string
  /** Копируется с предыдущей строки (SRS-API-025: НЕ продлевается). */
  readonly absoluteExpiresAt: Date
  readonly now: Date
}

/** [DTJ-025, SRS-API-027] Допустимые причины revoke для логирования/аудита. */
export type RevokeReason = 'user_logout' | 'user_logout_all' | 'reuse_detected' | 'admin_force'

export interface AuthSessionsRepository {
  /**
   * `tx?` (волна 6, self-deadlock пула соединений — тот же дефект, что чинили в
   * checkout DTJ-231/233): `VerifyOtpUseCase.createSession` вызывается ВНУТРИ
   * `uow.run(tx => ...)` — без `tx` здесь `create` просило бы у пула ВТОРОЕ
   * соединение поверх уже удержанного транзакцией группы. Опционален —
   * `TelegramAuthUseCase.issueTokens` вызывает `create` ВНЕ транзакции
   * (намеренно, см. JSDoc `telegram-auth.use-case.ts`), там аргумент не передаётся.
   */
  create(input: CreateAuthSessionInput, tx?: UnitOfWorkTx): Promise<AuthSession>
  findById(id: string): Promise<AuthSession | null>
  findByRefreshHash(hash: string): Promise<AuthSession | null>
  findActiveByUserId(userId: string, now: Date): Promise<readonly AuthSession[]>

  /**
   * Атомарная refresh-rotation (DTJ-025 §2.6): пометить `previousId.rotated_at =
   * now()`, создать новую `auth_sessions`-строку с тем же `family_id` и
   * скопированным `absolute_expires_at`. Должна вызываться ВНУТРИ
   * `unitOfWork.run(...)` (для Drizzle — `db.transaction`). InMemory-режим
   * игнорирует `tx` (атомарность через синхронность Map).
   */
  revokeCurrentAndCreateNext(
    tx: UnitOfWorkTx,
    previousId: string,
    input: RotateAuthSessionInput,
  ): Promise<AuthSession>

  /**
   * Атомарный `UPDATE ... WHERE family_id = :fid AND revoked_at IS NULL`
   * (DTJ-025 §2.3) — отзыв ВСЕХ сессий семейства (при detect-reuse). Возвращает
   * количество реально отозванных строк (для логирования). Должна вызываться
   * ВНУТРИ `unitOfWork.run(...)`.
   */
  revokeAllByFamilyId(input: {
    tx: UnitOfWorkTx
    familyId: string
    reason: RevokeReason
    now: Date
  }): Promise<number>

  /**
   * Атомарный `UPDATE ... SET revoked_at = now(), revoke_reason = :reason
   * WHERE id = :id AND revoked_at IS NULL` (DTJ-026 §3.1). Возвращает
   * количество реально отозванных строк (0 = уже revoked или не найдено —
   * идемпотентный путь для `LogoutUseCase`).
   */
  revokeOneById(input: {
    tx: UnitOfWorkTx
    sessionId: string
    reason: RevokeReason
    now: Date
  }): Promise<number>

  /**
   * Атомарный `UPDATE ... WHERE user_id = :uid AND revoked_at IS NULL`
   * (DTJ-026 §3.2, `logout-all`). Возвращает количество отозванных строк.
   */
  revokeAllByUserId(input: {
    tx: UnitOfWorkTx
    userId: string
    reason: RevokeReason
    now: Date
  }): Promise<number>
}
