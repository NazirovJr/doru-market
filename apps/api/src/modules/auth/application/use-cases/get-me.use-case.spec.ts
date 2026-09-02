/**
 * Unit-тест `GetMeUseCase` (EP-01, DTJ-028 follow-up) — простой use case
 * с тремя сценариями:
 *   1. Активный user → ok(User);
 *   2. `isActive=false` (admin отключил) → err(TokenInvalidatedError);
 *   3. User не найден (deleted/не существует) → err(TokenInvalidatedError).
 *
 * Локальный `FakeUsersRepository` (Map-based, публичный `byId` для прямого
 * посева в тестах) — не production-класс: application не импортирует
 * infrastructure (§1.1).
 */
import { randomUUID } from 'node:crypto'
import { ErrorCode } from '@dorutj/contracts'
import { isErr, isOk } from '@dorutj/domain-kernel'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  type CreateUserInput,
  type UpdateUserPatch,
  type UsersRepository,
} from '@/modules/auth/application/ports/users.repository.port.js'
import { type User } from '@/modules/auth/domain/user.js'
import { GetMeUseCase } from './get-me.use-case.js'

class FakeUsersRepository implements UsersRepository {
  public readonly byId = new Map<string, User>()
  private readonly tenantPhoneIndex = new Map<string, string>()

  findByTenantAndPhone(tenantId: string, phoneNumber: string): Promise<User | null> {
    const id = this.tenantPhoneIndex.get(`${tenantId}|${phoneNumber}`)
    return Promise.resolve(id === undefined ? null : (this.byId.get(id) ?? null))
  }

  findById(id: string): Promise<User | null> {
    const user = this.byId.get(id)
    return Promise.resolve(user?.deletedAt === null ? user : null)
  }

  create(input: CreateUserInput): Promise<User> {
    const id = randomUUID()
    const user: User = {
      id,
      tenantId: input.tenantId,
      phoneNumber: input.phoneNumber,
      role: input.role,
      fullName: input.fullName,
      pharmacyId: input.pharmacyId ?? null,
      chainId: input.chainId ?? null,
      telegramChatId: null,
      preferredLocale: 'tj',
      isActive: true,
      createdAt: new Date(),
      deletedAt: null,
    }
    this.byId.set(id, user)
    if (input.phoneNumber !== null) {
      this.tenantPhoneIndex.set(`${input.tenantId}|${input.phoneNumber}`, id)
    }
    return Promise.resolve(user)
  }

  findOrCreateByTenantAndPhone(_input: CreateUserInput): Promise<User> {
    throw new Error('not used in get-me tests')
  }

  findActiveByPhone(_phoneNumber: string): Promise<User | null> {
    throw new Error('not used in get-me tests')
  }

  update(_id: string, _patch: UpdateUserPatch): Promise<User> {
    throw new Error('not used in get-me tests')
  }
}

const TENANT_ID = '33333333-3333-3333-3333-333333333333'
const USER_ID = '11111111-1111-1111-1111-111111111111'

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: USER_ID,
    tenantId: TENANT_ID,
    phoneNumber: '+992917123456',
    role: 'customer',
    fullName: 'Тест',
    pharmacyId: null,
    chainId: null,
    telegramChatId: null,
    preferredLocale: 'tj',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  }
}

describe('GetMeUseCase (DTJ-028 follow-up, SRS-API-025)', () => {
  let users: FakeUsersRepository
  let useCase: GetMeUseCase

  beforeEach(() => {
    users = new FakeUsersRepository()
    useCase = new GetMeUseCase(users)
  })

  it('1. активный user → ok(User)', async () => {
    await users.create({
      tenantId: TENANT_ID,
      phoneNumber: '+992917123456',
      role: 'customer',
      fullName: 'Тест',
    })
    // Достаём реальный id, сгенерированный в create (randomUUID).
    const created = Array.from(users.byId.values())[0]
    expect(created).toBeDefined()

    const result = await useCase.execute({ userId: created?.id ?? '' })
    expect(isOk(result)).toBe(true)
    if (!isOk(result)) throw new Error('expected ok')
    expect(result.value.id).toBe(created?.id)
    expect(result.value.isActive).toBe(true)
  })

  it('2. user isActive=false → err(TokenInvalidatedError) с code=TOKEN_INVALID', async () => {
    const user = makeUser({ isActive: false })
    // Подкидываем напрямую в InMemory (минуя create, т.к. create не принимает isActive).
    ;users.byId.set(user.id, user)

    const result = await useCase.execute({ userId: USER_ID })
    expect(isErr(result)).toBe(true)
    if (!isErr(result)) throw new Error('expected err')
    expect(result.error.code).toBe(ErrorCode.TOKEN_INVALID)
    expect(result.error.message).toBe('Token subject is no longer active')
  })

  it('3. user не найден (deletedAt) → err(TokenInvalidatedError) с code=TOKEN_INVALID', async () => {
    // В InMemory findById уже фильтрует `deletedAt !== null`. Создадим
    // user с deletedAt = now (что эквивалентно soft-delete).
    const user = makeUser({ deletedAt: new Date() })
    ;users.byId.set(user.id, user)

    const result = await useCase.execute({ userId: USER_ID })
    expect(isErr(result)).toBe(true)
    if (!isErr(result)) throw new Error('expected err')
    expect(result.error.code).toBe(ErrorCode.TOKEN_INVALID)
  })

  it('4. userId, не существующий в репозитории → err(TOKEN_INVALID), не NOT_FOUND', async () => {
    const result = await useCase.execute({ userId: 'nonexistent-user-id' })
    expect(isErr(result)).toBe(true)
    if (!isErr(result)) throw new Error('expected err')
    expect(result.error.code).toBe(ErrorCode.TOKEN_INVALID)
  })
})
