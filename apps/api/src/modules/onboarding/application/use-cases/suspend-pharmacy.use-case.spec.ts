import { describe, expect, it, vi } from 'vitest'
import { PharmacyAccount } from '@/modules/onboarding/domain/pharmacy-account.entity.js'
import type { PharmacyAccountProps, PharmacySuspensionReason } from '@/modules/onboarding/domain/pharmacy-account-entity.types.js'
import type { PharmacyAccountRepositoryPort } from '@/modules/onboarding/application/ports/pharmacy-account.repository.port.js'
import type { OnboardingReviewLogRepositoryPort } from '@/modules/onboarding/application/ports/onboarding-review-log.repository.port.js'
import { SuspendPharmacyUseCase } from './suspend-pharmacy.use-case.js'

const PHARMACY_ID = 'pharmacy-1'
const ACTOR_ID = 'admin-1'

function account(overrides: Partial<PharmacyAccountProps> = {}): PharmacyAccount {
  return PharmacyAccount.restore({
    id: PHARMACY_ID,
    chainId: 'chain-1',
    name: 'Test',
    addressText: 'Dushanbe',
    landmarkTj: null,
    latitude: 38.56,
    longitude: 68.78,
    phone: '+992900000000',
    is24_7: false,
    openingTime: null,
    closingTime: null,
    maxDeliveryRadiusKm: 10,
    licenseNumber: 'L-1',
    licenseIssuingAuthority: null,
    licenseIssueDate: null,
    licenseExpiryDate: null,
    licenseScanUrl: null,
    pharmacistInChargeName: null,
    status: 'active',
    suspensionReason: null,
    isActive: true,
    submittedAt: null,
    ...overrides,
  })
}

function makeUseCase(found: PharmacyAccount | null) {
  const save = vi.fn().mockResolvedValue(undefined)
  const append = vi.fn().mockResolvedValue(undefined)
  const cancelUnpaid = vi.fn().mockResolvedValue({ cancelledOrderIds: ['o1', 'o2'] })
  const useCase = new SuspendPharmacyUseCase(
    { findById: vi.fn().mockResolvedValue(found), save } as unknown as PharmacyAccountRepositoryPort,
    { append } as unknown as OnboardingReviewLogRepositoryPort,
    { cancelUnpaid, forceCancelIncomplete: vi.fn() },
  )
  return { useCase, save, append, cancelUnpaid }
}

const input = (reason: PharmacySuspensionReason) => ({ pharmacyId: PHARMACY_ID, actorId: ACTOR_ID, reason, notes: null })

describe('SuspendPharmacyUseCase (SRS-DOM-161)', () => {
  it.each(['voluntary_pause', 'license_expired', 'policy_violation', 'unpaid_invoice'] as const)(
    '%s: аптека приостановлена, заказы без оплаты отменяются, force-cancel не требуется',
    async (reason) => {
      const { useCase, save, append, cancelUnpaid } = makeUseCase(account())

      const result = await useCase.execute(input(reason))

      expect(result).toEqual({ id: PHARMACY_ID, status: 'suspended', requiresForceCancelAction: false, cancelledOrderIds: ['o1', 'o2'] })
      expect(save).toHaveBeenCalledOnce()
      expect(append).toHaveBeenCalledOnce()
      expect(cancelUnpaid).toHaveBeenCalledWith(PHARMACY_ID)
    },
  )

  it.each(['fraud_or_safety', 'license_revoked'] as const)('%s: заказы не трогаются, нужен явный force-cancel', async (reason) => {
    const { useCase, cancelUnpaid } = makeUseCase(account())

    const result = await useCase.execute(input(reason))

    expect(result).toMatchObject({ status: 'suspended', requiresForceCancelAction: true, cancelledOrderIds: [] })
    expect(cancelUnpaid).not.toHaveBeenCalled()
  })

  it('повторная приостановка: причина и журнал не меняются, отмена заказов доводится', async () => {
    const { useCase, save, append, cancelUnpaid } = makeUseCase(account({ status: 'suspended', suspensionReason: 'voluntary_pause' }))

    const result = await useCase.execute(input('policy_violation'))

    expect(result.requiresForceCancelAction).toBe(false)
    expect(save).not.toHaveBeenCalled()
    expect(append).not.toHaveBeenCalled()
    expect(cancelUnpaid).toHaveBeenCalledOnce()
  })

  it('повторная приостановка по причине с force-cancel не отменяет заказы автоматически', async () => {
    const { useCase, cancelUnpaid } = makeUseCase(account({ status: 'suspended', suspensionReason: 'fraud_or_safety' }))

    const result = await useCase.execute(input('voluntary_pause'))

    expect(result.requiresForceCancelAction).toBe(true)
    expect(cancelUnpaid).not.toHaveBeenCalled()
  })

  it('аптека не найдена -> ошибка, заказы не трогаются', async () => {
    const { useCase, cancelUnpaid } = makeUseCase(null)

    await expect(useCase.execute(input('voluntary_pause'))).rejects.toThrow(/not found/)
    expect(cancelUnpaid).not.toHaveBeenCalled()
  })

  it('отмена заказов упала -> ошибка пробрасывается (повторный вызов доработает)', async () => {
    const { useCase, cancelUnpaid } = makeUseCase(account())
    cancelUnpaid.mockRejectedValue(new Error('orders not cancelled'))

    await expect(useCase.execute(input('voluntary_pause'))).rejects.toThrow(/orders not cancelled/)
  })
})
