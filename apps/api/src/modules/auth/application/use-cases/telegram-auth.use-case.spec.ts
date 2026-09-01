/**
 * Unit-тест `TelegramAuthUseCase` (EP-01, DTJ-027, SRS-API-031 шаги 9-10).
 *
 * Покрывает:
 *   1. Новый Telegram-пользователь → User создаётся с `phoneNumber: null`,
 *      identity-link создан, выдана пара токенов.
 *   2. Повторный вход существующего Telegram-пользователя (тот же
 *      `telegramUserId`) → User НЕ пересоздаётся, identity-link уже есть,
 *      выдаётся НОВАЯ пара токенов (новая `auth_sessions`-запись).
 *   3. Версификация initData провалилась → error пробрасывается без
 *      side-effects (User НЕ создаётся).
 *   4. `TELEGRAM_BOT_TOKEN_NEUTRAL` ENV пустой → TelegramBotNotConfiguredError.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  InvalidTelegramInitDataError,
  TelegramBotNotConfiguredError,
  type UserRole,
} from '@dorutj/contracts'
import { isErr, isOk } from '@dorutj/domain-kernel'
import { type AppConfigService } from '@/config/app-config.service.js'
import { type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { type User } from '@/modules/auth/domain/user.js'
import {
  type Clock,
  type IdGenerator,
} from '@/shared-kernel/index.js'
import {
  type TelegramInitDataVerified,
  type TelegramInitDataVerifierPort,
} from '../ports/telegram-init-data-verifier.port.js'
import {
  type CreateUserInput,
  type UpdateUserPatch,
  type UsersRepository,
} from '../ports/users.repository.port.js'
import {
  type AuthSessionsRepository,
  type CreateAuthSessionInput,
  type RevokeReason,
  type RotateAuthSessionInput,
} from '../ports/auth-sessions.repository.port.js'
import {
  type JwtClaims,
  JwtVerificationError,
  type JwtSignerPort,
} from '../ports/jwt-signer.port.js'
import {
  type RefreshTokenGeneratorPort,
} from '../ports/refresh-token-generator.port.js'
import {
  type UnitOfWorkPort,
} from '../ports/unit-of-work.port.js'
import {
  type CreateUserTelegramIdentityInput,
  type UserTelegramIdentitiesRepository,
  type UserTelegramIdentity,
} from '../ports/user-telegram-identities.repository.port.js'
import { TelegramAuthUseCase } from './telegram-auth.use-case.js'

// ==================== Stubs ====================

class StubClock implements Clock {
  now(): Date {
    return new Date('2026-08-28T10:00:00.000Z')
  }
}

class StubIds implements IdGenerator {
  private counter = 0
  next(): string {
    this.counter += 1
    return `00000000-0000-7000-8000-${String(this.counter).padStart(12, '0')}`
  }
}

class StubUsersRepository implements UsersRepository {
  public readonly byId = new Map<string, User>()

  async findById(id: string): Promise<User | null> {
    return Promise.resolve(this.byId.get(id) ?? null)
  }
   
  async findByTenantAndPhone(_t: string, _p: string): Promise<User | null> {
    throw new Error('not used')
  }
   
  async create(input: CreateUserInput): Promise<User> {
    const id = `user-${this.byId.size + 1}`
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
      createdAt: new Date(),
      deletedAt: null,
    }
    this.byId.set(id, user)
    return Promise.resolve(user)
  }
   
  async findOrCreateByTenantAndPhone(_i: CreateUserInput): Promise<User> {
    throw new Error('not used in Telegram path')
  }
   
  async update(_id: string, _patch: UpdateUserPatch): Promise<User> {
    throw new Error('not used')
  }
}

class StubTelegramIdentitiesRepository implements UserTelegramIdentitiesRepository {
  public readonly byTenantTelegram = new Map<string, UserTelegramIdentity>()
  public createCalls: CreateUserTelegramIdentityInput[] = []

  private key(tenantId: string, telegramUserId: bigint): string {
    return `${tenantId}|${telegramUserId.toString()}`
  }
   
  async findByTenantAndTelegramId(
    tenantId: string,
    telegramUserId: bigint,
    _tx?: DrizzleDb,
  ): Promise<UserTelegramIdentity | null> {
    return Promise.resolve(this.byTenantTelegram.get(this.key(tenantId, telegramUserId)) ?? null)
  }
   
  async create(
    input: CreateUserTelegramIdentityInput,
    _tx?: DrizzleDb,
  ): Promise<UserTelegramIdentity> {
    this.createCalls.push(input)
    const identity: UserTelegramIdentity = { id: `tid-${this.createCalls.length}`, ...input }
    this.byTenantTelegram.set(this.key(input.tenantId, input.telegramUserId), identity)
    return Promise.resolve(identity)
  }
}

class StubAuthSessionsRepository implements AuthSessionsRepository {
  public readonly sessions = new Map<string, { userId: string; deviceLabel: string }>()
  public createCalls: CreateAuthSessionInput[] = []

   
  async create(input: CreateAuthSessionInput): Promise<never> {
    this.createCalls.push(input)
    this.sessions.set(input.id, { userId: input.userId, deviceLabel: input.deviceLabel })
    // Возвращаем fake AuthSession, но только для type-satisfaction; use case
    // использует `session.id` уже из input, так что это OK.
    return {} as never
  }
   
  async findById(_id: string): Promise<never> {
    throw new Error('not used')
  }
   
  async findByRefreshHash(_h: string): Promise<never> {
    throw new Error('not used')
  }
   
  async findActiveByUserId(_u: string, _n: Date): Promise<readonly never[]> {
    return []
  }
   
  async revokeCurrentAndCreateNext(
    _tx: DrizzleDb,
    _p: string,
    _i: RotateAuthSessionInput,
  ): Promise<never> {
    throw new Error('not used')
  }
   
  async revokeAllByFamilyId(
    _tx: DrizzleDb,
    _f: string,
    _r: RevokeReason,
    _n: Date,
  ): Promise<number> {
    return 0
  }
   
  async revokeOneById(
    _tx: DrizzleDb,
    _s: string,
    _r: RevokeReason,
    _n: Date,
  ): Promise<number> {
    return 0
  }
   
  async revokeAllByUserId(
    _tx: DrizzleDb,
    _u: string,
    _r: RevokeReason,
    _n: Date,
  ): Promise<number> {
    return 0
  }
}

class StubJwtSigner implements JwtSignerPort {
   
  sign(claims: JwtClaims): string {
    return `jwt.${claims.sub}.${claims.sessionId}`
  }
  verify(_token: string): { readonly ok: true; readonly value: JwtClaims } | { readonly ok: false; readonly error: JwtVerificationError } {
    return { ok: false, error: new JwtVerificationError('TOKEN_INVALID', 'stub does not verify') }
  }
}

class StubRefreshGen implements RefreshTokenGeneratorPort {
  public counter = 0
  generate(): { token: string; hash: string } {
    this.counter += 1
    return { token: `refresh-token-${this.counter}`, hash: `hash-${this.counter}` }
  }
}

class StubUnitOfWork implements UnitOfWorkPort {
  async run<T>(callback: Parameters<UnitOfWorkPort['run']>[0]): Promise<T> {
     
    return (callback as (tx: DrizzleDb) => Promise<T>)(null as unknown as DrizzleDb)
  }
}

class StubVerifier implements TelegramInitDataVerifierPort {
  public nextResult: TelegramInitDataVerified | null = null
  public nextError: Error | null = null
  async verify(): Promise<TelegramInitDataVerified> {
    if (this.nextError !== null) throw this.nextError
    if (this.nextResult === null) throw new Error('no nextResult set')
    return this.nextResult
  }
}

class StubConfig implements Pick<AppConfigService, 'telegramBotTokenNeutral' | 'telegramInitDataMaxAgeSeconds'> {
  constructor(
    public telegramBotTokenNeutral: string | undefined,
    public telegramInitDataMaxAgeSeconds = 300,
  ) {}
}

// ==================== Test 1: новый Telegram user ====================

describe('TelegramAuthUseCase (DTJ-027, SRS-API-031 шаги 9-10)', () => {
  let users: StubUsersRepository
  let identities: StubTelegramIdentitiesRepository
  let sessions: StubAuthSessionsRepository
  let verifier: StubVerifier
  let config: StubConfig
  let useCase: TelegramAuthUseCase

  beforeEach(() => {
    users = new StubUsersRepository()
    identities = new StubTelegramIdentitiesRepository()
    sessions = new StubAuthSessionsRepository()
    verifier = new StubVerifier()
    config = new StubConfig('test-bot-token')
    useCase = new TelegramAuthUseCase(
      new StubClock(),
      new StubIds(),
      users,
      identities,
      sessions,
      new StubJwtSigner(),
      new StubRefreshGen(),
      verifier,
      new StubUnitOfWork(),
      config as unknown as AppConfigService,
    )
  })

  it('1.1 новый Telegram-пользователь: User с phoneNumber=null + identity + tokens', async () => {
    verifier.nextResult = {
      telegramUserId: '111',
      authDate: new Date(),
      user: { id: '111', firstName: 'Иван', lastName: null, username: null, languageCode: 'ru' },
    }
    const result = await useCase.execute({
      initData: 'fake',
      ipAddress: '1.2.3.4',
      userAgent: 'TWA',
    })
    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return
    expect(result.value.user.phoneNumber).toBeNull()
    expect(result.value.user.fullName).toBe('Иван')
    expect(result.value.user.role).toBe('customer' satisfies UserRole)
    expect(result.value.accessToken).toContain('jwt.')
    expect(result.value.refreshToken).toBe('refresh-token-1')
    // identity created
    expect(identities.createCalls).toHaveLength(1)
    expect(identities.createCalls[0]?.telegramUserId).toBe(BigInt(111))
    // session created
    expect(sessions.createCalls).toHaveLength(1)
    expect(sessions.createCalls[0]?.deviceLabel).toBe('telegram_twa')
    // response telegram block
    expect(result.value.telegram.telegramUserId).toBe('111')
  })

  it('1.2 новый user с lastName: fullName = "firstName lastName"', async () => {
    verifier.nextResult = {
      telegramUserId: '111',
      authDate: new Date(),
      user: { id: '111', firstName: 'Иван', lastName: 'Иванов', username: null, languageCode: 'ru' },
    }
    const result = await useCase.execute({ initData: 'fake', ipAddress: '1.2.3.4', userAgent: 'TWA' })
    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return
    expect(result.value.user.fullName).toBe('Иван Иванов')
  })

  it('2. повторный вход существующего Telegram user: User НЕ пересоздаётся, новая сессия', async () => {
    // Сначала — первый вход.
    verifier.nextResult = {
      telegramUserId: '222',
      authDate: new Date(),
      user: { id: '222', firstName: 'А', lastName: null, username: null, languageCode: null },
    }
    await useCase.execute({ initData: 'fake', ipAddress: '1.2.3.4', userAgent: 'TWA' })
    const firstUserId = users.byId.values().next().value?.id
    expect(identities.createCalls).toHaveLength(1)
    expect(sessions.createCalls).toHaveLength(1)

    // Повторный вход.
    verifier.nextResult = {
      telegramUserId: '222',
      authDate: new Date(),
      user: { id: '222', firstName: 'А', lastName: null, username: null, languageCode: null },
    }
    const result2 = await useCase.execute({ initData: 'fake2', ipAddress: '1.2.3.4', userAgent: 'TWA' })
    expect(isOk(result2)).toBe(true)
    if (!isOk(result2)) return
    // User не пересоздан — тот же id
    expect(result2.value.user.id).toBe(firstUserId)
    // Identity не дублирована
    expect(identities.createCalls).toHaveLength(1)
    // Новая auth_sessions-запись
    expect(sessions.createCalls).toHaveLength(2)
    expect(sessions.createCalls[1]?.id).not.toBe(sessions.createCalls[0]?.id)
  })

  it('3. verify() провалился → error, User НЕ создаётся', async () => {
    verifier.nextError = new InvalidTelegramInitDataError()
    const result = await useCase.execute({ initData: 'fake', ipAddress: '1.2.3.4', userAgent: 'TWA' })
    expect(isErr(result)).toBe(true)
    if (isOk(result)) throw new Error('expected err result')
    expect(result.error).toBeInstanceOf(InvalidTelegramInitDataError)
    expect(users.byId.size).toBe(0)
    expect(identities.createCalls).toHaveLength(0)
    expect(sessions.createCalls).toHaveLength(0)
  })

  it('4. TELEGRAM_BOT_TOKEN_NEUTRAL пустой → TelegramBotNotConfiguredError', async () => {
    config.telegramBotTokenNeutral = undefined
    const result = await useCase.execute({ initData: 'fake', ipAddress: '1.2.3.4', userAgent: 'TWA' })
    expect(isErr(result)).toBe(true)
    if (isOk(result)) throw new Error('expected err result')
    expect(result.error).toBeInstanceOf(TelegramBotNotConfiguredError)
  })

  it('5. TELEGRAM_BOT_TOKEN_NEUTRAL = "" → TelegramBotNotConfiguredError (защита от пустого ENV)', async () => {
    config.telegramBotTokenNeutral = ''
    const result = await useCase.execute({ initData: 'fake', ipAddress: '1.2.3.4', userAgent: 'TWA' })
    expect(isErr(result)).toBe(true)
    if (isOk(result)) throw new Error('expected err result')
    expect(result.error).toBeInstanceOf(TelegramBotNotConfiguredError)
  })

  it('6. verify() НЕ вызывается, если botToken не настроен (pre-check)', async () => {
    config.telegramBotTokenNeutral = undefined
    let verifierCalled = false
    const originalVerify = verifier.verify.bind(verifier)
    verifier.verify = async () => {
      verifierCalled = true
      return originalVerify()
    }
    await useCase.execute({ initData: 'fake', ipAddress: '1.2.3.4', userAgent: 'TWA' })
    expect(verifierCalled).toBe(false)
  })
})
