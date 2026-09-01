/**
 * Unit-тест `GetMeUseCase` (EP-01, DTJ-028 follow-up) — простой use case
 * с тремя сценариями:
 *   1. Активный user → ok(User);
 *   2. `isActive=false` (admin отключил) → err(TokenInvalidatedError);
 *   3. User не найден (deleted/не существует) → err(TokenInvalidatedError).
 *
 * Использует `InMemoryUsersRepository` из production, чтобы не дублировать
 * state-машину (она уже покрыта `in-memory-users.repository.spec.ts` если
 * есть, или просто спецификацией контракта).
 */
import { ErrorCode } from '@dorutj/contracts'
import { isErr, isOk } from '@dorutj/domain-kernel'
import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryUsersRepository } from '@/modules/auth/infrastructure/repositories/in-memory-users.repository.js'
import { type User } from '@/modules/auth/domain/user.js'
import { GetMeUseCase } from './get-me.use-case.js'

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
  let users: InMemoryUsersRepository
  let useCase: GetMeUseCase

  beforeEach(() => {
    users = new InMemoryUsersRepository()
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
    const created = Array.from((users as unknown as { byId: Map<string, User> }).byId.values())[0]
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
    ;(users as unknown as { byId: Map<string, User> }).byId.set(user.id, user)

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
    ;(users as unknown as { byId: Map<string, User> }).byId.set(user.id, user)

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
