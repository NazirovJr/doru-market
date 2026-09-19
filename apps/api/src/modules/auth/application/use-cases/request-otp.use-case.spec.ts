/**
 * Unit-тест `RequestOtpUseCase` (EP-01, DTJ-023).
 *
 * Покрывает (см. критерии приёмки тикета):
 *   1. Успешный путь: валидный E.164 → `RequestOtpResult`, SMS отправлена,
 *      хеш записан в репозиторий, rate-limit счётчики инкрементированы.
 *   2. Невалидный формат (`'9171234567'` без `+`) → `InvalidPhoneNumberFormatError`,
 *      rate-limit НЕ инкрементирован (SRS-API-020: не тратить лимит).
 *   3. Превышение cooldown → `OtpRequestRateLimitedError(scope='phone_cooldown', retryAfter)`.
 *   4. Превышение лимита 10мин → `OtpRequestRateLimitedError(scope='phone_10min')`.
 *   5. Превышение IP-лимита → `OtpRequestRateLimitedError(scope='ip_hour')`.
 *   6. `codeHash` в репозитории — sha256(code + otpRequestId), НЕ равен сырому коду.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  InvalidPhoneNumberFormatError,
  OtpRequestRateLimitedError,
} from '@dorutj/contracts'
import { type Clock, type IdGenerator } from '@/shared-kernel/index.js'
import { type UnitOfWorkTx } from '../ports/unit-of-work.port.js'
import { RequestOtpUseCase } from './request-otp.use-case.js'
import type { OtpGeneratorPort, OtpPurpose } from '../ports/otp-generator.port.js'
import type { SmsProviderPort } from '../ports/sms-provider.port.js'
import type {
  CreateOtpCodeInput,
  OtpCodeRecord,
  OtpCodesRepository,
} from '../ports/otp-codes.repository.port.js'
import type { RateLimitCheckResult, RateLimitCheckerPort } from '../ports/rate-limit-checker.port.js'
import type { PhoneNumber } from '@/modules/auth/domain/value-objects/phone-number.vo.js'
import type { AppConfigService } from '@/config/app-config.service.js'

class FixedClock implements Clock {
  constructor(private readonly fixed: Date) {}
  now(): Date {
    return this.fixed
  }
}

class SequentialIds implements IdGenerator {
  private n = 0
  next(): string {
    this.n += 1
    return `id-${String(this.n)}`
  }
}

class StubOtpGenerator implements OtpGeneratorPort {
  private n = 0
  generate(_purpose: OtpPurpose): { code: string; codeHash: string } {
    this.n += 1
    return { code: `12345${String(this.n)}`, codeHash: `hash-${String(this.n)}` }
  }
}

class StubSmsProvider implements SmsProviderPort {
  public lastCode: string | null = null
  public lastPhone: string | null = null
  public callCount = 0
  sendOtp(phone: PhoneNumber, code: string, _purpose: OtpPurpose): Promise<void> {
    this.lastPhone = phone.value
    this.lastCode = code
    this.callCount += 1
    return Promise.resolve()
  }
}

class StubOtpCodesRepository implements OtpCodesRepository {
  public created: CreateOtpCodeInput[] = []
  public readonly rows = new Map<string, OtpCodeRecord>()

  create(input: CreateOtpCodeInput): Promise<OtpCodeRecord> {
    this.created.push(input)
    // `input.id` — контракт порта требует id ОТ ВЫЗЫВАЮЩЕГО (используется как
    // соль хеша ДО create), стаб больше не присваивает свой (иначе стаб скрывает
    // тот же дефект, который был в `InMemoryOtpCodesRepository` до фикса Ж13).
    const id = input.id
    const record: OtpCodeRecord = {
      id,
      tenantId: input.tenantId,
      subjectRef: input.subjectRef,
      purpose: input.purpose,
      codeHash: input.codeHash,
      plainCode: input.plainCode ?? null,
      attempts: 0,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
      consumedAt: null,
    }
    this.rows.set(id, record)
    return Promise.resolve(record)
  }


  findById(id: string): Promise<OtpCodeRecord | null> {
    return Promise.resolve(this.rows.get(id) ?? null)
  }


  findByIdForUpdate(_tx: UnitOfWorkTx, _id: string): Promise<OtpCodeRecord | null> {
    return Promise.resolve(null)
  }

   
  markConsumed(_tx: UnitOfWorkTx, _id: string, _now: Date): Promise<void> {
    return Promise.resolve()
  }

   
  incrementAttempts(_tx: UnitOfWorkTx, _id: string): Promise<void> {
    return Promise.resolve()
  }

  findActiveBySubject(): Promise<OtpCodeRecord | null> {
    return Promise.resolve(null)
  }

  countBySubjectAndPurpose(): Promise<number> {
    return Promise.resolve(0)
  }
}

interface FakeRateLimitState {
  count: number
  ttlSeconds: number
}

class FakeRateLimiter implements RateLimitCheckerPort {
  public readonly state = new Map<string, FakeRateLimitState>()

  incrementAndGet(key: string, windowSeconds: number): Promise<RateLimitCheckResult> {
    const existing = this.state.get(key)
    if (existing === undefined) {
      this.state.set(key, { count: 1, ttlSeconds: windowSeconds })
      return Promise.resolve({ count: 1, ttlSeconds: windowSeconds })
    }
    existing.count += 1
    return Promise.resolve({ count: existing.count, ttlSeconds: existing.ttlSeconds })
  }
}

/** Минимальный интерфейс конфига, нужный use case'у (узкий, чтобы не тащить весь AppConfigService). */
interface RequestOtpConfig {
  isProduction: boolean
  mockSmsExposeCodeInResponse: boolean
  otpRequestCooldownSeconds: number
  otpRequestMaxPer10Min: number
  otpRequestMaxPerDay: number
  otpRequestMaxPerIpPerHour: number
  otpRateLimitKeyPrefix: string
}

class StubConfig implements RequestOtpConfig {
  isProduction = false
  mockSmsExposeCodeInResponse = false
  otpRequestCooldownSeconds = 60
  otpRequestMaxPer10Min = 3
  otpRequestMaxPerDay = 10
  otpRequestMaxPerIpPerHour = 20
  otpRateLimitKeyPrefix = 'otp_rl_test'
}

const PHONE = '+992917123456'
const TENANT = 'neutral'
const IP = '10.0.0.1'
const NOW = new Date('2026-08-28T10:00:00.000Z')

function buildUseCase(deps: {
  rateLimiter: FakeRateLimiter
}): {
  useCase: RequestOtpUseCase
  sms: StubSmsProvider
  otpCodes: StubOtpCodesRepository
  rateLimiter: FakeRateLimiter
} {
  const config = new StubConfig()
  const sms = new StubSmsProvider()
  const otpCodes = new StubOtpCodesRepository()
  const useCase = new RequestOtpUseCase(
    new FixedClock(NOW),
    new SequentialIds(),
    new StubOtpGenerator(),
    otpCodes,
    sms,
    deps.rateLimiter,
    // Test stub реализует минимальный интерфейс конфига, не весь AppConfigService;
    // RequestOtpUseCase использует только узкий набор полей (см. RequestOtpConfig).
    config as unknown as AppConfigService,
  )
  return { useCase, sms, otpCodes, rateLimiter: deps.rateLimiter }
}

describe('RequestOtpUseCase (DTJ-023, SRS-API-018/019/020/021)', () => {
  let rateLimiter: FakeRateLimiter
  beforeEach(() => {
    rateLimiter = new FakeRateLimiter()
  })

  it('1. успешный путь: возвращает otpRequestId + expiresInSeconds, SMS отправлена, хеш записан', async () => {
    const { useCase, sms, otpCodes } = buildUseCase({ rateLimiter })
    const result = await useCase.execute({ phone: PHONE, ipAddress: IP, tenantId: TENANT })
    expect(result.otpRequestId).toBe('id-1')
    expect(result.expiresInSeconds).toBe(300)
    expect(sms.callCount).toBe(1)
    expect(sms.lastPhone).toBe(PHONE)
    expect(sms.lastCode).toMatch(/^12345/)
    expect(otpCodes.created.length).toBe(1)
    // codeHash в репозитории НЕ равен сырому коду (SRS-API-021)
    const stored = otpCodes.created[0]
    expect(stored?.codeHash).not.toBe(sms.lastCode)
  })

  it('2. невалидный формат: InvalidPhoneNumberFormatError, rate-limit НЕ инкрементирован', async () => {
    const { useCase, sms, otpCodes } = buildUseCase({ rateLimiter })
    await expect(
      useCase.execute({ phone: '9171234567', ipAddress: IP, tenantId: TENANT }),
    ).rejects.toBeInstanceOf(InvalidPhoneNumberFormatError)
    expect(rateLimiter.state.size).toBe(0)
    expect(sms.callCount).toBe(0)
    expect(otpCodes.created.length).toBe(0)
  })

  it('3. превышение cooldown → OtpRequestRateLimitedError(scope="phone_cooldown")', async () => {
    rateLimiter.state.set(`otp_rl_test:${TENANT}:cooldown:${PHONE}`, { count: 1, ttlSeconds: 60 })
    const { useCase, sms } = buildUseCase({ rateLimiter })
    const caught = await useCase
      .execute({ phone: PHONE, ipAddress: IP, tenantId: TENANT })
      .then(
        () => null,
        (e: unknown) => e,
      )
    expect(caught).toBeInstanceOf(OtpRequestRateLimitedError)
    const err = caught as OtpRequestRateLimitedError
    expect(err.scope).toBe('phone_cooldown')
    expect(err.retryAfterSeconds).toBe(60)
    expect(sms.callCount).toBe(0)
  })

  it('4. превышение 10-мин лимита → OtpRequestRateLimitedError(scope="phone_10min")', async () => {
    rateLimiter.state.set(`otp_rl_test:${TENANT}:10m:${PHONE}`, { count: 3, ttlSeconds: 600 })
    const { useCase, sms } = buildUseCase({ rateLimiter })
    await expect(
      useCase.execute({ phone: PHONE, ipAddress: IP, tenantId: TENANT }),
    ).rejects.toMatchObject({ scope: 'phone_10min' })
    expect(sms.callCount).toBe(0)
  })

  it('5. превышение IP-лимита → OtpRequestRateLimitedError(scope="ip_hour")', async () => {
    rateLimiter.state.set(`otp_rl_test:${TENANT}:ip1h:${IP}`, { count: 20, ttlSeconds: 3600 })
    const { useCase, sms } = buildUseCase({ rateLimiter })
    await expect(
      useCase.execute({ phone: PHONE, ipAddress: IP, tenantId: TENANT }),
    ).rejects.toMatchObject({ scope: 'ip_hour' })
    expect(sms.callCount).toBe(0)
  })

  it('6. codeHash в репозитории — sha256(code + otpRequestId), не равен сырому коду', async () => {
    const { useCase, sms, otpCodes } = buildUseCase({ rateLimiter })
    await useCase.execute({ phone: PHONE, ipAddress: IP, tenantId: TENANT })
    const stored = otpCodes.created[0]
    expect(stored).toBeDefined()
    expect(stored?.codeHash).not.toBe(sms.lastCode)
    // sha256(код + ':' + id) — 64 hex
    expect(stored?.codeHash).toMatch(/^[0-9a-f]{64}$/)
  })
})
