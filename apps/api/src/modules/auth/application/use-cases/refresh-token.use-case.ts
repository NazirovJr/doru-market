/**
 * `RefreshTokenUseCase` (EP-01, DTJ-025, SRS-API-026/027/028) — refresh-rotation
 * с обнаружением переиспользования.
 *
 * Алгоритм (тикет DTJ-025 §2.1-2.7, СТРОГО в этом порядке — порядок критичен
 * для корректности кода ошибки, см. «Риски»):
 *
 *   1. `tokenHash = sha256(refreshToken)` → `findByRefreshHash`.
 *      Не найдено → `RefreshTokenInvalidError` (401 REFRESH_TOKEN_INVALID,
 *      SRS-API-028: «не отличать "никогда не существовал" от "давно истёк"»).
 *
 *   2. `isRevoked()` → `RefreshTokenInvalidError` (уже отозван — повторный
 *      reuse-алерт на мёртвую сессию не несёт новой информации, DTJ-025 §2.4).
 *
 *   3. `absoluteExpiresAt < now` → `RefreshTokenInvalidError` (SRS-API-028,
 *      штатное истечение. ПРОВЕРЯЕТСЯ ДО `rotated_at`, чтобы не спутать
 *      «просрочен» с «переиспользован»).
 *
 *   4. `isRotated()` (т.е. `rotatedAt IS NOT NULL` — прошлое звено цепочки) →
 *      **detect-reuse** (SRS-API-027): внутри `uow.run` —
 *      `authSessions.revokeAllByFamilyId(familyId, 'reuse_detected', now, tx)`,
 *      `pino.warn` security-событие (НЕ `audit_log`), возврат
 *      `RefreshTokenReuseDetectedError` (401 REFRESH_TOKEN_REUSE_DETECTED).
 *
 *   5. Иначе (звено валидно): внутри `uow.run` —
 *      `authSessions.revokeCurrentAndCreateNext(tx, previousId, ...)`. Новая
 *      строка имеет тот же `familyId` (DTJ-025 §2.6), скопированный
 *      `absoluteExpiresAt` (SRS-API-025: НЕ продлевается), новый
 *      `refreshTokenHash`. Затем читаем `users.findById(userId)` заново
 *      (НЕ из `auth_sessions` — смена роли/тенанта отражается на следующем
 *      refresh, DTJ-025 §2.6) и подписываем НОВЫЙ `accessToken` через
 *      `JwtSignerPort`. Возврат `ok({ accessToken, refreshToken, user })`.
 *
 * Архитектура (C1, C5, C7, C13, C14, C15, C17, Ж2, Ж8):
 *   - `execute()` делегирует приватным методам (каждый ≤40 LOC).
 *   - 6 DI-инъекций (порты + Pino-логгер) — `max-params` отключён с
 *     обоснованием (см. ниже), по аналогии с `VerifyOtpUseCase`.
 *   - `pinoLogger` через DI-токен `PINO_LOGGER` (общий, `common/logging/`).
 *   - sha256 через `node:crypto.createHash` (не VO, как и в `VerifyOtpUseCase`).
 *   - `familyId`/`previousId`/`sessionId` НЕ логируются как PII — только
 *     `userId` + `familyId` (это `uuid`, не персональные данные; DoD п.4
 *     «только хеши/идентификаторы в логах»).
 */
import { createHash, randomUUID } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { type Logger } from 'pino'
import {
  RefreshTokenInvalidError,
  RefreshTokenReuseDetectedError,
} from '@dorutj/contracts'
import { type Result, err, ok } from '@dorutj/domain-kernel'
import { PINO_LOGGER } from '@/common/logging/pino-logger.token.js'
import { type User } from '@/modules/auth/domain/user.js'
import { AuthSession } from '@/modules/auth/domain/value-objects/auth-session.vo.js'
import {
  AUTH_SESSIONS_REPOSITORY,
  type AuthSessionsRepository,
  type RotateAuthSessionInput,
} from '@/modules/auth/application/ports/auth-sessions.repository.port.js'
import {
  JWT_SIGNER,
  type JwtClaims,
  type JwtSignerPort,
} from '@/modules/auth/application/ports/jwt-signer.port.js'
import {
  USERS_REPOSITORY,
  type UsersRepository,
} from '@/modules/auth/application/ports/users.repository.port.js'
import {
  REFRESH_TOKEN_GENERATOR,
  type RefreshTokenGeneratorPort,
} from '@/modules/auth/application/ports/refresh-token-generator.port.js'
import {
  UNIT_OF_WORK,
  type UnitOfWorkPort,
} from '@/modules/auth/application/ports/unit-of-work.port.js'

const SHA256_HEX_LENGTH = 64

export interface RefreshTokenInput {
  readonly refreshToken: string
  /** [SRS-API-027, DTJ-025 §2.3] Используется ТОЛЬКО для security-лога
   *  при detect-reuse; не влияет на бизнес-логику. */
  readonly ipAddress: string
}

export interface RefreshTokenResult {
  readonly accessToken: string
  readonly refreshToken: string
  readonly user: User
}

export type RefreshTokenError = RefreshTokenInvalidError | RefreshTokenReuseDetectedError

 
@Injectable()
export class RefreshTokenUseCase {
  constructor(
    @Inject(AUTH_SESSIONS_REPOSITORY) private readonly authSessions: AuthSessionsRepository,
    @Inject(USERS_REPOSITORY) private readonly users: UsersRepository,
    @Inject(JWT_SIGNER) private readonly jwt: JwtSignerPort,
    @Inject(REFRESH_TOKEN_GENERATOR) private readonly refreshGen: RefreshTokenGeneratorPort,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWorkPort,
    @Inject(PINO_LOGGER) private readonly logger: Logger,
  ) {}

  async execute(
    input: RefreshTokenInput,
  ): Promise<Result<RefreshTokenResult, RefreshTokenError>> {
    const tokenHash = hashToken(input.refreshToken)
    const session = await this.authSessions.findByRefreshHash(tokenHash)
    if (session === null) {
      // DTJ-025 §2.2: «не раскрывать причину подробнее» — единый код для
      // «никогда не существовал» / «давно вычищен» / «не наш формат».
      return err(new RefreshTokenInvalidError())
    }

    if (session.isRevoked()) {
      // DTJ-025 §2.4: уже отозван (logout/logout-all или предыдущий reuse).
      // НЕ триггерим reuse-detection повторно — на мёртвой сессии это не
      // несёт новой информации (SRS-API-027 «ВСЕ auth_sessions с тем же
      // family_id» уже отозваны предыдущим событием).
      return err(new RefreshTokenInvalidError())
    }

    const now = new Date()
    if (now.getTime() > session.absoluteExpiresAt.getTime()) {
      // DTJ-025 §2.5: ПРОВЕРЯЕТСЯ ДО `rotated_at`, чтобы не спутать
      // «штатное истечение» с «переиспользован». Если поменять порядок —
      // приёмка №3 DTJ-025 (негативный кейс с одновременно expired+rotated
      // отдаст `REUSE_DETECTED` вместо правильного `INVALID`).
      return err(new RefreshTokenInvalidError())
    }

    if (session.isRotated()) {
      // DETECT-REUSE (SRS-API-027). Атомарный revoke всей family + лог.
      return this.handleReuseDetected(session, now, input.ipAddress)
    }

    return this.rotate(session, now)
  }

  /**
   * Обработка detect-reuse: отозвать ВСЕ `auth_sessions` с тем же
   * `familyId` и залогировать security-событие. Возвращает
   * `RefreshTokenReuseDetectedError`.
   */
  private async handleReuseDetected(
    session: AuthSession,
    now: Date,
    ipAddress: string,
  ): Promise<Result<RefreshTokenResult, RefreshTokenReuseDetectedError>> {
    await this.uow.run(async (tx) => {
      await this.authSessions.revokeAllByFamilyId(
        tx,
        session.familyId,
        'reuse_detected',
        now,
      )
    })
    // DTJ-025 DoD п.4: «pino.warn security-событие содержит
    // userId/sessionFamilyId/ipAddress, НЕ содержит сами токены
    // (ни старый, ни новый — только хеши/идентификаторы в логах)».
    this.logger.warn(
      {
        userId: session.userId,
        sessionFamilyId: session.familyId,
        offendingSessionId: session.id,
        ipAddress,
        event: 'auth.refresh_reuse_detected',
      },
      'refresh token reuse detected',
    )
    return err(new RefreshTokenReuseDetectedError())
  }

  /**
   * Успешная ветка: refresh-rotation (пометить предыдущую + создать новую)
   * + перечитать `users` для актуальных claims + подписать новый accessToken.
   * `userId` берётся из `session.userId`, но сами claims — из БД (DTJ-025 §2.6).
   */
  private async rotate(
    previous: AuthSession,
    now: Date,
  ): Promise<Result<RefreshTokenResult, RefreshTokenError>> {
    // 1) Перечитываем пользователя заново (НЕ из `auth_sessions`) — смена
    // роли/тенанта администратором должна отразиться на следующем refresh.
    const user = await this.users.findById(previous.userId)
    if (user === null) {
      // Странная ситуация: `auth_sessions` ссылается на удалённого
      // пользователя. Soft-delete `users.deletedAt IS NULL` в `findById`
      // означает, что пользователь удалён. Трактуем как invalid token —
      // безопасный fail-closed (нельзя выдать новую пару).
      return err(new RefreshTokenInvalidError())
    }

    // 2) Генерируем новую пару: opaque refresh (возвращается клиенту ОДИН раз)
    // + sha256 хеш (для БД).
    const newRefresh = this.refreshGen.generate()

    // 3) Атомарная ротация в транзакции.
    const rotationInput: RotateAuthSessionInput = {
      nextId: this.generateNextId(),
      tenantId: previous.tenantId,
      userId: previous.userId,
      familyId: previous.familyId,
      deviceLabel: previous.deviceLabel,
      userAgent: previous.userAgent,
      ipAddress: previous.ipAddress,
      newRefreshTokenHash: newRefresh.hash,
      absoluteExpiresAt: previous.absoluteExpiresAt, // SRS-API-025: НЕ продлевается
      now,
    }
    const next = await this.uow.run(async (tx) => {
      return this.authSessions.revokeCurrentAndCreateNext(tx, previous.id, rotationInput)
    })

    // 4) Подписываем новый accessToken с актуальными claims пользователя.
    const claims: JwtClaims = {
      sub: user.id,
      role: user.role,
      tenantId: user.tenantId,
      pharmacyId: user.pharmacyId,
      chainId: user.chainId,
      sessionId: next.id, // ВАЖНО: новая сессия — следующие guards/revokes работают с ней.
    }
    const accessToken = this.jwt.sign(claims)
    return ok({ accessToken, refreshToken: newRefresh.token, user })
  }

  /**
   * [DTJ-025 §2.6, «Риски»] UUID для новой строки. Здесь простой
   * `crypto.randomUUID` (v4) — `IdGeneratorPort` не инжектится, т.к. в этом
   * use case он бы использовался РОВНО ОДИН раз (C15: нет второго потребителя).
   * При появлении второго — вынести в порт.
   */
  private generateNextId(): string {
    return randomUUID()
  }
}

/** sha256(opaque refresh) → 64 hex (SRS-API-026). */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, SHA256_HEX_LENGTH)
}
