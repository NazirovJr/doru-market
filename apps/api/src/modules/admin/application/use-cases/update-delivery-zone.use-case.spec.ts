import { describe, expect, it, vi } from 'vitest'
import { CrossTenantAccessDeniedError, ValidationError } from '@dorutj/contracts'
import { UpdateDeliveryZoneUseCase } from './update-delivery-zone.use-case.js'
import type { AuditLogPort } from '@/common/audit/audit-log.port.js'
import type { OnboardingFacadePort, PharmacyDeliveryZoneView } from '../ports/onboarding-facade.port.js'

const OWN_CHAIN_ID = 'chain-a'
const OTHER_CHAIN_ID = 'chain-b'
const VIEW: PharmacyDeliveryZoneView = { id: 'pharmacy-1', maxDeliveryRadiusKm: 5 }

function fakeDeps(
  chainId: string | null,
): { onboardingFacade: OnboardingFacadePort; auditLog: AuditLogPort; updateDeliveryZone: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> } {
  const getPharmacyChainId = vi.fn().mockResolvedValue(chainId)
  const updateDeliveryZone = vi.fn().mockResolvedValue(VIEW)
  const write = vi.fn().mockResolvedValue(undefined)
  return {
    onboardingFacade: {
      findPharmacyAccountsAny: vi.fn(),
      getPharmacyChainId,
      getScheduleAndZone: vi.fn(),
      updateSchedule: vi.fn(),
      updateDeliveryZone,
      liftInvoiceBlock: vi.fn(),
      findChainNames: vi.fn(),
    },
    auditLog: { write },
    updateDeliveryZone,
    write,
  }
}

const ACTOR = { userId: 'user-1', role: 'pharmacy_admin' as const, chainId: OWN_CHAIN_ID, tenantId: 'tenant-1' }

describe('UpdateDeliveryZoneUseCase (DTJ-367)', () => {
  it('pharmacy_admin, своя аптека, валидный радиус — сохраняет и пишет audit_log', async () => {
    const { onboardingFacade, auditLog, updateDeliveryZone, write } = fakeDeps(OWN_CHAIN_ID)
    const useCase = new UpdateDeliveryZoneUseCase(onboardingFacade, auditLog)

    const result = await useCase.execute({
      pharmacyId: 'pharmacy-1',
      rawBody: { maxDeliveryRadiusKm: 5 },
      actor: ACTOR,
      requestId: 'req-1',
    })

    expect(result).toEqual(VIEW)
    expect(updateDeliveryZone).toHaveBeenCalledWith('pharmacy-1', { maxDeliveryRadiusKm: 5 }, { id: 'user-1' })
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ category: 'pharmacy_settings_change', entityId: 'pharmacy-1' }))
  })

  it('maxDeliveryRadiusKm = -5 — ValidationError (400 VALIDATION_ERROR), facade НЕ вызывается (AC2)', async () => {
    const { onboardingFacade, auditLog, updateDeliveryZone } = fakeDeps(OWN_CHAIN_ID)
    const useCase = new UpdateDeliveryZoneUseCase(onboardingFacade, auditLog)

    await expect(
      useCase.execute({ pharmacyId: 'pharmacy-1', rawBody: { maxDeliveryRadiusKm: -5 }, actor: ACTOR, requestId: null }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(updateDeliveryZone).not.toHaveBeenCalled()
  })

  it('maxDeliveryRadiusKm = 0 — ValidationError', async () => {
    const { onboardingFacade, auditLog } = fakeDeps(OWN_CHAIN_ID)
    const useCase = new UpdateDeliveryZoneUseCase(onboardingFacade, auditLog)

    await expect(
      useCase.execute({ pharmacyId: 'pharmacy-1', rawBody: { maxDeliveryRadiusKm: 0 }, actor: ACTOR, requestId: null }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('maxDeliveryRadiusKm = 51 (выше верхнего предела) — ValidationError', async () => {
    const { onboardingFacade, auditLog } = fakeDeps(OWN_CHAIN_ID)
    const useCase = new UpdateDeliveryZoneUseCase(onboardingFacade, auditLog)

    await expect(
      useCase.execute({ pharmacyId: 'pharmacy-1', rawBody: { maxDeliveryRadiusKm: 51 }, actor: ACTOR, requestId: null }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('pharmacy_admin сети A меняет аптеку сети B — CrossTenantAccessDeniedError (AC4)', async () => {
    const { onboardingFacade, auditLog, updateDeliveryZone } = fakeDeps(OTHER_CHAIN_ID)
    const useCase = new UpdateDeliveryZoneUseCase(onboardingFacade, auditLog)

    await expect(
      useCase.execute({ pharmacyId: 'pharmacy-1', rawBody: { maxDeliveryRadiusKm: 5 }, actor: ACTOR, requestId: null }),
    ).rejects.toBeInstanceOf(CrossTenantAccessDeniedError)
    expect(updateDeliveryZone).not.toHaveBeenCalled()
  })

  it('super_admin — владение не проверяется', async () => {
    const { onboardingFacade, auditLog, updateDeliveryZone } = fakeDeps(OTHER_CHAIN_ID)
    const useCase = new UpdateDeliveryZoneUseCase(onboardingFacade, auditLog)

    const result = await useCase.execute({
      pharmacyId: 'pharmacy-1',
      rawBody: { maxDeliveryRadiusKm: 5 },
      actor: { ...ACTOR, role: 'super_admin', chainId: null },
      requestId: null,
    })

    expect(result).toEqual(VIEW)
    expect(updateDeliveryZone).toHaveBeenCalled()
  })
})
