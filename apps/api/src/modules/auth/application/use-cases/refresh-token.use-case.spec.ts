/**
 * Unit-тест `RefreshTokenUseCase` (EP-01, DTJ-025, SRS-API-026/027/028).
 *
 * Покрывает (тикет DTJ-025 «Тест-план» + «Критерии приёмки»):
 *   1. Успешная ротация: новая пара, `familyId` сохранён,
 *      `absoluteExpiresAt` НЕ продлён (приёмка №1).
 *   2. Reuse detection: предъявлен уже-ротированный токен →
 *      `RefreshTokenReuseDetectedError` + `pino.warn` + ВСЯ family
 *      отозвана (SRS-API-027).
 *   3. Уже отозван (logout / предыдущий reuse) → `RefreshTokenInvalidError`,
 *      НЕ повторный reuse-алерт (DTJ-025 §2.4).
 *   4. Истёкший по `absoluteExpiresAt` → `RefreshTokenInvalidError` (НЕ
 *      `REUSE_DETECTED` даже если `rotated_at` тоже заполнен — приёмка №3,
 *      DTJ-025 «Риски»).
 *   5. Не найден по hash → `RefreshTokenInvalidError` (без раскрытия причины,
 *      SRS-API-028).
 *   6. После успешной ротации 3 раз подряд (тест-план п.2): каждый
 *      следующий токен работает, предъявление 1-го после 3-й ротации
 *      триггерит reuse detection.
 */
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  RefreshTokenInvalidError,
  RefreshTokenReuseDetectedError,
  type UserRole,
} from '@dorutj/contracts'
import { type Logger } from 'pino'
import { RefreshTokenUseCase } from './refresh-token.use-case.js'
import type {
  AuthSessionsRepository,
  RevokeReason,
  RotateAuthSessionInput,
} from '../ports/auth-sessions.repository.port.js'
import type { CreateUserInput, UsersListPage, UsersListQuery, UsersRepository } from '../ports/users.repository.port.js'
import type { JwtClaims, JwtSignerPort } from '../ports/jwt-signer.port.js'
import type { RefreshTokenGeneratorPort } from '../ports/refresh-token-generator.port.js'
import type { UnitOfWorkPort, UnitOfWorkTx } from '../ports/unit-of-work.port.js'
import { AuthSession } from '@/modules/auth/domain/value-objects/auth-session.vo.js'
import { type User } from '@/modules/auth/domain/user.js'

class StubAuthSessionsRepository implements AuthSessionsRepository {
  public readonly byId = new Map<string, AuthSession>()
  public readonly byRefreshHash = new Map<string, AuthSession>()
  public rotationCalls: RotateAuthSessionInput[] = []
  public familyRevokeCalls: { familyId: string; reason: RevokeReason; now: Date }[] = []

  /** Утилита для тестов — посеять существующую сессию. */
  seed(session: AuthSession): void {
    this.byId.set(session.id, session)
    this.byRefreshHash.set(session.refreshTokenHash, session)
  }

   
  create(_input: never): Promise<AuthSession> {
    throw new Error('not used in refresh-token tests')
  }

   
  findById(id: string): Promise<AuthSession | null> {
    return Promise.resolve(this.byId.get(id) ?? null)
  }

  findByRefreshHash(hash: string): Promise<AuthSession | null> {
    return Promise.resolve(this.byRefreshHash.get(hash) ?? null)
  }

   
  findActiveByUserId(_userId: string, _now: Date): Promise<readonly AuthSession[]> {
    return Promise.resolve([])
  }

  async revokeCurrentAndCreateNext(
    _tx: UnitOfWorkTx,
    previousId: string,
    input: RotateAuthSessionInput,
  ): Promise<AuthSession> {
    this.rotationCalls.push(input)
    const previous = this.byId.get(previousId)
    if (previous === undefined) {
      throw new Error(`AuthSession not found: ${previousId}`)
    }
    // `AuthSession.restore(...)` (не spread + `as AuthSession`): и `previous`,
    // и `next` дальше проходят через `execute()` СЛЕДУЮЩЕГО вызова, который
    // зовёт `.isRevoked()`/`.isRotated()` — методы прототипа, их нет у
    // голого property-bag (см. JSDoc `makeSession` выше — тот же дефект).
    const rotated = AuthSession.restore({ ...previous.props, rotatedAt: input.now })
    this.byId.set(previousId, rotated)
    // `byRefreshHash` ТОЖЕ обязан указывать на обновлённый (rotated) объект —
    // иначе повторное предъявление СТАРОГО refresh-токена находит устаревшую
    // запись с `rotatedAt: null` и проходит ротацию заново вместо детекта
    // reuse (SRS-API-027). Раньше здесь обновлялся только `byId`.
    this.byRefreshHash.set(rotated.refreshTokenHash, rotated)
    const next: AuthSession = AuthSession.restore({
      id: input.nextId,
      tenantId: input.tenantId,
      userId: input.userId,
      familyId: input.familyId,
      refreshTokenHash: input.newRefreshTokenHash,
      deviceLabel: input.deviceLabel,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      absoluteExpiresAt: input.absoluteExpiresAt,
      rotatedAt: null,
      revokedAt: null,
      revokeReason: null,
      lastSeenAt: input.now,
      createdAt: input.now,
    })
    this.byId.set(next.id, next)
    this.byRefreshHash.set(next.refreshTokenHash, next)
    return Promise.resolve(next)
  }

  async revokeAllByFamilyId(input: {
    tx: UnitOfWorkTx
    familyId: string
    reason: RevokeReason
    now: Date
  }): Promise<number> {
    const { familyId, reason, now } = input
    this.familyRevokeCalls.push({ familyId, reason, now })
    let count = 0
    for (const session of this.byId.values()) {
      if (session.familyId === familyId && session.revokedAt === null) {
        const revoked = AuthSession.restore({ ...session.props, revokedAt: now, revokeReason: reason })
        this.byId.set(session.id, revoked)
        if (this.byRefreshHash.get(session.refreshTokenHash)?.id === session.id) {
          this.byRefreshHash.delete(session.refreshTokenHash)
        }
        count += 1
      }
    }
    return Promise.resolve(count)
  }

  // DTJ-026: новые методы logout/logout-all/revoke — в тестах refresh-token
  // не используются. Noop-стабы для компиляции; реальная логика покрыта
  // `logout.use-case.spec.ts` и `revoke-session.use-case.spec.ts`.
   
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

class StubUsersRepository implements UsersRepository {
  public readonly byId = new Map<string, User>()

  /** Утилита для тестов — посеять существующего пользователя. */
  seed(user: User): void {
    this.byId.set(user.id, user)
  }

   
  findByTenantAndPhone(_tenantId: string, _phoneNumber: string): Promise<User | null> {
    return Promise.resolve(null)
  }

  findById(id: string): Promise<User | null> {
    return Promise.resolve(this.byId.get(id) ?? null)
  }

   
  create(_input: CreateUserInput): Promise<User> {
    throw new Error('not used in refresh-token tests')
  }

   
  findOrCreateByTenantAndPhone(_input: CreateUserInput): Promise<User> {
    throw new Error('not used in refresh-token tests')
  }

  // [Task 5] Глобальный поиск по phone — заглушка для refresh-token тестов.
  findActiveByPhone(_phoneNumber: string): Promise<User | null> {
    return Promise.resolve(null)
  }

   
  update(_id: string, _patch: never): Promise<User> {
    throw new Error('not used in refresh-token tests')
  }

  // [DTJ-354] Расширение порта — не используется этими тестами.
  list(_query: UsersListQuery): Promise<UsersListPage> {
    throw new Error('not used in refresh-token tests')
  }

  setActive(_id: string, _isActive: boolean): Promise<User | null> {
    throw new Error('not used in refresh-token tests')
  }

  setRole(_id: string, _role: UserRole): Promise<User | null> {
    throw new Error('not used in refresh-token tests')
  }
}

class StubJwtSigner implements JwtSignerPort {
  public lastClaims: JwtClaims | null = null
  public callCount = 0
  sign(claims: JwtClaims): string {
    this.callCount += 1
    this.lastClaims = claims
    return `jwt.${claims.sub}.${claims.sessionId}`
  }
  verify(): never {
    throw new Error('not used in refresh-token tests')
  }
}

class StubRefreshGen implements RefreshTokenGeneratorPort {
  private n = 0
  generate(): { token: string; hash: string } {
    this.n += 1
    const token = `refresh-${String(this.n)}`
    // `hash` ДОЛЖЕН быть `sha256(token)` — ровно то же преобразование, что
    // `hashToken()` в `RefreshTokenUseCase` применяет при ПОИСКЕ по refresh
    // (см. `CryptoRefreshTokenGeneratorAdapter` — реальный адаптер именно
    // так и делает). Раньше здесь стояло `hash-${n}` — произвольная строка,
    // НЕ совпадающая с тем, что ищет `findByRefreshHash(hashToken(token))`;
    // тест 6 (3 ротации подряд) молча проходил Ротацию 2 только по случайному
    // совпадению `ORIGINAL_TOKEN === 'refresh-1'` с первым сгенерированным
    // токеном, а на Ротации 3 совпадения уже не было — `RefreshTokenInvalidError`
    // вместо ожидаемого успеха.
    const hash = createHash('sha256').update(token).digest('hex').slice(0, 64)
    return { token, hash }
  }
}

class NoopUnitOfWork implements UnitOfWorkPort {
  // Тип `run<T>(...)` — generic. Чтобы вывести T из callback в stub,
  // мы явно кастим callback к ожидаемой форме.
  async run<T>(callback: Parameters<UnitOfWorkPort['run']>[0]): Promise<T> {
     
    return (callback as (tx: UnitOfWorkTx) => Promise<T>)(null)
  }
}

/**
 * Stub-логгер для unit-тестов: реализует только `warn` — единственный метод,
 * который вызывает `RefreshTokenUseCase` (security-событие detect-reuse).
 * Используется через `as unknown as Logger` (см. `buildUseCase`).
 */
class StubLogger {
  public warnCalls: { obj: unknown; msg?: string }[] = []
  warn(obj: unknown, msg?: string): void {
    this.warnCalls.push(msg === undefined ? { obj } : { obj, msg })
  }
}

const TENANT = 'neutral'
const USER_ID = 'user-1'
const FAMILY_ID = 'family-1'
const ORIGINAL_SESSION_ID = 'session-orig'
const DEVICE_LABEL = 'mobile-app'
const IP = '10.0.0.1'
const NOW = new Date('2026-08-28T10:00:00.000Z')
const ABSOLUTE_EXPIRES_AT = new Date('2026-09-27T10:00:00.000Z') // +30 дней
// Намеренно НЕ 'refresh-1': `StubRefreshGen.generate()` тоже нумерует свои
// токены как `refresh-${n}`, начиная с 1. Совпадающая строка означала бы
// совпадающий `sha256(token)`, и свежесозданная (Ротация 1) `next`-сессия
// перезаписывала бы в `byRefreshHash` запись СЕЯНОЙ исходной сессии под
// ТЕМ ЖЕ ключом — тест 6 (reuse после 3 ротаций) находил новую валидную
// сессию вместо ожидаемой ротированной и не детектировал reuse.
const ORIGINAL_TOKEN = 'refresh-seed'
const ORIGINAL_HASH = createHash('sha256').update(ORIGINAL_TOKEN).digest('hex').slice(0, 64)

function makeUser(): User {
  return {
    id: USER_ID,
    tenantId: TENANT,
    phoneNumber: '+992917123456',
    role: 'customer',
    fullName: null,
    pharmacyId: null,
    chainId: null,
    telegramChatId: null,
    preferredLocale: 'tj',
    isActive: true,
    createdAt: NOW,
    deletedAt: null,
  }
}

/**
 * `AuthSession.restore(props)` (не сырой object-literal + `as unknown as`):
 * `execute()` вызывает методы VO (`session.isRevoked()`/`isRotated()`/
 * `isExpired()`), которых нет у голого property-bag — `as unknown as`
 * молча "проходил" мимо тайпчекера, но падал в рантайме первой же
 * попыткой вызвать метод (обнаружено интеграционным прогоном, юнит-тест
 * ни разу не проверял это через реальный `RefreshTokenUseCase.execute`).
 */
function makeSession(overrides: Partial<Parameters<typeof AuthSession.restore>[0]> = {}): AuthSession {
  return AuthSession.restore({
    id: ORIGINAL_SESSION_ID,
    tenantId: TENANT,
    userId: USER_ID,
    familyId: FAMILY_ID,
    refreshTokenHash: ORIGINAL_HASH,
    deviceLabel: DEVICE_LABEL,
    userAgent: 'DoruTJ/1.0',
    ipAddress: IP,
    absoluteExpiresAt: ABSOLUTE_EXPIRES_AT,
    rotatedAt: null,
    revokedAt: null,
    revokeReason: null,
    lastSeenAt: NOW,
    createdAt: NOW,
    ...overrides,
  })
}

interface Bundle {
  useCase: RefreshTokenUseCase
  sessions: StubAuthSessionsRepository
  users: StubUsersRepository
  jwt: StubJwtSigner
  refreshGen: StubRefreshGen
  uow: NoopUnitOfWork
  logger: StubLogger
}

function buildUseCase(): Bundle {
  const sessions = new StubAuthSessionsRepository()
  const users = new StubUsersRepository()
  const jwt = new StubJwtSigner()
  const refreshGen = new StubRefreshGen()
  const uow = new NoopUnitOfWork()
  const logger = new StubLogger()
  const useCase = new RefreshTokenUseCase(
    sessions,
    users,
    jwt,
    refreshGen,
    uow,
    logger as unknown as Logger,
  )
  return { useCase, sessions, users, jwt, refreshGen, uow, logger }
}

describe('RefreshTokenUseCase (DTJ-025, SRS-API-026/027/028)', () => {
  let bundle: Bundle
  beforeEach(() => {
    bundle = buildUseCase()
    bundle.users.seed(makeUser())
  })

  it('1. успешная ротация: новая пара, familyId сохранён, absoluteExpiresAt НЕ продлён (приёмка №1)', async () => {
    bundle.sessions.seed(makeSession())
    const result = await bundle.useCase.execute({
      refreshToken: ORIGINAL_TOKEN,
      ipAddress: IP,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.accessToken).toMatch(/^jwt\.user-1\./)
    expect(result.value.refreshToken).toBe('refresh-1')
    expect(result.value.user.id).toBe(USER_ID)
    // familyId сохранён на новой строке
    expect(bundle.sessions.rotationCalls).toHaveLength(1)
    const rotation = bundle.sessions.rotationCalls[0]
    expect(rotation).toBeDefined()
    expect(rotation?.familyId).toBe(FAMILY_ID)
    // absoluteExpiresAt НЕ пересчитан, скопирован с предыдущей
    expect(rotation?.absoluteExpiresAt.getTime()).toBe(ABSOLUTE_EXPIRES_AT.getTime())
    // claims содержат новый sessionId (не оригинальный)
    expect(bundle.jwt.lastClaims?.sessionId).not.toBe(ORIGINAL_SESSION_ID)
    expect(bundle.jwt.lastClaims?.sessionId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('2. reuse detection: предъявлен уже-ротированный токен → REUSE_DETECTED + family revoked + warn-лог', async () => {
    const rotated = makeSession({ rotatedAt: NOW })
    bundle.sessions.seed(rotated)
    const result = await bundle.useCase.execute({
      refreshToken: ORIGINAL_TOKEN,
      ipAddress: IP,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBeInstanceOf(RefreshTokenReuseDetectedError)
    // ВСЯ family отозвана
    expect(bundle.sessions.familyRevokeCalls).toHaveLength(1)
    expect(bundle.sessions.familyRevokeCalls[0]?.familyId).toBe(FAMILY_ID)
    expect(bundle.sessions.familyRevokeCalls[0]?.reason).toBe('reuse_detected')
    // warn-лог содержит userId/sessionFamilyId/ipAddress (DoD п.4)
    expect(bundle.logger.warnCalls).toHaveLength(1)
    const warnObj = bundle.logger.warnCalls[0]?.obj as Record<string, unknown> | undefined
    expect(warnObj?.userId).toBe(USER_ID)
    expect(warnObj?.sessionFamilyId).toBe(FAMILY_ID)
    expect(warnObj?.ipAddress).toBe(IP)
    expect(warnObj?.event).toBe('auth.refresh_reuse_detected')
    // НЕ содержит сами токены
    const warnString = JSON.stringify(warnObj)
    expect(warnString).not.toContain(ORIGINAL_TOKEN)
    expect(warnString).not.toContain(ORIGINAL_HASH)
    // JWT НЕ выдан
    expect(bundle.jwt.callCount).toBe(0)
  })

  it('3. уже отозван (revoked_at IS NOT NULL) → RefreshTokenInvalidError, НЕ повторный reuse-алерт', async () => {
    const revoked = makeSession({
      revokedAt: NOW,
      revokeReason: 'user_logout',
    })
    bundle.sessions.seed(revoked)
    const result = await bundle.useCase.execute({
      refreshToken: ORIGINAL_TOKEN,
      ipAddress: IP,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBeInstanceOf(RefreshTokenInvalidError)
    // НЕ триггерим reuse-detection повторно (DTJ-025 §2.4)
    expect(bundle.sessions.familyRevokeCalls).toHaveLength(0)
    // И warn-лог НЕ пишется
    expect(bundle.logger.warnCalls).toHaveLength(0)
  })

  it('4. истёкший токен (absoluteExpiresAt < now) → RefreshTokenInvalidError, НЕ REUSE_DETECTED (приёмка №3)', async () => {
    // Одновременно rotated (т.е. мог бы сработать reuse-detection) И expired
    // (absoluteExpiresAt в прошлом). Проверка expired ПЕРЕД rotated — иначе
    // reuse-ветка «заткнула» бы expired-ветку. DTJ-025 «Риски».
    const expiredRotated = makeSession({
      absoluteExpiresAt: new Date('2026-01-01T00:00:00.000Z'),
      rotatedAt: NOW,
    })
    bundle.sessions.seed(expiredRotated)
    const result = await bundle.useCase.execute({
      refreshToken: ORIGINAL_TOKEN,
      ipAddress: IP,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBeInstanceOf(RefreshTokenInvalidError)
    // НЕ REUSE_DETECTED
    expect(result.error).not.toBeInstanceOf(RefreshTokenReuseDetectedError)
    // НЕ отзываем family (это не атака, штатное истечение)
    expect(bundle.sessions.familyRevokeCalls).toHaveLength(0)
  })

  it('5. не найден по hash → RefreshTokenInvalidError (без раскрытия причины, SRS-API-028)', async () => {
    const result = await bundle.useCase.execute({
      refreshToken: 'totally-unknown-token',
      ipAddress: IP,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBeInstanceOf(RefreshTokenInvalidError)
    // Никаких логов
    expect(bundle.logger.warnCalls).toHaveLength(0)
    // Никаких revoke'ов
    expect(bundle.sessions.familyRevokeCalls).toHaveLength(0)
  })

  it('6. три последовательные ротации: каждый следующий токен работает, 1-й после 3-й даёт REUSE_DETECTED', async () => {
    // Первоначальная сессия (токен ORIGINAL_TOKEN).
    bundle.sessions.seed(makeSession())

    // Ротация 1.
    const r1 = await bundle.useCase.execute({ refreshToken: ORIGINAL_TOKEN, ipAddress: IP })
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    const token1 = r1.value.refreshToken

    // Ротация 2 (используя токен 1).
    const r2 = await bundle.useCase.execute({ refreshToken: token1, ipAddress: IP })
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    const token2 = r2.value.refreshToken

    // Ротация 3 (используя токен 2).
    const r3 = await bundle.useCase.execute({ refreshToken: token2, ipAddress: IP })
    expect(r3.ok).toBe(true)
    if (!r3.ok) return
    const token3 = r3.value.refreshToken

    // Токен 1 теперь — прошлое звено (rotated). Предъявление → REUSE_DETECTED.
    const reuse1 = await bundle.useCase.execute({ refreshToken: token1, ipAddress: IP })
    expect(reuse1.ok).toBe(false)
    if (reuse1.ok) return
    expect(reuse1.error).toBeInstanceOf(RefreshTokenReuseDetectedError)

    // После REUSE_DETECTED ВСЯ family отозвана (`revokeAllByFamilyId`).
    // Токен 2 и токен 3 теперь либо revoked (если `findByRefreshHash` ещё
    // возвращает строку), либо вообще не найден (если repository очистил
    // hash-индекс). ОБА сценария дают `RefreshTokenInvalidError` —
    // SRS-API-028 «не раскрывать причину подробнее». Главное — НЕ
    // `REUSE_DETECTED` повторно (DTJ-025 §2.4).
    const reuse2 = await bundle.useCase.execute({ refreshToken: token2, ipAddress: IP })
    expect(reuse2.ok).toBe(false)
    if (reuse2.ok) return
    expect(reuse2.error).toBeInstanceOf(RefreshTokenInvalidError)
    expect(reuse2.error).not.toBeInstanceOf(RefreshTokenReuseDetectedError)

    const reuse3 = await bundle.useCase.execute({ refreshToken: token3, ipAddress: IP })
    expect(reuse3.ok).toBe(false)
    if (reuse3.ok) return
    expect(reuse3.error).toBeInstanceOf(RefreshTokenInvalidError)
    expect(reuse3.error).not.toBeInstanceOf(RefreshTokenReuseDetectedError)
  })
})
