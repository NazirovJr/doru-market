import { describe, expect, it, vi } from 'vitest'
import { ForbiddenError, NotFoundError } from '@dorutj/contracts'
import type { IdentityFacadePort, UserSummaryView } from '../ports/identity-facade.port.js'
import type { CourierSummaryView, DeliveryFacadePort } from '../ports/delivery-facade.port.js'
import { CreateStaffAccountUseCase } from './create-staff-account.use-case.js'

const CHAIN_A = '11111111-1111-1111-1111-111111111111'
const CHAIN_B = '22222222-2222-2222-2222-222222222222'
const ACTOR_PHARMACY_ADMIN = { role: 'pharmacy_admin', chainId: CHAIN_A }
const ACTOR_SUPER_ADMIN = { role: 'super_admin', chainId: null }

function makeUser(overrides: Partial<UserSummaryView> = {}): UserSummaryView {
  return {
    id: 'user-1',
    tenantId: 'tenant-1',
    phoneNumber: '+992900000001',
    role: 'courier',
    fullName: 'Karimov K.',
    isActive: true,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    chainId: CHAIN_A,
    pharmacyId: null,
    ...overrides,
  }
}

const COURIER: CourierSummaryView = { id: 'courier-1', userId: 'user-1', chainId: CHAIN_A, vehicleType: 'foot', taxStatus: 'chain_employee' }

function buildHarness(params: { readonly target?: UserSummaryView | null; readonly existingCourier?: CourierSummaryView | null } = {}) {
  const target = params.target === undefined ? makeUser() : params.target
  const existingCourier = params.existingCourier === undefined ? null : params.existingCourier
  const getUserMock = vi.fn<NonNullable<IdentityFacadePort['getUser']>>().mockResolvedValue(target)
  const identityFacade: IdentityFacadePort = {
    listUsers: vi.fn(),
    deactivateUser: vi.fn(),
    changeStaffRole: vi.fn(),
    grantPlatformRole: vi.fn(),
    getUser: getUserMock,
  }
  const findCourierMock = vi.fn<DeliveryFacadePort['findCourierByUserId']>().mockResolvedValue(existingCourier)
  const createCourierMock = vi.fn<DeliveryFacadePort['createCourier']>().mockResolvedValue(COURIER)
  const deliveryFacade: DeliveryFacadePort = { findCourierByUserId: findCourierMock, createCourier: createCourierMock }
  const useCase = new CreateStaffAccountUseCase(identityFacade, deliveryFacade)
  return { useCase, getUserMock, findCourierMock, createCourierMock }
}

describe('CreateStaffAccountUseCase / provision-courier (DTJ-364, SRS-ADM-041/042)', () => {
  it('courier своей сети, ещё не провижининжен → создаёт delivery.couriers через facade', async () => {
    const { useCase, createCourierMock } = buildHarness()

    const result = await useCase.execute({ userId: 'user-1', actor: ACTOR_PHARMACY_ADMIN })

    expect(createCourierMock).toHaveBeenCalledWith({ userId: 'user-1', chainId: CHAIN_A })
    expect(result).toEqual(COURIER)
  })

  it('идемпотентно: уже провижининжен → возвращает существующую запись, createCourier НЕ вызывается', async () => {
    const { useCase, createCourierMock } = buildHarness({ existingCourier: COURIER })

    const result = await useCase.execute({ userId: 'user-1', actor: ACTOR_PHARMACY_ADMIN })

    expect(createCourierMock).not.toHaveBeenCalled()
    expect(result).toEqual(COURIER)
  })

  it('pharmacy_admin (chain A) → courier ЧУЖОЙ сети (chain B) → CROSS_TENANT_ACCESS_DENIED', async () => {
    const { useCase, createCourierMock } = buildHarness({ target: makeUser({ chainId: CHAIN_B }) })

    await expect(useCase.execute({ userId: 'user-1', actor: ACTOR_PHARMACY_ADMIN })).rejects.toMatchObject({
      code: 'CROSS_TENANT_ACCESS_DENIED',
    })
    expect(createCourierMock).not.toHaveBeenCalled()
  })

  it('target.role !== "courier" (напр. pharmacist) → ForbiddenError', async () => {
    const { useCase, createCourierMock } = buildHarness({ target: makeUser({ role: 'pharmacist' }) })

    await expect(useCase.execute({ userId: 'user-1', actor: ACTOR_PHARMACY_ADMIN })).rejects.toThrow(ForbiddenError)
    expect(createCourierMock).not.toHaveBeenCalled()
  })

  it('платформенный пул (target.chainId=null) → ForbiddenError, вне периметра pharmacy_admin', async () => {
    const { useCase, createCourierMock } = buildHarness({ target: makeUser({ chainId: null }) })

    await expect(useCase.execute({ userId: 'user-1', actor: ACTOR_SUPER_ADMIN })).rejects.toThrow(ForbiddenError)
    expect(createCourierMock).not.toHaveBeenCalled()
  })

  it('пользователь не найден → NotFoundError', async () => {
    const { useCase } = buildHarness({ target: null })

    await expect(useCase.execute({ userId: 'missing', actor: ACTOR_PHARMACY_ADMIN })).rejects.toThrow(NotFoundError)
  })

  it('super_admin → провижинит курьера ЛЮБОЙ сети', async () => {
    const { useCase, createCourierMock } = buildHarness({ target: makeUser({ chainId: CHAIN_B }) })

    await useCase.execute({ userId: 'user-1', actor: ACTOR_SUPER_ADMIN })

    expect(createCourierMock).toHaveBeenCalledWith({ userId: 'user-1', chainId: CHAIN_B })
  })
})
