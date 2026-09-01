/**
 * Unit-тесты 4 use case'ов сессий (EP-01, DTJ-026, SRS-API-029/030/149).
 *
 * Покрывает (тикет DTJ-026 «Тест-план»):
 *   1. `LogoutUseCase`:
 *      1.1 успех: refresh принадлежит текущему пользователю, активная сессия
 *      1.2 идемпотентный путь: refresh НЕ найден → `ok(undefined)` (не ошибка)
 *      1.3 идемпотентный путь: refresh принадлежит ДРУГОМУ пользователю → `ok`
 *      1.4 идемпотентный путь: refresh уже revoked → `ok`
 *   2. `LogoutAllUseCase`:
 *      2.1 успех: revoke ВСЕХ сессий пользователя
 *      2.2 успех с 0 сессий: пользователь ещё не залогинен нигде
 *   3. `ListSessionsUseCase`:
 *      3.1 успех: список активных сессий с маскированным IP + `isCurrent`
 *      3.2 неактивные сессии (revoked/rotated/expired) НЕ попадают в список
 *      3.3 сортировка: `lastSeenAt DESC`
 *   4. `RevokeSessionUseCase`:
 *      4.1 успех: своя сессия
 *      4.2 `FORBIDDEN` (403): чужая сессия
 *      4.3 `FORBIDDEN` (403): сессия не найдена
 *   5. `maskIpAddress`:
 *      см. `mask-ip-address.spec.ts` (отдельный файл, чистая функция).
 */
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { ForbiddenError, type UserRole } from '@dorutj/contracts'
import { type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { AuthSession } from '@/modules/auth/domain/value-objects/auth-session.vo.js'
import { type User } from '@/modules/auth/domain/user.js'
import type {
  AuthSessionsRepository,
  RevokeReason,
  RotateAuthSessionInput,
} from '../ports/auth-sessions.repository.port.js'
import type { CreateUserInput, UsersRepository } from '../ports/users.repository.port.js'
import type { UnitOfWorkPort } from '../ports/unit-of-work.port.js'
import { LogoutUseCase } from './logout.use-case.js'
import { LogoutAllUseCase } from './logout-all.use-case.js'
import { ListSessionsUseCase } from './list-sessions.use-case.js'
import { RevokeSessionUseCase } from './revoke-session.use-case.js'

// ==================== Stubs ====================

class StubAuthSessionsRepository implements AuthSessionsRepository {
  public readonly byId = new Map<string, AuthSession>()
  public readonly byRefreshHash = new Map<string, AuthSession>()
  public oneRevokeCalls: { sessionId: string; reason: RevokeReason; now: Date }[] = []
  public userRevokeCalls: { userId: string; reason: RevokeReason; now: Date }[] = []

  seed(session: AuthSession): void {
    this.byId.set(session.id, session)
    this.byRefreshHash.set(session.refreshTokenHash, session)
  }

   
  create(_input: never): Promise<AuthSession> {
    throw new Error('not used in DTJ-026 tests')
  }
   
  findById(id: string): Promise<AuthSession | null> {
    return Promise.resolve(this.byId.get(id) ?? null)
  }
   
  findByRefreshHash(hash: string): Promise<AuthSession | null> {
    return Promise.resolve(this.byRefreshHash.get(hash) ?? null)
  }
   
  findActiveByUserId(userId: string, now: Date): Promise<readonly AuthSession[]> {
    const result: AuthSession[] = []
    for (const s of this.byId.values()) {
      if (
        s.userId === userId &&
        s.revokedAt === null &&
        s.rotatedAt === null &&
        s.absoluteExpiresAt.getTime() > now.getTime()
      ) {
        result.push(s)
      }
    }
    return Promise.resolve(result)
  }
   
  revokeCurrentAndCreateNext(
    _tx: DrizzleDb,
    _previousId: string,
    _input: RotateAuthSessionInput,
  ): Promise<AuthSession> {
    throw new Error('not used in DTJ-026 tests')
  }
   
  revokeAllByFamilyId(
    _tx: DrizzleDb,
    _familyId: string,
    _reason: RevokeReason,
    _now: Date,
  ): Promise<number> {
    return Promise.resolve(0)
  }
  async revokeOneById(
    _tx: DrizzleDb,
    sessionId: string,
    reason: RevokeReason,
    now: Date,
  ): Promise<number> {
    this.oneRevokeCalls.push({ sessionId, reason, now })
    const session = this.byId.get(sessionId)
    if (session === undefined || session.revokedAt !== null) {
      return Promise.resolve(0)
    }
    const revoked = AuthSession.restore({ ...session.props, revokedAt: now, revokeReason: reason })
    this.byId.set(sessionId, revoked)
    if (this.byRefreshHash.get(session.refreshTokenHash)?.id === sessionId) {
      this.byRefreshHash.delete(session.refreshTokenHash)
    }
    return Promise.resolve(1)
  }
  async revokeAllByUserId(
    _tx: DrizzleDb,
    userId: string,
    reason: RevokeReason,
    now: Date,
  ): Promise<number> {
    this.userRevokeCalls.push({ userId, reason, now })
    let count = 0
    for (const session of this.byId.values()) {
      if (session.userId === userId && session.revokedAt === null) {
        const revoked = {
          ...session,
          props: { ...session.props, revokedAt: now, revokeReason: reason },
        } as AuthSession
        this.byId.set(session.id, revoked)
        if (this.byRefreshHash.get(session.refreshTokenHash)?.id === session.id) {
          this.byRefreshHash.delete(session.refreshTokenHash)
        }
        count += 1
      }
    }
    return Promise.resolve(count)
  }
}

// `UsersRepository` НЕ используется в этих 4 use case'ах напрямую (claims
// приходят из JWT, не из БД). Заглушка нужна только для type-completeness,
// чтобы типизация StubAuthSessionsRepository полностью покрывала интерфейс.
class StubUsersRepository implements UsersRepository {
   
  findByTenantAndPhone(_t: string, _p: string): Promise<User | null> {
    return Promise.resolve(null)
  }
   
  findById(_id: string): Promise<User | null> {
    return Promise.resolve(null)
  }
   
  create(_input: CreateUserInput): Promise<User> {
    throw new Error('not used in DTJ-026 tests')
  }
   
  findOrCreateByTenantAndPhone(_input: CreateUserInput): Promise<User> {
    throw new Error('not used in DTJ-026 tests')
  }
   
  update(_id: string, _patch: never): Promise<User> {
    throw new Error('not used in DTJ-026 tests')
  }
}

class NoopUnitOfWork implements UnitOfWorkPort {
  async run<T>(callback: Parameters<UnitOfWorkPort['run']>[0]): Promise<T> {
     
    return (callback as (tx: DrizzleDb) => Promise<T>)(null as unknown as DrizzleDb)
  }
}

// ==================== Fixtures ====================

const NOW = new Date('2026-08-28T10:00:00.000Z')
const ABSOLUTE_EXPIRES_AT = new Date('2026-09-27T10:00:00.000Z')

// `AuthSession.restore(...)` (не object-literal + `as unknown as`): use case'ы
// вызывают методы VO (`session.isRevoked()` и т.п.), которых нет у голого
// property-bag.
function makeSession(overrides: Partial<Parameters<typeof AuthSession.restore>[0]> = {}): AuthSession {
  const id = overrides.id ?? 'sess-1'
  return AuthSession.restore({
    id,
    tenantId: 'neutral',
    userId: 'user-1',
    familyId: id,
    refreshTokenHash: hashToken(`refresh-${id}`),
    deviceLabel: 'mobile-app',
    userAgent: 'DoruTJ/1.0',
    ipAddress: '10.0.0.42',
    absoluteExpiresAt: ABSOLUTE_EXPIRES_AT,
    rotatedAt: null,
    revokedAt: null,
    revokeReason: null,
    lastSeenAt: NOW,
    createdAt: NOW,
    ...overrides,
  })
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 64)
}

const USER_ID = 'user-1'
const OTHER_USER_ID = 'user-2'
const REFRESH_TOKEN_1 = 'refresh-token-1'
const REFRESH_HASH_1 = hashToken(REFRESH_TOKEN_1)

// ==================== Test 1: LogoutUseCase ====================

describe('LogoutUseCase (DTJ-026, SRS-API-029)', () => {
  let sessions: StubAuthSessionsRepository
  let uow: NoopUnitOfWork
  let useCase: LogoutUseCase

  beforeEach(() => {
    sessions = new StubAuthSessionsRepository()
    uow = new NoopUnitOfWork()
    useCase = new LogoutUseCase(sessions, uow)
  })

  it('1.1 успех: refresh принадлежит текущему пользователю → revokeOneById(user_logout)', async () => {
    const session = makeSession({ id: 's1', userId: USER_ID, refreshTokenHash: REFRESH_HASH_1 })
    sessions.seed(session)
    const result = await useCase.execute({ refreshToken: REFRESH_TOKEN_1, currentUserId: USER_ID })
    expect(result.ok).toBe(true)
    expect(sessions.oneRevokeCalls).toEqual([
      { sessionId: 's1', reason: 'user_logout', now: expect.any(Date) },
    ])
  })

  it('1.2 идемпотентный путь: refresh НЕ найден → ok(undefined), без revoke', async () => {
    const result = await useCase.execute({
      refreshToken: 'unknown',
      currentUserId: USER_ID,
    })
    expect(result.ok).toBe(true)
    expect(sessions.oneRevokeCalls).toEqual([])
  })

  it('1.3 идемпотентный путь: refresh принадлежит ДРУГОМУ пользователю → ok(undefined), без revoke', async () => {
    const session = makeSession({ id: 's1', userId: OTHER_USER_ID, refreshTokenHash: REFRESH_HASH_1 })
    sessions.seed(session)
    const result = await useCase.execute({ refreshToken: REFRESH_TOKEN_1, currentUserId: USER_ID })
    expect(result.ok).toBe(true)
    expect(sessions.oneRevokeCalls).toEqual([])
  })

  it('1.4 идемпотентный путь: refresh уже revoked → ok (revokeOneById вернёт 0, но мы не различаем)', async () => {
    const session = makeSession({
      id: 's1',
      userId: USER_ID,
      refreshTokenHash: REFRESH_HASH_1,
      revokedAt: NOW,
      revokeReason: 'user_logout',
    })
    sessions.seed(session)
    // hash удалён, но findByRefreshHash → null → идемпотентный путь
    const result = await useCase.execute({ refreshToken: REFRESH_TOKEN_1, currentUserId: USER_ID })
    expect(result.ok).toBe(true)
    expect(sessions.oneRevokeCalls).toEqual([])
  })
})

// ==================== Test 2: LogoutAllUseCase ====================

describe('LogoutAllUseCase (DTJ-026, SRS-API-029)', () => {
  let sessions: StubAuthSessionsRepository
  let uow: NoopUnitOfWork
  let useCase: LogoutAllUseCase

  beforeEach(() => {
    sessions = new StubAuthSessionsRepository()
    uow = new NoopUnitOfWork()
    useCase = new LogoutAllUseCase(sessions, uow)
  })

  it('2.1 успех: revoke ВСЕХ сессий пользователя', async () => {
    sessions.seed(makeSession({ id: 's1', userId: USER_ID }))
    sessions.seed(makeSession({ id: 's2', userId: USER_ID }))
    sessions.seed(makeSession({ id: 's3', userId: OTHER_USER_ID }))
    await useCase.execute({ userId: USER_ID })
    expect(sessions.userRevokeCalls).toEqual([
      { userId: USER_ID, reason: 'user_logout_all', now: expect.any(Date) },
    ])
    // 2 сессии user-1 revoked, 1 сессия user-2 — нетронута
    const s1 = await sessions.findById('s1')
    const s2 = await sessions.findById('s2')
    const s3 = await sessions.findById('s3')
    expect(s1?.revokedAt).not.toBeNull()
    expect(s2?.revokedAt).not.toBeNull()
    expect(s3?.revokedAt).toBeNull()
  })

  it('2.2 успех с 0 сессий: пользователь ещё не залогинен', async () => {
    await useCase.execute({ userId: USER_ID })
    expect(sessions.userRevokeCalls).toEqual([
      { userId: USER_ID, reason: 'user_logout_all', now: expect.any(Date) },
    ])
  })
})

// ==================== Test 3: ListSessionsUseCase ====================

describe('ListSessionsUseCase (DTJ-026, SRS-API-030/149)', () => {
  let sessions: StubAuthSessionsRepository
  let useCase: ListSessionsUseCase

  beforeEach(() => {
    sessions = new StubAuthSessionsRepository()
    useCase = new ListSessionsUseCase(sessions)
  })

  it('3.1 успех: список активных сессий с маскированным IP + isCurrent', async () => {
    const currentTime = new Date('2026-08-28T10:00:00.000Z')
    sessions.seed(
      makeSession({
        id: 's-current',
        userId: USER_ID,
        ipAddress: '192.168.1.42',
        lastSeenAt: currentTime,
      }),
    )
    sessions.seed(
      makeSession({
        id: 's-other',
        userId: USER_ID,
        ipAddress: '10.0.0.5',
        lastSeenAt: new Date('2026-08-27T10:00:00.000Z'),
      }),
    )
    const result = await useCase.execute({ userId: USER_ID, currentSessionId: 's-current' })
    expect(result).toHaveLength(2)
    // isCurrent: только s-current
    const current = result.find((s) => s.id === 's-current')
    const other = result.find((s) => s.id === 's-other')
    expect(current?.isCurrent).toBe(true)
    expect(other?.isCurrent).toBe(false)
    // IP маскирован
    expect(current?.ipAddress).toBe('192.168.1.*')
    expect(other?.ipAddress).toBe('10.0.0.*')
  })

  it('3.2 неактивные сессии (revoked/rotated/expired) НЕ попадают в список', async () => {
    sessions.seed(makeSession({ id: 's-active', userId: USER_ID }))
    sessions.seed(
      makeSession({
        id: 's-revoked',
        userId: USER_ID,
        revokedAt: NOW,
        revokeReason: 'user_logout',
      }),
    )
    sessions.seed(
      makeSession({
        id: 's-rotated',
        userId: USER_ID,
        rotatedAt: NOW,
      }),
    )
    sessions.seed(
      makeSession({
        id: 's-expired',
        userId: USER_ID,
        absoluteExpiresAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    )
    const result = await useCase.execute({ userId: USER_ID, currentSessionId: 's-active' })
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('s-active')
  })

  it('3.3 сортировка по lastSeenAt DESC: самые свежие сверху', async () => {
    sessions.seed(
      makeSession({ id: 's-old', userId: USER_ID, lastSeenAt: new Date('2026-08-20T10:00:00.000Z') }),
    )
    sessions.seed(
      makeSession({
        id: 's-newest',
        userId: USER_ID,
        lastSeenAt: new Date('2026-08-28T10:00:00.000Z'),
      }),
    )
    sessions.seed(
      makeSession({
        id: 's-middle',
        userId: USER_ID,
        lastSeenAt: new Date('2026-08-25T10:00:00.000Z'),
      }),
    )
    const result = await useCase.execute({ userId: USER_ID, currentSessionId: 's-newest' })
    expect(result.map((s) => s.id)).toEqual(['s-newest', 's-middle', 's-old'])
  })
})

// ==================== Test 4: RevokeSessionUseCase ====================

describe('RevokeSessionUseCase (DTJ-026, SRS-API-030)', () => {
  let sessions: StubAuthSessionsRepository
  let uow: NoopUnitOfWork
  let useCase: RevokeSessionUseCase

  beforeEach(() => {
    sessions = new StubAuthSessionsRepository()
    uow = new NoopUnitOfWork()
    useCase = new RevokeSessionUseCase(sessions, uow)
  })

  it('4.1 успех: своя сессия → revokeOneById(user_logout)', async () => {
    sessions.seed(makeSession({ id: 's-mine', userId: USER_ID }))
    const result = await useCase.execute({ sessionId: 's-mine', actorUserId: USER_ID })
    expect(result.ok).toBe(true)
    expect(sessions.oneRevokeCalls).toEqual([
      { sessionId: 's-mine', reason: 'user_logout', now: expect.any(Date) },
    ])
  })

  it('4.2 FORBIDDEN: чужая сессия → НЕ revoke (даже для super_admin, DTJ-026 §3.4)', async () => {
    sessions.seed(makeSession({ id: 's-theirs', userId: OTHER_USER_ID }))
    const result = await useCase.execute({ sessionId: 's-theirs', actorUserId: USER_ID })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBeInstanceOf(ForbiddenError)
    expect(sessions.oneRevokeCalls).toEqual([])
  })

  it('4.3 FORBIDDEN: сессия не найдена → НЕ раскрываем существование', async () => {
    const result = await useCase.execute({ sessionId: 'unknown', actorUserId: USER_ID })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBeInstanceOf(ForbiddenError)
    expect(sessions.oneRevokeCalls).toEqual([])
  })
})

// Compile-time check, что StubAuthSessionsRepository покрывает ВСЁ
// текущее API AuthSessionsRepository (DTJ-024+025+026). Если кто-то добавит
// новый метод в порт и забудет здесь — тесты упадут на компиляции.
interface _CompileTimeCheck {
  sessions: AuthSessionsRepository
  users: UsersRepository
  role: UserRole
}
const _compileTimeCheck: _CompileTimeCheck = {
  sessions: new StubAuthSessionsRepository(),
  users: new StubUsersRepository(),
  role: 'customer',
}
// Reference the check to satisfy `noUnusedLocals` while keeping its compile-time role.
void _compileTimeCheck
