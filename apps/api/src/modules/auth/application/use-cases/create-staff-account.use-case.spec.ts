/**
 * Unit-тест `CreateStaffAccountUseCase` (EP-01, DTJ-030, SRS-API-035).
 *
 * Покрывает:
 *   - happy path: pharmacy_admin создаёт pharmacist в СВОЕЙ сети → userId + role;
 *   - happy path: super_admin создаёт любого role (любой chainId);
 *   - policy fail: pharmacy_admin создаёт pharmacist в ДРУГОЙ сети → 403;
 *   - policy fail: pharmacy_admin создаёт courier с chainId=null → 403;
 *   - policy fail: pharmacy_admin создаёт другого pharmacy_admin → 403;
 *   - duplicate phone: 409 CONFLICT;
 *   - invalid phone: 400 INVALID_PHONE_FORMAT.
 *
 * Локальный `FakeUsersRepository` (Map-based, тот же контракт `CreateUserInput`
 * с `pharmacyId`/`chainId`, что и production `InMemoryUsersRepository`) — не
 * production-класс: application не импортирует infrastructure (§1.1).
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
import { type JwtClaims } from '@/modules/auth/application/ports/jwt-signer.port.js'
import { CreateStaffAccountUseCase } from './create-staff-account.use-case.js'

class FakeUsersRepository implements UsersRepository {
  private readonly byId = new Map<string, User>()
  private readonly tenantPhoneIndex = new Map<string, string>()

  findByTenantAndPhone(tenantId: string, phoneNumber: string): Promise<User | null> {
    const id = this.tenantPhoneIndex.get(`${tenantId}|${phoneNumber}`)
    return Promise.resolve(id === undefined ? null : (this.byId.get(id) ?? null))
  }

  findById(id: string): Promise<User | null> {
    return Promise.resolve(this.byId.get(id) ?? null)
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

  async findOrCreateByTenantAndPhone(input: CreateUserInput): Promise<User> {
    if (input.phoneNumber === null) return this.create(input)
    const existing = await this.findByTenantAndPhone(input.tenantId, input.phoneNumber)
    return existing ?? this.create(input)
  }

  findActiveByPhone(_phoneNumber: string): Promise<User | null> {
    throw new Error('not used in DTJ-030 tests')
  }

  update(_id: string, _patch: UpdateUserPatch): Promise<User> {
    throw new Error('not used in DTJ-030 tests')
  }
}

const TENANT_ID = '33333333-3333-3333-3333-333333333333'
const CHAIN_A = '11111111-1111-1111-1111-111111111111'
const CHAIN_B = '22222222-2222-2222-2222-222222222222'

function actor(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: '55555555-5555-5555-5555-555555555555',
    role: 'pharmacy_admin',
    tenantId: TENANT_ID,
    pharmacyId: null,
    chainId: CHAIN_A,
    sessionId: 'session-1',
    ...overrides,
  }
}

describe('CreateStaffAccountUseCase (DTJ-030, SRS-API-035)', () => {
  let users: FakeUsersRepository
  let useCase: CreateStaffAccountUseCase

  beforeEach(() => {
    users = new FakeUsersRepository()
    useCase = new CreateStaffAccountUseCase(users)
  })

  it('1. happy path: pharmacy_admin создаёт pharmacist в СВОЕЙ сети', async () => {
    const result = await useCase.execute(actor(), {
      phone: '+992917123456',
      fullName: 'Алиев Али',
      role: 'pharmacist',
      pharmacyId: '66666666-6666-6666-6666-666666666666',
      chainId: CHAIN_A,
    })
    expect(isOk(result)).toBe(true)
    if (!isOk(result)) throw new Error('expected ok')
    expect(result.value.role).toBe('pharmacist')
    expect(result.value.userId).toMatch(/^[0-9a-f-]{36}$/i)
    // Проверяем, что user реально записан с правильным chainId/pharmacyId.
    const saved = await users.findById(result.value.userId)
    expect(saved?.chainId).toBe(CHAIN_A)
    expect(saved?.pharmacyId).toBe('66666666-6666-6666-6666-666666666666')
  })

  it('2. happy path: super_admin создаёт pharmacist в чужой сети', async () => {
    const result = await useCase.execute(actor({ role: 'super_admin', chainId: null }), {
      phone: '+992917654321',
      fullName: 'Test',
      role: 'pharmacist',
      pharmacyId: null,
      chainId: CHAIN_B,
    })
    expect(isOk(result)).toBe(true)
  })

  it('3. happy path: super_admin создаёт courier платформенного пула (chainId=null)', async () => {
    const result = await useCase.execute(actor({ role: 'super_admin', chainId: null }), {
      phone: '+992917111111',
      fullName: 'Платформенный курьер',
      role: 'courier',
      chainId: null,
    })
    expect(isOk(result)).toBe(true)
  })

  it('4. policy fail: pharmacy_admin → pharmacist в чужой сети → 403 FORBIDDEN', async () => {
    const result = await useCase.execute(actor(), {
      phone: '+992917222222',
      fullName: 'X',
      role: 'pharmacist',
      pharmacyId: null,
      chainId: CHAIN_B, // другая сеть
    })
    expect(isErr(result)).toBe(true)
    if (!isErr(result)) throw new Error('expected err')
    expect(result.error.code).toBe(ErrorCode.FORBIDDEN)
    expect(result.error.details?.actorRole).toBe('pharmacy_admin')
  })

  it('5. policy fail: pharmacy_admin → courier с chainId=null (платформенный пул) → 403', async () => {
    const result = await useCase.execute(actor(), {
      phone: '+992917333333',
      fullName: 'X',
      role: 'courier',
      chainId: null,
    })
    expect(isErr(result)).toBe(true)
    if (!isErr(result)) throw new Error('expected err')
    expect(result.error.code).toBe(ErrorCode.FORBIDDEN)
  })

  it('6. policy fail: pharmacy_admin → другого pharmacy_admin → 403 (нет эскалации)', async () => {
    const result = await useCase.execute(actor(), {
      phone: '+992917444444',
      fullName: 'X',
      role: 'pharmacy_admin',
      chainId: CHAIN_A,
    })
    expect(isErr(result)).toBe(true)
    if (!isErr(result)) throw new Error('expected err')
    expect(result.error.code).toBe(ErrorCode.FORBIDDEN)
  })

  it('7. policy fail: customer → любая роль → 403', async () => {
    const result = await useCase.execute(actor({ role: 'customer', chainId: null }), {
      phone: '+992917555555',
      fullName: 'X',
      role: 'pharmacist',
      chainId: null,
    })
    expect(isErr(result)).toBe(true)
    if (!isErr(result)) throw new Error('expected err')
    expect(result.error.code).toBe(ErrorCode.FORBIDDEN)
  })

  it('8. duplicate phone: 409 CONFLICT с existingUserId в details', async () => {
    const phone = '+992917666666'
    // Первый create — успех.
    const first = await useCase.execute(actor(), {
      phone,
      fullName: 'Первый',
      role: 'pharmacist',
      chainId: CHAIN_A,
    })
    expect(isOk(first)).toBe(true)
    // Второй create на тот же phone в том же tenant — конфликт.
    const second = await useCase.execute(actor(), {
      phone,
      fullName: 'Второй',
      role: 'pharmacist',
      chainId: CHAIN_A,
    })
    expect(isErr(second)).toBe(true)
    if (!isErr(second)) throw new Error('expected err')
    expect(second.error.code).toBe(ErrorCode.CONFLICT)
    expect(second.error.details?.existingUserId).toBe(first.ok ? first.value.userId : '')
  })

  it('9. invalid phone: 400 INVALID_PHONE_FORMAT', async () => {
    const result = await useCase.execute(actor(), {
      phone: 'not-a-phone',
      fullName: 'X',
      role: 'pharmacist',
      chainId: CHAIN_A,
    })
    expect(isErr(result)).toBe(true)
    if (!isErr(result)) throw new Error('expected err')
    expect(result.error.code).toBe(ErrorCode.INVALID_PHONE_FORMAT)
  })
})
