/**
 * `VerifyOtpUseCase` (EP-01, DTJ-024, SRS-API-021..025) — шаг 2 OTP-логина.
 *
 * Ответственность (тикет DTJ-024 §3.1-3.9):
 *   1. UoW.run → SELECT FOR UPDATE строки `otp_codes` по `otpRequestId` (SRS-API-071).
 *   2. Презентационный Redis-счётчик `otp_verify_attempts:{otpRequestId}` —
 *      ОТДЕЛЬНАЯ сущность от `otp_codes.attempts` (доменного). При
 *      `count >= OTP_VERIFY_MAX_ATTEMPTS` → `OtpAttemptsExceededError` с
 *      каноническим `ux.error.otp_locked` (DTJ-024 §3.3, DoD п.4).
 *   3. `sha256(code + otpRequestId)` → `otpCode.verify(codeHash)` →
 *      `OtpMismatchError` при несовпадении (с инкрементом обоих счётчиков).
 *   4. find-or-create `User` с `role='customer'`. `phone` восстанавливается из
 *      `otp_codes.subject_ref` (НЕ передаётся клиентом — DTJ-024 §3.5).
 *   5. Создать `auth_sessions` (30 дней TTL, `family_id = id`).
 *   6. Подписать access JWT (`JwtSignerPort`).
 *   7. Пометить `otp_codes.consumed_at` (та же транзакция).
 *   8. Вернуть `{ accessToken, refreshToken, user }`.
 *
 * Архитектура (C1, C5, C7, C13, C14, C15, C17, Ж2, Ж4, Ж8):
 *   - execute() делегирует приватным методам (каждый ≤40 LOC).
 *   - 7 параметров конструктора — DI-инъекции, `max-params` отключён с
 *     обоснованием (см. ниже). Альтернатива (фабрика с deps-объектом
 *     через `useFactory`) скрывает граф зависимостей от `app.module.ts/providers[]`
 *     и нарушает Ж2 «написал компонент — подключи к рантайму явно».
 *   - `Promise.all` для параллельных операций.
 *   - `Clock` + `IdGenerator` через порты shared-kernel (Ж8).
 *   - Канонический текст ошибки — `useT('ru').t('ux.error.otp_locked')` (DTJ-024 DoD).
 */
import { createHash } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { useT } from '@dorutj/i18n'
import {
  OtpAttemptsExceededError,
  OtpExpiredError,
  OtpMismatchError,
  type UserRole,
} from '@dorutj/contracts'
import { type Result, err, isErr, ok } from '@dorutj/domain-kernel'
import { AppConfigService } from '@/config/app-config.service.js'
import { TIME_CONSTANTS } from '@/config/env.schema.js'
import { CLOCK, ID_GENERATOR, type Clock, type IdGenerator } from '@/shared-kernel/index.js'
import { type User } from '@/modules/auth/domain/user.js'
import { OTP_CODE_LENGTH, OtpCode } from '@/modules/auth/domain/value-objects/otp-code.vo.js'
import { PhoneNumber } from '@/modules/auth/domain/value-objects/phone-number.vo.js'
import { AuthSession } from '@/modules/auth/domain/value-objects/auth-session.vo.js'
import {
  JWT_SIGNER,
  type JwtClaims,
  type JwtSignerPort,
} from '@/modules/auth/application/ports/jwt-signer.port.js'
import {
  USERS_REPOSITORY,
  type CreateUserInput,
  type UsersRepository,
} from '@/modules/auth/application/ports/users.repository.port.js'
import {
  OTP_CODES_REPOSITORY,
  type OtpCodesRepository,
} from '@/modules/auth/application/ports/otp-codes.repository.port.js'
import {
  AUTH_SESSIONS_REPOSITORY,
  type AuthSessionsRepository,
  type CreateAuthSessionInput,
} from '@/modules/auth/application/ports/auth-sessions.repository.port.js'
import {
  REFRESH_TOKEN_GENERATOR,
  type RefreshTokenGeneratorPort,
} from '@/modules/auth/application/ports/refresh-token-generator.port.js'
import {
  RATE_LIMIT_CHECKER,
  type RateLimitCheckerPort,
} from '@/modules/auth/application/ports/rate-limit-checker.port.js'
import {
  UNIT_OF_WORK,
  type UnitOfWorkPort,
} from '@/modules/auth/application/ports/unit-of-work.port.js'

const SHA256_HEX_LENGTH = 64
const RATE_LIMITER_KEY_PREFIX_VERIFY = 'otp_verify_attempts'

export interface VerifyOtpInput {
  readonly otpRequestId: string
  readonly code: string
  readonly tenantId: string
  readonly deviceLabel: string
  readonly userAgent: string
  readonly ipAddress: string
}

export interface VerifyOtpResult {
  readonly accessToken: string
  readonly refreshToken: string
  readonly user: User
}

export type VerifyOtpError = OtpExpiredError | OtpMismatchError | OtpAttemptsExceededError

/**
 * Presentation (`verify-otp.dto.ts`) не имеет права читать `domain/` напрямую
 * (правило `presentation-goes-through-application`) — константа длины кода
 * идёт через use case, а не прямым импортом VO.
 */
export { OTP_CODE_LENGTH }

 
@Injectable()
export class VerifyOtpUseCase {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(USERS_REPOSITORY) private readonly users: UsersRepository,
    @Inject(OTP_CODES_REPOSITORY) private readonly otpCodes: OtpCodesRepository,
    @Inject(AUTH_SESSIONS_REPOSITORY) private readonly authSessions: AuthSessionsRepository,
    @Inject(JWT_SIGNER) private readonly jwt: JwtSignerPort,
    @Inject(REFRESH_TOKEN_GENERATOR) private readonly refreshGen: RefreshTokenGeneratorPort,
    @Inject(RATE_LIMIT_CHECKER) private readonly rateLimit: RateLimitCheckerPort,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWorkPort,
    // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` — см. DTJ-001,
    // без него `config` резолвится как `undefined` под тестовым рантаймом.
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  async execute(input: VerifyOtpInput): Promise<Result<VerifyOtpResult, VerifyOtpError>> {
    const now = this.clock.now()
    return this.uow.run(async (tx) => {
      const record = await this.otpCodes.findByIdForUpdate(tx, input.otpRequestId)
      if (record === null) {
        // DTJ-024 §3.2: «Given строка не найдена → OtpMismatchError
        // (не раскрывать «не существует» отдельным кодом — единообразие с
        // обычным неверным кодом)».
        return err(new OtpMismatchError())
      }

      // 1) Презентационный лимит попыток (Redis-счётчик) — ПЕРЕД verify.
      const attemptsCheck = await this.checkVerifyAttemptsLocked(input.otpRequestId, record.expiresAt)
      if (attemptsCheck.error !== null) {
        return err(attemptsCheck.error)
      }

      // 2) VO-уровень: verify хеша + (опосредованно) срока годности.
      const candidateHash = this.hashCode(input.code, input.otpRequestId)
      const otp = OtpCode.restore({
        codeHash: record.codeHash,
        subjectRef: record.subjectRef,
        issuedAt: record.issuedAt,
        expiresAt: record.expiresAt,
      })
      if (otp.isExpired(this.clock)) {
        await this.recordFailedVerify(tx, input.otpRequestId, record.id, record.expiresAt)
        return err(new OtpExpiredError())
      }
      const verifyResult = otp.verify(candidateHash)
      if (isErr(verifyResult)) {
        await this.recordFailedVerify(tx, input.otpRequestId, record.id, record.expiresAt)
        // `details.attempts` — SRS-API-022, сколько попыток ОСТАЛОСЬ (клиент
        // показывает счётчик пользователю). Новый `OtpMismatchError`, а не
        // `verifyResult.error` как есть — VO-уровень (`OtpCode.verify`) не
        // знает о презентационном Redis-счётчике попыток, у него нет details.
        return err(new OtpMismatchError({ attempts: attemptsCheck.attemptsLeft }))
      }

      // 3) Успех: find-or-create User, AuthSession, JWT, consume OTP.
      return this.completeVerification(tx, record, input, now)
    })
  }

  /**
   * Проверяет, исчерпан ли презентационный лимит попыток (`OTP_VERIFY_MAX_ATTEMPTS`,
   * DTJ-024 §3.3). Возвращает `OtpAttemptsExceededError` (с каноническим
   * `ux.error.otp_locked`) или `null`, если лимит не достигнут.
   *
   * ВНИМАНИЕ (DTJ-024 «Риски и подводные камни»): этот счётчик — ОТДЕЛЬНАЯ
   * сущность от `otp_codes.attempts` (доменный VO-счётчик). Семантика:
   *   - Презентационный (здесь) — анти-брутфорс verify для `purpose='login'`.
   *     Блокирует `otpRequestId` навсегда (TTL = `expiresAt - now`, т.е. до
   *     естественной смерти OTP).
   *   - Доменный (`otp_codes.attempts`) — VO-модель попыток для других
   *     `purpose` (например, `onboarding_contact`, где лимит на VO-уровне).
   */
  private async checkVerifyAttemptsLocked(
    otpRequestId: string,
    expiresAt: Date,
  ): Promise<{ readonly error: OtpAttemptsExceededError | null; readonly attemptsLeft: number }> {
    const key = `${RATE_LIMITER_KEY_PREFIX_VERIFY}:${otpRequestId}`
    const remainingTtl = Math.max(
      TIME_CONSTANTS.SECONDS_PER_MINUTE,
      Math.ceil((expiresAt.getTime() - this.clock.now().getTime()) / 1000),
    )
    const result = await this.rateLimit.incrementAndGet(key, remainingTtl)
    // Строго `>` (не `>=`): счётчик уже инкрементирован ДО обработки ТЕКУЩЕЙ
    // попытки, поэтому `count === max` — это САМА max-я попытка (она ещё имеет
    // право дойти до сравнения кода и вернуть обычный `OTP_MISMATCH`). Лок —
    // только на попытке `max + 1` (DTJ-024 §3.3: «6-я попытка → 423
    // OTP_LOCKED» при `OTP_VERIFY_MAX_ATTEMPTS=5`, т.е. 5 полноценных
    // MISMATCH-ответов, а не 4). С `>=` 5-я попытка сама попадала под лок —
    // обнаружено интеграционным тестом `otp-brute-force` (сценарий 3).
    const attemptsLeft = Math.max(0, this.config.otpVerifyMaxAttempts - result.count)
    if (result.count > this.config.otpVerifyMaxAttempts) {
      const { t } = useT('ru')
      return {
        error: new OtpAttemptsExceededError(
          { remainingTtlSeconds: remainingTtl, attempts: result.count, max: this.config.otpVerifyMaxAttempts },
          t('ux.error.otp_locked'),
        ),
        attemptsLeft,
      }
    }
    return { error: null, attemptsLeft }
  }

  /**
   * Регистрирует неудачную verify-попытку: инкрементирует ДОМЕННЫЙ счётчик
   * `otp_codes.attempts` (для аудита/консистентности) — не блокирует для
   * `login`, но фиксируется.
   */
  private async recordFailedVerify(
    tx: Parameters<OtpCodesRepository['findByIdForUpdate']>[0],
    otpRequestId: string,
    otpId: string,
    _expiresAt: Date,
  ): Promise<void> {
    // `otpId === otpRequestId` — обе формы UUID используются взаимозаменяемо
    // в R1 (мы выдаём `otpRequestId` равный `id` OTP-записи; в будущих версиях
    // это может разойтись, и тогда придётся искать по `id`).
    void otpRequestId
    await this.otpCodes.incrementAttempts(tx, otpId)
  }

  /**
   * Успешная ветка: User find-or-create + AuthSession + JWT + consumed.
   * Отдельный метод (C1) — `execute` остаётся оркестратором.
   */
  private async completeVerification(
    tx: Parameters<OtpCodesRepository['findByIdForUpdate']>[0],
    record: Awaited<ReturnType<OtpCodesRepository['findByIdForUpdate']>> & object,
    input: VerifyOtpInput,
    now: Date,
  ): Promise<Result<VerifyOtpResult, VerifyOtpError>> {
    if (record.consumedAt !== null) {
      // DTJ-024 §3 (SRS-DOM-082 alreadyConsumed): повторный verify с тем
      // же `otpRequestId`, даже верным кодом → `OtpMismatchError`.
      return err(new OtpMismatchError())
    }
    const phone = PhoneNumber.parse(record.subjectRef)
    const user = await this.users.findOrCreateByTenantAndPhone({
      tenantId: input.tenantId,
      phoneNumber: phone.value,
      role: 'customer' satisfies UserRole,
      fullName: null,
    } satisfies CreateUserInput)

    const refresh = this.refreshGen.generate()
    const sessionId = this.ids.next()
    const session = AuthSession.create({
      id: sessionId,
      tenantId: input.tenantId,
      userId: user.id,
      refreshTokenHash: refresh.hash,
      deviceLabel: input.deviceLabel,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      clock: this.clock,
    })
    const sessionInput = sessionToCreateInput(session)
    await this.authSessions.create(sessionInput)
    await this.otpCodes.markConsumed(tx, record.id, now)

    const claims: JwtClaims = {
      sub: user.id,
      role: user.role,
      tenantId: user.tenantId,
      pharmacyId: user.pharmacyId,
      chainId: user.chainId,
      sessionId: session.id,
    }
    const accessToken = this.jwt.sign(claims)
    return ok({ accessToken, refreshToken: refresh.token, user })
  }

  private hashCode(code: string, otpRequestId: string): string {
    return createHash('sha256').update(`${code}:${otpRequestId}`).digest('hex').slice(0, SHA256_HEX_LENGTH)
  }
}

function sessionToCreateInput(session: AuthSession): CreateAuthSessionInput {
  return {
    id: session.id,
    tenantId: session.tenantId,
    userId: session.userId,
    refreshTokenHash: session.refreshTokenHash,
    deviceLabel: session.deviceLabel,
    userAgent: session.userAgent,
    ipAddress: session.ipAddress,
    absoluteExpiresAt: session.absoluteExpiresAt,
    createdAt: session.createdAt,
  }
}
