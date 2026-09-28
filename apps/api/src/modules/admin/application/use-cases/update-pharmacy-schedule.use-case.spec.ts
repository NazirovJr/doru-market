import { describe, expect, it, vi } from 'vitest'
import { CrossTenantAccessDeniedError, ValidationError } from '@dorutj/contracts'
import { UpdatePharmacyScheduleUseCase } from './update-pharmacy-schedule.use-case.js'
import type { AuditLogPort } from '@/common/audit/audit-log.port.js'
import type { OnboardingFacadePort, PharmacyScheduleView } from '../ports/onboarding-facade.port.js'

const OWN_CHAIN_ID = 'chain-a'
const OTHER_CHAIN_ID = 'chain-b'
const VIEW: PharmacyScheduleView = { id: 'pharmacy-1', isOpen247: false, openingTime: '09:00', closingTime: '18:00' }

function fakeDeps(
  chainId: string | null,
): { onboardingFacade: OnboardingFacadePort; auditLog: AuditLogPort; updateSchedule: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> } {
  const getPharmacyChainId = vi.fn().mockResolvedValue(chainId)
  const updateSchedule = vi.fn().mockResolvedValue(VIEW)
  const write = vi.fn().mockResolvedValue(undefined)
  return {
    onboardingFacade: {
      findPharmacyAccountsAny: vi.fn(),
      getPharmacyChainId,
      getScheduleAndZone: vi.fn(),
      updateSchedule,
      updateDeliveryZone: vi.fn(),
      liftInvoiceBlock: vi.fn(),
      findChainNames: vi.fn(),
    },
    auditLog: { write },
    updateSchedule,
    write,
  }
}

const ACTOR = { userId: 'user-1', role: 'pharmacy_admin' as const, chainId: OWN_CHAIN_ID, tenantId: 'tenant-1' }

describe('UpdatePharmacyScheduleUseCase (DTJ-367)', () => {
  it('pharmacy_admin, своя аптека, валидное тело — сохраняет и пишет audit_log', async () => {
    const { onboardingFacade, auditLog, updateSchedule, write } = fakeDeps(OWN_CHAIN_ID)
    const useCase = new UpdatePharmacyScheduleUseCase(onboardingFacade, auditLog)

    const result = await useCase.execute({
      pharmacyId: 'pharmacy-1',
      rawBody: { isOpen247: false, openingTime: '09:00', closingTime: '18:00' },
      actor: ACTOR,
      requestId: 'req-1',
    })

    expect(result).toEqual(VIEW)
    expect(updateSchedule).toHaveBeenCalledWith(
      'pharmacy-1',
      { isOpen247: false, openingTime: '09:00', closingTime: '18:00' },
      { id: 'user-1' },
    )
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ category: 'pharmacy_settings_change', entityId: 'pharmacy-1' }))
  })

  it('isOpen247=false без openingTime/closingTime — ValidationError, facade НЕ вызывается', async () => {
    const { onboardingFacade, auditLog, updateSchedule } = fakeDeps(OWN_CHAIN_ID)
    const useCase = new UpdatePharmacyScheduleUseCase(onboardingFacade, auditLog)

    await expect(
      useCase.execute({ pharmacyId: 'pharmacy-1', rawBody: { isOpen247: false }, actor: ACTOR, requestId: null }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(updateSchedule).not.toHaveBeenCalled()
  })

  it('невалидный формат времени — ValidationError', async () => {
    const { onboardingFacade, auditLog } = fakeDeps(OWN_CHAIN_ID)
    const useCase = new UpdatePharmacyScheduleUseCase(onboardingFacade, auditLog)

    await expect(
      useCase.execute({
        pharmacyId: 'pharmacy-1',
        rawBody: { isOpen247: false, openingTime: '9:00', closingTime: '18:00' },
        actor: ACTOR,
        requestId: null,
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('pharmacy_admin сети A меняет аптеку сети B — CrossTenantAccessDeniedError, facade НЕ вызывается', async () => {
    const { onboardingFacade, auditLog, updateSchedule } = fakeDeps(OTHER_CHAIN_ID)
    const useCase = new UpdatePharmacyScheduleUseCase(onboardingFacade, auditLog)

    await expect(
      useCase.execute({
        pharmacyId: 'pharmacy-1',
        rawBody: { isOpen247: true },
        actor: ACTOR,
        requestId: null,
      }),
    ).rejects.toBeInstanceOf(CrossTenantAccessDeniedError)
    expect(updateSchedule).not.toHaveBeenCalled()
  })

  it('super_admin — владение не проверяется', async () => {
    const { onboardingFacade, auditLog, updateSchedule } = fakeDeps(OTHER_CHAIN_ID)
    const useCase = new UpdatePharmacyScheduleUseCase(onboardingFacade, auditLog)

    const result = await useCase.execute({
      pharmacyId: 'pharmacy-1',
      rawBody: { isOpen247: true },
      actor: { ...ACTOR, role: 'super_admin', chainId: null },
      requestId: null,
    })

    expect(result).toEqual(VIEW)
    expect(updateSchedule).toHaveBeenCalled()
  })
})
