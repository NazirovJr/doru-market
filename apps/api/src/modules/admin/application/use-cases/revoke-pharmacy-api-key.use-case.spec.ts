import { describe, expect, it, vi } from 'vitest'
import { CrossTenantAccessDeniedError, NotFoundError } from '@dorutj/contracts'
import { RevokePharmacyApiKeyUseCase } from './revoke-pharmacy-api-key.use-case.js'
import type { OnboardingFacadePort } from '../ports/onboarding-facade.port.js'
import type { InventoryFacadePort } from '../ports/inventory-facade.port.js'
import type { AuditLogPort } from '@/common/audit/audit-log.port.js'

const OWN_CHAIN_ID = 'chain-a'
const OTHER_CHAIN_ID = 'chain-b'
const ACTOR_USER_ID = 'admin-1'

function fakeDeps(
  chainId: string | null,
  revoked: boolean,
): { onboardingFacade: OnboardingFacadePort; inventoryFacade: InventoryFacadePort; auditLog: AuditLogPort; revokePharmacyApiKey: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> } {
  const getPharmacyChainId = vi.fn().mockResolvedValue(chainId)
  const revokePharmacyApiKey = vi.fn().mockResolvedValue(revoked)
  const write = vi.fn().mockResolvedValue(undefined)
  return {
    onboardingFacade: {
      findPharmacyAccountsAny: vi.fn(),
      getPharmacyChainId,
      getScheduleAndZone: vi.fn(),
      updateSchedule: vi.fn(),
      updateDeliveryZone: vi.fn(),
    },
    inventoryFacade: {
      getInventorySummary: vi.fn(),
      createPharmacyApiKey: vi.fn(),
      listPharmacyApiKeys: vi.fn(),
      revokePharmacyApiKey,
      rotatePharmacyApiKey: vi.fn(),
      setPharmacyApiKeyMtls: vi.fn(),
    },
    auditLog: { write },
    revokePharmacyApiKey,
    write,
  }
}

describe('RevokePharmacyApiKeyUseCase (admin, DTJ-365)', () => {
  it('pharmacy_admin, своя аптека — отзывает и пишет audit_log', async () => {
    const { onboardingFacade, inventoryFacade, auditLog, revokePharmacyApiKey, write } = fakeDeps(OWN_CHAIN_ID, true)
    const useCase = new RevokePharmacyApiKeyUseCase(onboardingFacade, inventoryFacade, auditLog)

    await useCase.execute({ actor: { userId: ACTOR_USER_ID, role: 'pharmacy_admin', chainId: OWN_CHAIN_ID }, pharmacyId: 'pharmacy-1', keyId: 'key-1', reason: 'r', requestId: null })

    expect(revokePharmacyApiKey).toHaveBeenCalledWith('pharmacy-1', 'key-1', 'r')
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ category: 'pharmacy_api_key', action: 'revoke', entityId: 'key-1' }))
  })

  it('pharmacy_admin, чужая сеть — CrossTenantAccessDeniedError, facade НЕ вызывается', async () => {
    const { onboardingFacade, inventoryFacade, auditLog, revokePharmacyApiKey } = fakeDeps(OTHER_CHAIN_ID, true)
    const useCase = new RevokePharmacyApiKeyUseCase(onboardingFacade, inventoryFacade, auditLog)

    await expect(
      useCase.execute({ actor: { userId: ACTOR_USER_ID, role: 'pharmacy_admin', chainId: OWN_CHAIN_ID }, pharmacyId: 'pharmacy-1', keyId: 'key-1', reason: 'r', requestId: null }),
    ).rejects.toBeInstanceOf(CrossTenantAccessDeniedError)
    expect(revokePharmacyApiKey).not.toHaveBeenCalled()
  })

  it('facade вернул false (не найден/уже отозван) — NotFoundError, audit НЕ пишется', async () => {
    const { onboardingFacade, inventoryFacade, auditLog, write } = fakeDeps(OWN_CHAIN_ID, false)
    const useCase = new RevokePharmacyApiKeyUseCase(onboardingFacade, inventoryFacade, auditLog)

    await expect(
      useCase.execute({ actor: { userId: ACTOR_USER_ID, role: 'pharmacy_admin', chainId: OWN_CHAIN_ID }, pharmacyId: 'pharmacy-1', keyId: 'key-1', reason: 'r', requestId: null }),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(write).not.toHaveBeenCalled()
  })
})
