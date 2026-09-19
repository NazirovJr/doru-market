/**
 * Unit-тест `VerifyOtpUseCase` (EP-01, DTJ-024).
 *
 * Покрывает (тикет DTJ-024 «Тест-план»):
 *   1. Успех с новым пользователем: find-or-create → User(role='customer'), AuthSession, JWT, consumed.
 *   2. Успех с существующим: `findOrCreateByTenantAndPhone` НЕ дублирует users-строку.
 *   3. Истёкший код: `OtpExpiredError`, consumed НЕ помечен, сессия НЕ создана.
 *   4. Неверный код: `OtpMismatchError`, `incrementAttempts` вызван, consumed НЕ помечен.
 *   5. 6-я попытка (5 неверных + 1): `OtpAttemptsExceededError` с каноническим
 *      `ux.error.otp_locked` (DTJ-024 «Критерии приёмки» п.3).
 *   6. Повторный verify уже потреблённого `otpRequestId`: `OtpMismatchError`.
 */
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { OtpAttemptsExceededError, OtpExpiredError, OtpMismatchError } from '@dorutj/contracts'
import { type Clock, type IdGenerator } from '@/shared-kernel/index.js'
import { VerifyOtpUseCase } from './verify-otp.use-case.js'
import type {
  JwtClaims,
  JwtSignerPort,
} from '../ports/jwt-signer.port.js'
import type { CreateUserInput, UsersRepository } from '../ports/users.repository.port.js'
import type {
  CreateOtpCodeInput,
  OtpCodeRecord,
  OtpCodesRepository,
} from '../ports/otp-codes.repository.port.js'
import type {
  AuthSessionsRepository,
  RevokeReason,
  RotateAuthSessionInput,
} from '../ports/auth-sessions.repository.port.js'
import type { RefreshTokenGeneratorPort } from '../ports/refresh-token-generator.port.js'
import type { RateLimitCheckResult, RateLimitCheckerPort } from '../ports/rate-limit-checker.port.js'
import type { UnitOfWorkPort, UnitOfWorkTx } from '../ports/unit-of-work.port.js'
import { type AuthSession } from '@/modules/auth/domain/value-objects/auth-session.vo.js'
import { type User } from '@/modules/auth/domain/user.js'
import { type AppConfigService } from '@/config/app-config.service.js'

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

interface SeedOtpInput {
  readonly id: string
  readonly codeRaw: string
  readonly phone: string
  readonly issuedAt: Date
  readonly expiresAt: Date
  readonly consumedAt: Date | null
}

class StubOtpCodesRepository implements OtpCodesRepository {
  public readonly rows = new Map<string, OtpCodeRecord>()
  public createCalls: CreateOtpCodeInput[] = []
  public markConsumedCalls: { id: string; now: Date }[] = []
  public incrementAttemptsCalls: string[] = []

  create(input: CreateOtpCodeInput): Promise<OtpCodeRecord> {
    this.createCalls.push(input)
    const id = this.createCalls.length === 1 ? 'otp-1' : `otp-${String(this.createCalls.length)}`
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


  findByIdForUpdate(_tx: UnitOfWorkTx, id: string): Promise<OtpCodeRecord | null> {
    return Promise.resolve(this.rows.get(id) ?? null)
  }

   
  markConsumed(_tx: UnitOfWorkTx, id: string, now: Date): Promise<void> {
    this.markConsumedCalls.push({ id, now })
    const row = this.rows.get(id)
    if (row !== undefined) {
      this.rows.set(id, { ...row, consumedAt: now })
    }
    return Promise.resolve()
  }

   
  incrementAttempts(_tx: UnitOfWorkTx, id: string): Promise<void> {
    this.incrementAttemptsCalls.push(id)
    const row = this.rows.get(id)
    if (row !== undefined) {
      this.rows.set(id, { ...row, attempts: row.attempts + 1 })
    }
    return Promise.resolve()
  }

   
  findActiveBySubject(_input: {
    readonly tenantId: string
    readonly subjectRef: string
    readonly purpose: 'login' | 'onboarding_contact'
    readonly now: Date
  }): Promise<OtpCodeRecord | null> {
    return Promise.resolve(null)
  }


  countBySubjectAndPurpose(): Promise<number> {
    return Promise.resolve(0)
  }

  seed(input: SeedOtpInput): void {
    const codeHash = createHash('sha256')
      .update(`${input.codeRaw}:${input.id}`)
      .digest('hex')
      .slice(0, 64)
    this.rows.set(input.id, {
      id: input.id,
      tenantId: TENANT,
      subjectRef: input.phone,
      purpose: 'login',
      codeHash,
      plainCode: null,
      attempts: 0,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
      consumedAt: input.consumedAt,
    })
  }
}

class StubUsersRepository implements UsersRepository {
  public readonly byId = new Map<string, User>()
  public readonly tenantPhoneIndex = new Map<string, string>()
  public createCount = 0

  async findByTenantAndPhone(tenantId: string, phoneNumber: string): Promise<User | null> {
    const id = this.tenantPhoneIndex.get(`${tenantId}|${phoneNumber}`)
    if (id === undefined) return Promise.resolve(null)
    return Promise.resolve(this.byId.get(id) ?? null)
  }

  async findById(id: string): Promise<User | null> {
    return Promise.resolve(this.byId.get(id) ?? null)
  }

  async create(input: CreateUserInput): Promise<User> {
    this.createCount += 1
    const id = `user-${String(this.createCount)}`
    const user: User = {
      id,
      tenantId: input.tenantId,
      phoneNumber: input.phoneNumber,
      role: input.role,
      fullName: input.fullName,
      pharmacyId: null,
      chainId: null,
      telegramChatId: null,
      preferredLocale: 'tj',
      isActive: true,
      createdAt: NOW,
      deletedAt: null,
    }
    this.byId.set(id, user)
    this.tenantPhoneIndex.set(`${input.tenantId}|${String(input.phoneNumber)}`, id)
    return Promise.resolve(user)
  }

  async findActiveByPhone(phoneNumber: string): Promise<User | null> {
    let earliest: User | null = null
    for (const user of this.byId.values()) {
      if (user.deletedAt !== null) continue
      if (user.phoneNumber !== phoneNumber) continue
      if (earliest === null || user.createdAt < earliest.createdAt) {
        earliest = user
      }
    }
    return Promise.resolve(earliest)
  }

  async findOrCreateByTenantAndPhone(input: CreateUserInput): Promise<User> {
    if (input.phoneNumber === null) {
      // Телеграм-путь: phone отсутствует, создаём по `tenantId + null`-ключу.
      return this.create(input)
    }
    const existing = await this.findByTenantAndPhone(input.tenantId, input.phoneNumber)
    if (existing !== null) return existing
    return this.create(input)
  }

  async update(id: string, patch: { fullName: string | null; preferredLocale: string | null; telegramChatId: bigint | null }): Promise<User> {
    const existing = this.byId.get(id)
    if (existing === undefined) throw new Error(`user not found: ${id}`)
    const updated: User = { ...existing, fullName: patch.fullName, preferredLocale: patch.preferredLocale ?? existing.preferredLocale, telegramChatId: patch.telegramChatId }
    this.byId.set(id, updated)
    return Promise.resolve(updated)
  }
}

class StubAuthSessionsRepository implements AuthSessionsRepository {
  public readonly byId = new Map<string, AuthSession>()
  public createCount = 0

  async create(input: {
    id: string; tenantId: string; userId: string; refreshTokenHash: string;
    deviceLabel: string; userAgent: string; ipAddress: string;
    absoluteExpiresAt: Date; createdAt: Date
  }): Promise<AuthSession> {
    this.createCount += 1
    const session = {
      id: input.id,
      tenantId: input.tenantId,
      userId: input.userId,
      familyId: input.id,
      refreshTokenHash: input.refreshTokenHash,
      deviceLabel: input.deviceLabel,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      absoluteExpiresAt: input.absoluteExpiresAt,
      rotatedAt: null,
      revokedAt: null,
      revokeReason: null,
      createdAt: input.createdAt,
    } as unknown as AuthSession
    this.byId.set(session.id, session)
    return Promise.resolve(session)
  }
  async findById(id: string): Promise<AuthSession | null> {
    return Promise.resolve(this.byId.get(id) ?? null)
  }
  async findByRefreshHash(hash: string): Promise<AuthSession | null> {
    for (const s of this.byId.values()) if (s.refreshTokenHash === hash) return Promise.resolve(s)
    return Promise.resolve(null)
  }
  async findActiveByUserId(userId: string, now: Date): Promise<readonly AuthSession[]> {
    const out: AuthSession[] = []
    for (const s of this.byId.values()) {
      if (s.userId === userId && s.revokedAt === null && s.absoluteExpiresAt.getTime() > now.getTime()) {
        out.push(s)
      }
    }
    return Promise.resolve(out)
  }
  // DTJ-025: refresh-rotation use case не используется в тестах DTJ-024,
  // но интерфейс требует реализации. Минимальные noop-стабы, чтобы
  // компиляция прошла — реальная логика покрывается собственными тестами
  // `refresh-token.use-case.spec.ts`.
   
  revokeCurrentAndCreateNext(
    _tx: UnitOfWorkTx,
    _previousId: string,
    _input: RotateAuthSessionInput,
  ): Promise<AuthSession> {
    throw new Error('not used in DTJ-024 tests (see refresh-token.use-case.spec.ts)')
  }
   
  async revokeAllByFamilyId(_input: {
    tx: UnitOfWorkTx
    familyId: string
    reason: RevokeReason
    now: Date
  }): Promise<number> {
    return Promise.resolve(0)
  }
  // DTJ-026: новые методы logout/logout-all/revoke не используются в
  // тестах DTJ-024, noop-стабы для компиляции.

  async revokeOneById(_input: {
    tx: UnitOfWorkTx
    sessionId: string
    reason: RevokeReason
    now: Date
  }): Promise<number> {
    return Promise.resolve(0)
  }

  async revokeAllByUserId(_input: {
    tx: UnitOfWorkTx
    userId: string
    reason: RevokeReason
    now: Date
  }): Promise<number> {
    return Promise.resolve(0)
  }
}

class StubJwtSigner implements JwtSignerPort {
  public lastClaims: JwtClaims | null = null
  sign(claims: JwtClaims): string {
    this.lastClaims = claims
    return `jwt.${claims.sub}.${claims.role}`
  }
  verify(): never {
    throw new Error('not used in tests')
  }
}

class StubRefreshGen implements RefreshTokenGeneratorPort {
  private n = 0
  generate(): { token: string; hash: string } {
    this.n += 1
    return { token: `refresh-${String(this.n)}`, hash: `hash-${String(this.n)}` }
  }
}

class FakeRateLimiter implements RateLimitCheckerPort {
  public readonly state = new Map<string, { count: number; ttlSeconds: number }>()
  incrementAndGet(key: string, windowSeconds: number): Promise<RateLimitCheckResult> {
    const existing = this.state.get(key)
    if (existing === undefined) {
      const fresh = { count: 1, ttlSeconds: windowSeconds }
      this.state.set(key, fresh)
      return Promise.resolve(fresh)
    }
    existing.count += 1
    return Promise.resolve({ count: existing.count, ttlSeconds: existing.ttlSeconds })
  }
}

class NoopUnitOfWork implements UnitOfWorkPort {
  async run<T>(callback: Parameters<UnitOfWorkPort['run']>[0]): Promise<T> {
     
    return (callback as (tx: UnitOfWorkTx) => Promise<T>)(null)
  }
}

interface VerifyOtpConfig {
  isProduction: boolean
  mockSmsExposeCodeInResponse: boolean
  otpRequestCooldownSeconds: number
  otpRequestMaxPer10Min: number
  otpRequestMaxPerDay: number
  otpRequestMaxPerIpPerHour: number
  otpRateLimitKeyPrefix: string
  otpVerifyMaxAttempts: number
}

class StubConfig implements VerifyOtpConfig {
  isProduction = false
  mockSmsExposeCodeInResponse = false
  otpRequestCooldownSeconds = 60
  otpRequestMaxPer10Min = 3
  otpRequestMaxPerDay = 10
  otpRequestMaxPerIpPerHour = 20
  otpRateLimitKeyPrefix = 'otp_rl_test'
  otpVerifyMaxAttempts = 5
}

const PHONE = '+992917123456'
const TENANT = 'neutral'
const IP = '10.0.0.1'
const UA = 'DoruTJ/1.0'
const DEVICE_LABEL = 'mobile-app'
const NOW = new Date('2026-08-28T10:00:00.000Z')
const LATER = new Date('2026-08-28T10:01:00.000Z') // 60s later, still in TTL
// `expiresAt` строки OTP, которая УЖЕ в прошлом относительно `FixedClock(NOW)`
// (`isExpired` сравнивает `clock.now() > expiresAt`) — тест проверяет "код
// просрочен НА МОМЕНТ verify", а не "проживёт ещё 5 минут". Раньше здесь
// стояло время ПОСЛЕ `NOW` (`10:10` > `NOW=10:00`), из-за чего `isExpired`
// всегда был `false`, и кейс 3 ошибочно проходил "успешную" ветку.
const EXPIRED = new Date('2026-08-28T09:50:00.000Z') // 10 min до NOW — просрочен

interface Bundle {
  useCase: VerifyOtpUseCase
  otpCodes: StubOtpCodesRepository
  users: StubUsersRepository
  authSessions: StubAuthSessionsRepository
  jwt: StubJwtSigner
  rateLimiter: FakeRateLimiter
}

function buildUseCase(): Bundle {
  const otpCodes = new StubOtpCodesRepository()
  const users = new StubUsersRepository()
  const authSessions = new StubAuthSessionsRepository()
  const jwt = new StubJwtSigner()
  const rateLimiter = new FakeRateLimiter()
  const uow = new NoopUnitOfWork()
  const config = new StubConfig()
  const useCase = new VerifyOtpUseCase(
    new FixedClock(NOW),
    new SequentialIds(),
    users,
    otpCodes,
    authSessions,
    jwt,
    new StubRefreshGen(),
    rateLimiter,
    uow,
    config as unknown as AppConfigService,
  )
  return { useCase, otpCodes, users, authSessions, jwt, rateLimiter }
}

function seedActive(
  otpCodes: StubOtpCodesRepository,
  input: { id: string; code: string; expiresAt: Date; consumedAt?: Date | null },
): void {
  otpCodes.seed({
    id: input.id,
    codeRaw: input.code,
    phone: PHONE,
    issuedAt: NOW,
    expiresAt: input.expiresAt,
    consumedAt: input.consumedAt ?? null,
  })
}

describe('VerifyOtpUseCase (DTJ-024, SRS-API-021..025)', () => {
  let bundle: Bundle
  beforeEach(() => {
    bundle = buildUseCase()
  })

  it('1. успех с новым пользователем: find-or-create → user(role=customer), session, JWT, consumed', async () => {
    seedActive(bundle.otpCodes, { id: 'otp-1', code: '123456', expiresAt: LATER })
    const result = await bundle.useCase.execute({
      otpRequestId: 'otp-1',
      code: '123456',
      tenantId: TENANT,
      deviceLabel: DEVICE_LABEL,
      userAgent: UA,
      ipAddress: IP,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const value = result.value
    expect(value.accessToken).toBe('jwt.user-1.customer')
    expect(value.refreshToken).toBe('refresh-1')
    expect(value.user.role).toBe('customer')
    expect(value.user.phoneNumber).toBe(PHONE)
    expect(bundle.users.createCount).toBe(1)
    expect(bundle.authSessions.createCount).toBe(1)
    expect(bundle.otpCodes.markConsumedCalls).toEqual([{ id: 'otp-1', now: NOW }])
    expect(bundle.jwt.lastClaims?.sessionId).toMatch(/^id-\d+$/)
    expect(bundle.jwt.lastClaims?.role).toBe('customer')
  })

  it('2. успех с существующим пользователем: users.create НЕ вызван повторно', async () => {
    seedActive(bundle.otpCodes, { id: 'otp-1', code: '111111', expiresAt: LATER })
    // первый verify
    const r1 = await bundle.useCase.execute({
      otpRequestId: 'otp-1', code: '111111', tenantId: TENANT,
      deviceLabel: DEVICE_LABEL, userAgent: UA, ipAddress: IP,
    })
    expect(r1.ok).toBe(true)
    expect(bundle.users.createCount).toBe(1)
    // consumed = true; повторный verify → mismatch (кейс 6, проверим ниже)
    // для кейса 2: выдаём НОВЫЙ otpRequestId, тот же phone
    seedActive(bundle.otpCodes, { id: 'otp-2', code: '222222', expiresAt: LATER })
    const r2 = await bundle.useCase.execute({
      otpRequestId: 'otp-2', code: '222222', tenantId: TENANT,
      deviceLabel: DEVICE_LABEL, userAgent: UA, ipAddress: IP,
    })
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    expect(bundle.users.createCount).toBe(1) // НЕ вырос
    expect(r2.value.user.id).toBe('user-1') // тот же user
  })

  it('3. истёкший код → OtpExpiredError, сессия НЕ создана, consumed НЕ помечен', async () => {
    seedActive(bundle.otpCodes, { id: 'otp-1', code: '123456', expiresAt: EXPIRED })
    const result = await bundle.useCase.execute({
      otpRequestId: 'otp-1', code: '123456', tenantId: TENANT,
      deviceLabel: DEVICE_LABEL, userAgent: UA, ipAddress: IP,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBeInstanceOf(OtpExpiredError)
    expect(bundle.authSessions.createCount).toBe(0)
    expect(bundle.otpCodes.markConsumedCalls).toEqual([])
    expect(bundle.otpCodes.incrementAttemptsCalls).toContain('otp-1')
  })

  it('4. неверный код → OtpMismatchError, incrementAttempts вызван', async () => {
    seedActive(bundle.otpCodes, { id: 'otp-1', code: '123456', expiresAt: LATER })
    const result = await bundle.useCase.execute({
      otpRequestId: 'otp-1', code: '999999', tenantId: TENANT,
      deviceLabel: DEVICE_LABEL, userAgent: UA, ipAddress: IP,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBeInstanceOf(OtpMismatchError)
    expect(bundle.otpCodes.incrementAttemptsCalls).toEqual(['otp-1'])
    expect(bundle.authSessions.createCount).toBe(0)
    expect(bundle.otpCodes.markConsumedCalls).toEqual([])
  })

  it('5. 6-я подряд попытка → OtpAttemptsExceededError с каноническим ux.error.otp_locked', async () => {
    seedActive(bundle.otpCodes, { id: 'otp-1', code: '123456', expiresAt: LATER })
    // 5 неверных + 1 (любая, даже верная) — на 6-й блокировка
    for (let i = 0; i < 5; i += 1) {
      const r = await bundle.useCase.execute({
        otpRequestId: 'otp-1', code: '000000', tenantId: TENANT,
        deviceLabel: DEVICE_LABEL, userAgent: UA, ipAddress: IP,
      })
      expect(r.ok).toBe(false)
    }
    // 6-я попытка с ВЕРНЫМ кодом — всё равно blocked
    const sixth = await bundle.useCase.execute({
      otpRequestId: 'otp-1', code: '123456', tenantId: TENANT,
      deviceLabel: DEVICE_LABEL, userAgent: UA, ipAddress: IP,
    })
    expect(sixth.ok).toBe(false)
    if (sixth.ok) return
    expect(sixth.error).toBeInstanceOf(OtpAttemptsExceededError)
    const err = sixth.error as OtpAttemptsExceededError & { message: string }
    // Канонический текст из packages/i18n: ux.error.otp_locked.
    // (Не локализуем под язык теста — ru-фолбэк в use case, DoD п.4)
    expect(err.message).toContain('Слишком много неверных попыток')
    // Сессия НЕ создана
    expect(bundle.authSessions.createCount).toBe(0)
  })

  it('6. повторный verify потреблённого otpRequestId → OtpMismatchError', async () => {
    seedActive(bundle.otpCodes, { id: 'otp-1', code: '123456', expiresAt: LATER })
    const r1 = await bundle.useCase.execute({
      otpRequestId: 'otp-1', code: '123456', tenantId: TENANT,
      deviceLabel: DEVICE_LABEL, userAgent: UA, ipAddress: IP,
    })
    expect(r1.ok).toBe(true)
    // теперь consumed=true; тот же otpRequestId, тот же (даже верный!) код → mismatch
    const r2 = await bundle.useCase.execute({
      otpRequestId: 'otp-1', code: '123456', tenantId: TENANT,
      deviceLabel: DEVICE_LABEL, userAgent: UA, ipAddress: IP,
    })
    expect(r2.ok).toBe(false)
    if (r2.ok) return
    expect(r2.error).toBeInstanceOf(OtpMismatchError)
  })
})
