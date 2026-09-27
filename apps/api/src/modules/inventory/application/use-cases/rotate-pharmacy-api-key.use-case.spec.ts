import { describe, expect, it, vi } from 'vitest'
import { RotatePharmacyApiKeyUseCase } from './rotate-pharmacy-api-key.use-case.js'
import type { CreatedPharmacyApiKey, PharmacyApiKeysRepository, RotatePharmacyApiKeyParams } from '../ports/pharmacy-api-keys.repository.port.js'

const NEW_KEY: CreatedPharmacyApiKey = { id: 'key-2', secret: 'secret2', keyPrefix: 'secret2x', createdAt: new Date('2026-01-02') }
const PARAMS: RotatePharmacyApiKeyParams = { pharmacyId: 'pharmacy-1', oldKeyId: 'key-1', gracePeriodHours: 24, createdByAdminId: 'admin-1' }

function fakeRepository(rotateResult: CreatedPharmacyApiKey | null): { repository: PharmacyApiKeysRepository; rotate: ReturnType<typeof vi.fn> } {
  const rotate = vi.fn().mockResolvedValue(rotateResult)
  return {
    repository: { create: vi.fn(), listByPharmacy: vi.fn(), revoke: vi.fn(), rotate, setRequireMtls: vi.fn(), revokeExpiredRotated: vi.fn() },
    rotate,
  }
}

describe('RotatePharmacyApiKeyUseCase (DTJ-365)', () => {
  it('делегирует репозиторию с грейс-периодом и actorId', async () => {
    const { repository, rotate } = fakeRepository(NEW_KEY)
    const useCase = new RotatePharmacyApiKeyUseCase(repository)

    const result = await useCase.execute(PARAMS)

    expect(result).toBe(NEW_KEY)
    expect(rotate).toHaveBeenCalledWith(PARAMS)
  })

  it('старый ключ не найден/чужая аптека/уже отозван — null', async () => {
    const { repository } = fakeRepository(null)
    const useCase = new RotatePharmacyApiKeyUseCase(repository)

    await expect(useCase.execute(PARAMS)).resolves.toBeNull()
  })
})
