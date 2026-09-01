/**
 * `RequestOtpUseCase` (EP-01, DTJ-023, SRS-API-018/019/020/021).
 *
 * Шаг 1 OTP-логина: валидирует телефон, проверяет 4 независимых лимита
 * (cooldown 60с / 10мин ≤3 / 24ч ≤10 по телефону + 1ч ≤20 по IP), генерирует
 * код, пишет хеш в репозиторий, отправляет SMS. Возвращает `{ otpRequestId,
 * expiresInSeconds: 300 }` ВСЕГДА одинаково — независимо от существования
 * пользователя (SRS-API-018: защита от перебора существующих номеров).
 *
 * Архитектурные замечания:
 *   - C5 (≤3 параметров конструктора): порты обёрнуты в `RequestOtpDeps`
 *     объектом-параметром; `AppConfigService` — отдельная зависимость.
 *   - C1 (≤40 строк функции): `execute` делегирует приватным методам.
 *   - C14 (`no-await-in-loop`): 4 лимита проверяются `Promise.all` —
 *     ключи независимы, гонки быть не может (атомарность INCR).
 *   - Ж8: ни `Date.now()`, ни `Math.random()` в domain/application —
 *     время через `Clock`, ID через `IdGenerator`, OTP через `OtpGeneratorPort`.
 */
import { createHash } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import {
  InvalidPhoneNumberFormatError,
  OtpRequestRateLimitedError,
} from '@dorutj/contracts'
import { AppConfigService } from '@/config/app-config.service.js'
import { TIME_CONSTANTS } from '@/config/env.schema.js'
// Внутренние импорты — ПРЯМО из файла (D-27: barrel — только для межмодульного).
import { CLOCK, ID_GENERATOR, type Clock, type IdGenerator } from '@/shared-kernel/index.js'
import { OtpCode, OTP_TTL_SECONDS } from '@/modules/auth/domain/value-objects/otp-code.vo.js'
import { PhoneNumber } from '@/modules/auth/domain/value-objects/phone-number.vo.js'
import {
  OTP_CODES_REPOSITORY,
  type OtpCodesRepository,
} from '@/modules/auth/application/ports/otp-codes.repository.port.js'
import {
  OTP_GENERATOR,
  type OtpGeneratorPort,
  type OtpPurpose,
} from '@/modules/auth/application/ports/otp-generator.port.js'
import {
  RATE_LIMIT_CHECKER,
  type RateLimitCheckerPort,
} from '@/modules/auth/application/ports/rate-limit-checker.port.js'
import { SMS_PROVIDER, type SmsProviderPort } from '@/modules/auth/application/ports/sms-provider.port.js'

const SHA256_HEX_LENGTH = 64

export interface RequestOtpInput {
  readonly phone: string
  readonly ipAddress: string
  readonly tenantId: string
}

export interface RequestOtpResult {
  readonly otpRequestId: string
  readonly expiresInSeconds: number
}

export interface RequestOtpDeps {
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly otpGenerator: OtpGeneratorPort
  readonly otpCodes: OtpCodesRepository
  readonly smsProvider: SmsProviderPort
  readonly rateLimiter: RateLimitCheckerPort
}

type RateLimitScope = 'phone_cooldown' | 'phone_10min' | 'phone_day' | 'ip_hour'

interface RateLimitCheck {
  readonly scope: RateLimitScope
  readonly key: string
  readonly windowSeconds: number
  readonly max: number
}

@Injectable()
export class RequestOtpUseCase {
  private readonly deps: RequestOtpDeps

  // eslint-disable-next-line max-params -- 6 портов DI-инъекций + AppConfigService. Альтернатива (фабрика с deps-объектом через `useFactory`) скрывает граф зависимостей от `app.module.ts`/providers[] и нарушает Ж2 «написал компонент — подключи к рантайму явно». Группировка в `RequestOtpDeps` сохранена для удобства тестирования и SRP.
  constructor(
    @Inject(CLOCK) clock: Clock,
    @Inject(ID_GENERATOR) ids: IdGenerator,
    @Inject(OTP_GENERATOR) otpGenerator: OtpGeneratorPort,
    @Inject(OTP_CODES_REPOSITORY) otpCodes: OtpCodesRepository,
    @Inject(SMS_PROVIDER) smsProvider: SmsProviderPort,
    @Inject(RATE_LIMIT_CHECKER) rateLimiter: RateLimitCheckerPort,
    // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` — см. DTJ-001,
    // без него `config` резолвится как `undefined` под тестовым рантаймом.
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {
    this.deps = { clock, ids, otpGenerator, otpCodes, smsProvider, rateLimiter }
  }

  async execute(input: RequestOtpInput): Promise<RequestOtpResult> {
    const phone = parsePhoneOrThrow(input.phone)
    await this.enforceRateLimits(phone.value, input.ipAddress, input.tenantId)
    return this.issueOtp(phone, input.tenantId)
  }

  private async enforceRateLimits(
    phone: string,
    ipAddress: string,
    tenantId: string,
  ): Promise<void> {
    const checks = this.buildRateLimitChecks(phone, ipAddress, tenantId)
    // C14: ключи независимы, гонок быть не может (Redis INCR атомарен).
    const results = await Promise.all(
      checks.map((check) => this.deps.rateLimiter.incrementAndGet(check.key, check.windowSeconds)),
    )
    for (let i = 0; i < checks.length; i += 1) {
      const check = checks[i]
      const result = results[i]
      if (check !== undefined && result !== undefined && result.count > check.max) {
        throw new OtpRequestRateLimitedError(check.scope, result.ttlSeconds, {
          phone,
          ipAddress,
          tenantId,
        })
      }
    }
  }

  private buildRateLimitChecks(
    phone: string,
    ipAddress: string,
    tenantId: string,
  ): readonly RateLimitCheck[] {
    const prefix = this.config.otpRateLimitKeyPrefix
    const SECONDS_PER_10MIN = 10 * TIME_CONSTANTS.SECONDS_PER_MINUTE
    return [
      {
        scope: 'phone_cooldown',
        key: `${prefix}:${tenantId}:cooldown:${phone}`,
        windowSeconds: this.config.otpRequestCooldownSeconds,
        max: 1,
      },
      {
        scope: 'phone_10min',
        key: `${prefix}:${tenantId}:10m:${phone}`,
        windowSeconds: SECONDS_PER_10MIN,
        max: this.config.otpRequestMaxPer10Min,
      },
      {
        scope: 'phone_day',
        key: `${prefix}:${tenantId}:24h:${phone}`,
        windowSeconds: TIME_CONSTANTS.SECONDS_PER_DAY,
        max: this.config.otpRequestMaxPerDay,
      },
      {
        scope: 'ip_hour',
        key: `${prefix}:${tenantId}:ip1h:${ipAddress}`,
        windowSeconds: TIME_CONSTANTS.SECONDS_PER_HOUR,
        max: this.config.otpRequestMaxPerIpPerHour,
      },
    ]
  }

  private async issueOtp(phone: PhoneNumber, tenantId: string): Promise<RequestOtpResult> {
    const otpRequestId = this.deps.ids.next()
    const { code } = this.deps.otpGenerator.generate('login')
    const codeHash = hashCodeWithSalt(code, otpRequestId)
    const otpCode = OtpCode.issue({
      codeHash,
      subjectRef: phone.value,
      clock: this.deps.clock,
      ttlSeconds: OTP_TTL_SECONDS,
    })
    // `id: otpRequestId` — ОБЯЗАТЕЛЬНО тот же id, которым уже посолен `codeHash`
    // выше (см. JSDoc порта `OtpCodesRepository.create`): иначе `VerifyOtpUseCase`
    // не найдёт строку по `otpRequestId`, и любой verify вернёт `OtpMismatchError`.
    await this.deps.otpCodes.create({
      id: otpRequestId,
      tenantId,
      subjectRef: phone.value,
      purpose: 'login',
      codeHash: otpCode.codeHash,
      issuedAt: otpCode.issuedAt,
      expiresAt: otpCode.expiresAt,
    })
    await this.deps.smsProvider.sendOtp(phone, code, 'login' satisfies OtpPurpose)
    return { otpRequestId, expiresInSeconds: OTP_TTL_SECONDS }
  }
}

/**
 * `PhoneNumber.parse` бросает `InvalidPhoneNumberFormatError`; обёртка для
 * type-narrowing. Защита от дрейфа: если когда-нибудь начнёт бросать другое —
 * оборачиваем в `InvalidPhoneNumberFormatError` (400).
 */
function parsePhoneOrThrow(raw: string): PhoneNumber {
  try {
    return PhoneNumber.parse(raw)
  } catch (e: unknown) {
    if (e instanceof InvalidPhoneNumberFormatError) {
      throw e
    }
    throw new InvalidPhoneNumberFormatError({ field: 'phone' })
  }
}

/** sha256(code + ':' + salt) → 64 hex (SRS-API-021, `otpRequestId` — соль). */
function hashCodeWithSalt(code: string, salt: string): string {
  return createHash('sha256').update(`${code}:${salt}`).digest('hex').slice(0, SHA256_HEX_LENGTH)
}
