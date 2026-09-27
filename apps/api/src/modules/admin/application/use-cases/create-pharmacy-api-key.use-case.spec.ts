import { describe, expect, it, vi } from 'vitest'
import { CrossTenantAccessDeniedError } from '@dorutj/contracts'
import { CreatePharmacyApiKeyUseCase } from './create-pharmacy-api-key.use-case.js'
import type { OnboardingFacadePort } from '../ports/onboarding-facade.port.js'
import type { CreatedPharmacyApiKeyView, InventoryFacadePort } from '../ports/inventory-facade.port.js'
import type { AuditLogPort } from '@/common/audit/audit-log.port.js'

const SECRET_VALUE = 'topsecretvalue999'
const CREATED: CreatedPharmacyApiKeyView = { id: 'key-1', secret: SECRET_VALUE, keyPrefix: 'abc12345', createdAt: new Date('2026-01-01') }
const OWN_CHAIN_ID = 'chain-a'
const OTHER_CHAIN_ID = 'chain-b'
const ACTOR_USER_ID = 'admin-1'

function fakeDeps(chainId: string | null): {
  onboardingFacade: OnboardingFacadePort
  inventoryFacade: InventoryFacadePort
  auditLog: AuditLogPort
  getPharmacyChainId: ReturnType<typeof vi.fn>
  createPharmacyApiKey: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
} {
  const getPharmacyChainId = vi.fn().mockResolvedValue(chainId)
  const createPharmacyApiKey = vi.fn().mockResolvedValue(CREATED)
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
      createPharmacyApiKey,
      listPharmacyApiKeys: vi.fn(),
      revokePharmacyApiKey: vi.fn(),
      rotatePharmacyApiKey: vi.fn(),
      setPharmacyApiKeyMtls: vi.fn(),
    },
    auditLog: { write },
    getPharmacyChainId,
    createPharmacyApiKey,
    write,
  }
}

describe('CreatePharmacyApiKeyUseCase (admin, DTJ-365)', () => {
  it('pharmacy_admin, своя аптека — создаёт ключ и пишет audit_log БЕЗ секрета', async () => {
    const { onboardingFacade, inventoryFacade, auditLog, createPharmacyApiKey, write } = fakeDeps(OWN_CHAIN_ID)
    const useCase = new CreatePharmacyApiKeyUseCase(onboardingFacade, inventoryFacade, auditLog)

    const result = await useCase.execute({
      actor: { userId: ACTOR_USER_ID, role: 'pharmacy_admin', chainId: OWN_CHAIN_ID },
      pharmacyId: 'pharmacy-1',
      requestId: 'req-1',
    })

    expect(result).toBe(CREATED)
    expect(createPharmacyApiKey).toHaveBeenCalledWith('pharmacy-1', ACTOR_USER_ID)
    const entry = write.mock.calls[0]?.[0] as { readonly metadata: { readonly after: Record<string, unknown> } }
    expect(entry.metadata.after).toEqual({ pharmacyId: 'pharmacy-1', keyPrefix: 'abc12345' })
    expect(JSON.stringify(entry)).not.toContain(SECRET_VALUE)
  })

  it('pharmacy_admin, чужая сеть (DTJ-365 AC4) — CrossTenantAccessDeniedError, facade и audit НЕ вызываются', async () => {
    const { onboardingFacade, inventoryFacade, auditLog, createPharmacyApiKey, write } = fakeDeps(OTHER_CHAIN_ID)
    const useCase = new CreatePharmacyApiKeyUseCase(onboardingFacade, inventoryFacade, auditLog)

    await expect(
      useCase.execute({ actor: { userId: ACTOR_USER_ID, role: 'pharmacy_admin', chainId: OWN_CHAIN_ID }, pharmacyId: 'pharmacy-1', requestId: null }),
    ).rejects.toBeInstanceOf(CrossTenantAccessDeniedError)
    expect(createPharmacyApiKey).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it('super_admin — владение не проверяется', async () => {
    const { onboardingFacade, inventoryFacade, auditLog, getPharmacyChainId, createPharmacyApiKey } = fakeDeps(OTHER_CHAIN_ID)
    const useCase = new CreatePharmacyApiKeyUseCase(onboardingFacade, inventoryFacade, auditLog)

    const result = await useCase.execute({ actor: { userId: ACTOR_USER_ID, role: 'super_admin', chainId: null }, pharmacyId: 'pharmacy-1', requestId: null })

    expect(result).toBe(CREATED)
    expect(getPharmacyChainId).not.toHaveBeenCalled()
    expect(createPharmacyApiKey).toHaveBeenCalledWith('pharmacy-1', ACTOR_USER_ID)
  })
})
