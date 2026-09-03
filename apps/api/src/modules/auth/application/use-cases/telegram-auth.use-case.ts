/**
 * `TelegramAuthUseCase` (EP-01, DTJ-027, SRS-API-031/032) — TWA-путь auth.
 *
 * Алгоритм (10 шагов SRS-API-031, шаги 1-8 = `TelegramInitDataVerifier`,
 * шаги 9-10 = здесь):
 *   9. Find-or-create `User` по `(tenantId, telegramUserId)`:
 *      - Если связь `user_telegram_identities` существует — берём
 *        существующего `User` (ОДНА строка users на один Telegram id в
 *        тенанте; НЕ дубль).
 *      - Иначе — создаём `User` с `phoneNumber = null`, `role = 'customer'`,
 *        `fullName = firstName + ' ' + lastName?`, затем `user_telegram_identities`-связь.
 *   10. Создаём `AuthSession` (30 дней TTL, `familyId = id`, `deviceLabel =
 *       'telegram_twa'`) → выпуск JWT/refresh как в DTJ-024.
 *
 * **Атомарность**: find-or-create User + create identity ОБА внутри
 * `uow.run`, чтобы при падении identity-insert не остался user-orphan
 * (без identity можно считать, но сложнее cleanup'ить; наоборот — критичнее).
 * Drizzle-режим: `INSERT ... ON CONFLICT DO NOTHING` + `SELECT` для
 * find-or-create на identity (см. `UserTelegramIdentitiesRepository`).
 *
 * **Дефект (волна 6, найден при исправлении self-deadlock пула в checkout,
 * DTJ-231/233, подтверждён аудитом, исправлено здесь).** Абзац выше
 * заявлял атомарность, которой не было: `this.users.findById`/`this.users.create`
 * внутри `findOrCreateUser` шли через СВОЙ `@Inject(DRIZZLE_DB)`, игнорируя
 * `tx` из `uow.run` — второй путь входа с тем же self-deadlock-риском пула
 * соединений, что и `VerifyOtpUseCase` (см. её JSDoc за полным разбором
 * механизма и `checkout.use-case.ts::processGroup` — первое место, где
 * дефект нашёлся и был доказан). Исправлено: `tx` теперь прокидывается в
 * оба вызова (см. `findOrCreateUser` ниже) — атомарность реальна.
 * `issueTokens` (шаг 10, AuthSession) НАМЕРЕННО остаётся ВНЕ этой
 * транзакции (см. её JSDoc) — это отдельное архитектурное решение, не
 * часть этого дефекта.
 *
 * **Телефон** НЕ собирается на этом шаге — DTJ-027 явно решил: «phone
 * запрашивается отдельно при оформлении первого заказа». На момент
 * Telegram-auth `users.phoneNumber = null` (схема разрешает после
 * миграции 0007).
 *
 * **Tenant ID** — `input.tenantId` (волна 5, блок A, возврат). Раньше здесь
 * стоял `const TENANT_ID_PLACEHOLDER = 'neutral'` — не-UUID литерал, тихо
 * утекавший в `users.tenant_id`/`user_telegram_identities.tenant_id UUID
 * NOT NULL` и роняющий ЛЮБОЙ `POST /auth/telegram` с `22P02 invalid input
 * syntax for type uuid` после перевода `USERS_REPOSITORY` на Drizzle. Тот же
 * класс дефекта, что чинили в `otp-verify.controller.ts`/`otp-request.controller.ts`
 * (`resolveTenantIdForVerify`/`resolveTenantIdForRequest`) — резолв через
 * `TenantContext` в presentation-слое (`TelegramAuthController`), передача
 * готовым полем во `execute()`; application-слой `TenantContext`
 * (`AsyncLocalStorage`) не импортирует.
 *
 * **Идемпотентность**: повторный `POST /auth/telegram` с тем же
 * `initData` приведёт к `TELEGRAM_AUTH_DATE_EXPIRED` (через 5 минут). С
 * новым `initData` (другой `auth_date`) — find-or-create на identity найдёт
 * существующего User, и use case вернёт НОВУЮ пару токенов для НОВОЙ
 * `auth_sessions`-строки. Это намеренное поведение: «каждый раз как
 * открыл TWA — новая сессия» (тикет DTJ-026 §3.5, как refresh после
 * истечения).
 *
 * Архитектура (C1, C5, C7, C13, C14, C15, C17, Ж2, Ж4, Ж8):
 *   - 7 DI-инъекций (как `VerifyOtpUseCase`); `max-params` отключён с
 *     обоснованием (Ж2).
 *   - `execute()` делегирует `findOrCreateUser` и `issueTokens`.
 */
import { Inject, Injectable } from '@nestjs/common'
import {
  type UserRole,
  InvalidTelegramInitDataError,
  TelegramAuthDateExpiredError,
  TelegramBotNotConfiguredError,
} from '@dorutj/contracts'
import { type Result, err, ok } from '@dorutj/domain-kernel'
import { CLOCK, ID_GENERATOR, type Clock, type IdGenerator } from '@/shared-kernel/index.js'
import { type User } from '@/modules/auth/domain/user.js'
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
  AUTH_SESSIONS_REPOSITORY,
  type AuthSessionsRepository,
  type CreateAuthSessionInput,
} from '@/modules/auth/application/ports/auth-sessions.repository.port.js'
import {
  REFRESH_TOKEN_GENERATOR,
  type RefreshTokenGeneratorPort,
} from '@/modules/auth/application/ports/refresh-token-generator.port.js'
import {
  UNIT_OF_WORK,
  type UnitOfWorkPort,
} from '@/modules/auth/application/ports/unit-of-work.port.js'
import {
  TELEGRAM_INIT_DATA_VERIFIER,
  type TelegramInitDataVerifierPort,
  type TelegramInitDataVerified,
} from '@/modules/auth/application/ports/telegram-init-data-verifier.port.js'
import {
  USER_TELEGRAM_IDENTITIES_REPOSITORY,
  type UserTelegramIdentitiesRepository,
} from '@/modules/auth/application/ports/user-telegram-identities.repository.port.js'
import { AppConfigService } from '@/config/app-config.service.js'

const DEVICE_LABEL_TELEGRAM_TWA = 'telegram_twa'

export interface TelegramAuthInput {
  readonly initData: string
  readonly ipAddress: string
  readonly userAgent: string
  /** Реальный UUID тенанта — резолвится `TelegramAuthController` из `TenantContext`. */
  readonly tenantId: string
}

export interface TelegramAuthResult {
  readonly accessToken: string
  readonly refreshToken: string
  readonly user: User
  readonly telegram: {
    readonly telegramUserId: string
    readonly firstName: string
    readonly lastName: string | null
    readonly username: string | null
  }
}

export type TelegramAuthError =
  | InvalidTelegramInitDataError
  | TelegramAuthDateExpiredError
  | TelegramBotNotConfiguredError

 
@Injectable()
export class TelegramAuthUseCase {
  // Обоснование ниже, для строки eslint-disable непосредственно перед constructor: 10 DI-инъекций
  // (NestJS constructor injection резолвит по позиции; единый options-объект не идиоматичен для
  // Nest DI и потребовал бы кастомный factory provider — см. class JSDoc выше).
  // eslint-disable-next-line max-params -- 10 DI-инъекций NestJS constructor injection, см. комментарий выше
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(USERS_REPOSITORY) private readonly users: UsersRepository,
    @Inject(USER_TELEGRAM_IDENTITIES_REPOSITORY)
    private readonly telegramIdentities: UserTelegramIdentitiesRepository,
    @Inject(AUTH_SESSIONS_REPOSITORY) private readonly authSessions: AuthSessionsRepository,
    @Inject(JWT_SIGNER) private readonly jwt: JwtSignerPort,
    @Inject(REFRESH_TOKEN_GENERATOR) private readonly refreshGen: RefreshTokenGeneratorPort,
    @Inject(TELEGRAM_INIT_DATA_VERIFIER)
    private readonly verifier: TelegramInitDataVerifierPort,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWorkPort,
    // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` — см. DTJ-001,
    // без него `config` резолвится как `undefined` под тестовым рантаймом.
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  async execute(input: TelegramAuthInput): Promise<Result<TelegramAuthResult, TelegramAuthError>> {
    // 0) Pre-check: bot token обязан быть настроен (контроллер тоже проверяет,
    // но здесь — defense-in-depth на случай, если use case вызывают
    // напрямую из тестов/скриптов).
    const botToken = this.config.telegramBotTokenNeutral
    if (botToken === undefined || botToken.length === 0) {
      return err(new TelegramBotNotConfiguredError())
    }

    // 1) Шаги 1-8 SRS-API-031: валидация initData. `TelegramInitDataVerifierPort.verify`
    // по контракту БРОСАЕТ (см. `TelegramInitDataVerifierAdapter`), а не возвращает
    // `Result` — оборачиваем в try/catch, иначе `execute()` не держит СВОЙ
    // собственный контракт `Promise<Result<...>>` (ошибка verify() улетала
    // необработанным rejection'ом вместо `err(...)`, обнаружено unit-тестом:
    // `isErr(result)).toBe(true)` падал на неперехваченном исключении).
    let verified: TelegramInitDataVerified
    try {
      verified = await this.verifier.verify({
        initData: input.initData,
        botToken,
        now: this.clock.now(),
        maxAgeSeconds: this.config.telegramInitDataMaxAgeSeconds,
      })
    } catch (error: unknown) {
      if (error instanceof InvalidTelegramInitDataError || error instanceof TelegramAuthDateExpiredError) {
        return err(error)
      }
      throw error
    }

    // 2) Шаги 9-10: find-or-create User + identity + AuthSession + JWT.
    const user = await this.findOrCreateUser(verified, input.tenantId)
    const tokens = await this.issueTokens(user, input)
    return ok({
      ...tokens,
      user,
      telegram: {
        telegramUserId: verified.telegramUserId,
        firstName: verified.user.firstName,
        lastName: verified.user.lastName,
        username: verified.user.username,
      },
    })
  }

  /**
   * Find-or-create User + user_telegram_identities. Атомарно через uow.
   * Шаг 9 SRS-API-031.
   */
  private async findOrCreateUser(verified: TelegramInitDataVerified, tenantId: string): Promise<User> {
    return this.uow.run(async (tx) => {
      const telegramUserId = BigInt(verified.telegramUserId)
      const existingIdentity = await this.telegramIdentities.findByTenantAndTelegramId(
        tenantId,
        telegramUserId,
        tx,
      )
      if (existingIdentity !== null) {
        const user = await this.users.findById(existingIdentity.userId, tx)
        if (user === null) {
          // Не должно случиться (FK CASCADE), но если — fail loud, не silent.
          throw new Error(
            `TelegramAuth: identity points to missing user ${existingIdentity.userId}`,
          )
        }
        return user
      }
      // Создаём нового User (phoneNumber=null) и identity.
      const fullName = verified.user.lastName !== null
        ? `${verified.user.firstName} ${verified.user.lastName}`
        : verified.user.firstName
      const user = await this.users.create({
        tenantId,
        phoneNumber: null,
        role: 'customer' satisfies UserRole,
        fullName,
      } satisfies CreateUserInput, tx)
      await this.telegramIdentities.create(
        {
          userId: user.id,
          tenantId,
          telegramUserId,
        },
        tx,
      )
      return user
    })
  }

  /**
   * Шаг 10: AuthSession + JWT. Вынесен, чтобы `execute` остался
   * оркестратором (C1). Не в uow.run — AuthSession.create и JWT.sign
   * независимы от identity-транзакции (identity уже создана в `findOrCreateUser`).
   */
  private async issueTokens(
    user: User,
    input: TelegramAuthInput,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const refresh = this.refreshGen.generate()
    const sessionId = this.ids.next()
    const session = AuthSession.create({
      id: sessionId,
      tenantId: user.tenantId,
      userId: user.id,
      refreshTokenHash: refresh.hash,
      deviceLabel: DEVICE_LABEL_TELEGRAM_TWA,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      clock: this.clock,
    })
    await this.authSessions.create(sessionToCreateInput(session))
    const claims: JwtClaims = {
      sub: user.id,
      role: user.role,
      tenantId: user.tenantId,
      pharmacyId: user.pharmacyId,
      chainId: user.chainId,
      sessionId: session.id,
    }
    const accessToken = this.jwt.sign(claims)
    return { accessToken, refreshToken: refresh.token }
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
