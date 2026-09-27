import { describe, expect, it, vi } from 'vitest'
import { CrossTenantAccessDeniedError, NotFoundError } from '@dorutj/contracts'
import { RotatePharmacyApiKeyUseCase } from './rotate-pharmacy-api-key.use-case.js'
import type { OnboardingFacadePort } from '../ports/onboarding-facade.port.js'
import type { CreatedPharmacyApiKeyView, InventoryFacadePort } from '../ports/inventory-facade.port.js'
import type { AuditLogPort } from '@/common/audit/audit-log.port.js'
import type { AppConfigService } from '@/config/app-config.service.js'

const ROTATED: CreatedPharmacyApiKeyView = { id: 'key-2', secret: 'secret2', keyPrefix: 'secret2x', createdAt: new Date('2026-01-02') }
const OWN_CHAIN_ID = 'chain-a'
const OTHER_CHAIN_ID = 'chain-b'
const ACTOR_USER_ID = 'admin-1'
const GRACE_HOURS = 24

function fakeDeps(
  chainId: string | null,
  rotateResult: CreatedPharmacyApiKeyView | null,
): {
  onboardingFacade: OnboardingFacadePort
  inventoryFacade: InventoryFacadePort
  auditLog: AuditLogPort
  config: AppConfigService
  rotatePharmacyApiKey: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
} {
  const getPharmacyChainId = vi.fn().mockResolvedValue(chainId)
  const rotatePharmacyApiKey = vi.fn().mockResolvedValue(rotateResult)
  const write = vi.fn().mockResolvedValue(undefined)
  return {
    onboardingFacade: { findPharmacyAccountsAny: vi.fn(), getPharmacyChainId },
    inventoryFacade: {
      getInventorySummary: vi.fn(),
      createPharmacyApiKey: vi.fn(),
      listPharmacyApiKeys: vi.fn(),
      revokePharmacyApiKey: vi.fn(),
      rotatePharmacyApiKey,
      setPharmacyApiKeyMtls: vi.fn(),
    },
    auditLog: { write },
    config: { apiKeyRotationGracePeriodHours: GRACE_HOURS } as AppConfigService,
    rotatePharmacyApiKey,
    write,
  }
}

describe('RotatePharmacyApiKeyUseCase (admin, DTJ-365)', () => {
  it('pharmacy_admin, своя аптека — ротирует с грейс-периодом из ConfigService и пишет audit_log', async () => {
    const { onboardingFacade, inventoryFacade, auditLog, config, rotatePharmacyApiKey, write } = fakeDeps(OWN_CHAIN_ID, ROTATED)
    const useCase = new RotatePharmacyApiKeyUseCase(onboardingFacade, inventoryFacade, auditLog, config)

    const result = await useCase.execute({ actor: { userId: ACTOR_USER_ID, role: 'pharmacy_admin', chainId: OWN_CHAIN_ID }, pharmacyId: 'pharmacy-1', oldKeyId: 'key-1', requestId: null })

    expect(result).toBe(ROTATED)
    expect(rotatePharmacyApiKey).toHaveBeenCalledWith({ pharmacyId: 'pharmacy-1', oldKeyId: 'key-1', gracePeriodHours: GRACE_HOURS, createdByAdminId: ACTOR_USER_ID })
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ category: 'pharmacy_api_key', action: 'rotate', entityId: 'key-2' }))
  })

  it('pharmacy_admin, чужая сеть — CrossTenantAccessDeniedError, facade НЕ вызывается', async () => {
    const { onboardingFacade, inventoryFacade, auditLog, config, rotatePharmacyApiKey } = fakeDeps(OTHER_CHAIN_ID, ROTATED)
    const useCase = new RotatePharmacyApiKeyUseCase(onboardingFacade, inventoryFacade, auditLog, config)

    await expect(
      useCase.execute({ actor: { userId: ACTOR_USER_ID, role: 'pharmacy_admin', chainId: OWN_CHAIN_ID }, pharmacyId: 'pharmacy-1', oldKeyId: 'key-1', requestId: null }),
    ).rejects.toBeInstanceOf(CrossTenantAccessDeniedError)
    expect(rotatePharmacyApiKey).not.toHaveBeenCalled()
  })

  it('старый ключ не найден/уже отозван — NotFoundError, audit НЕ пишется', async () => {
    const { onboardingFacade, inventoryFacade, auditLog, config, write } = fakeDeps(OWN_CHAIN_ID, null)
    const useCase = new RotatePharmacyApiKeyUseCase(onboardingFacade, inventoryFacade, auditLog, config)

    await expect(
      useCase.execute({ actor: { userId: ACTOR_USER_ID, role: 'pharmacy_admin', chainId: OWN_CHAIN_ID }, pharmacyId: 'pharmacy-1', oldKeyId: 'key-1', requestId: null }),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(write).not.toHaveBeenCalled()
  })
})
