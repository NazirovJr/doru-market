import { describe, expect, it, vi } from 'vitest'
import { RevokePharmacyApiKeyUseCase } from './revoke-pharmacy-api-key.use-case.js'
import type { PharmacyApiKeysRepository } from '../ports/pharmacy-api-keys.repository.port.js'

describe('RevokePharmacyApiKeyUseCase (DTJ-365)', () => {
  it('делегирует репозиторию и пробрасывает результат', async () => {
    const revoke = vi.fn().mockResolvedValue(true)
    const repository: PharmacyApiKeysRepository = {
      create: vi.fn(),
      listByPharmacy: vi.fn(),
      revoke,
      rotate: vi.fn(),
      setRequireMtls: vi.fn(),
      revokeExpiredRotated: vi.fn(),
    }
    const useCase = new RevokePharmacyApiKeyUseCase(repository)

    const result = await useCase.execute('pharmacy-1', 'key-1', 'скомпрометирован')

    expect(result).toBe(true)
    expect(revoke).toHaveBeenCalledWith('pharmacy-1', 'key-1', 'скомпрометирован')
  })

  it('не найдено/чужая аптека/уже отозван — false', async () => {
    const revoke = vi.fn().mockResolvedValue(false)
    const repository: PharmacyApiKeysRepository = {
      create: vi.fn(),
      listByPharmacy: vi.fn(),
      revoke,
      rotate: vi.fn(),
      setRequireMtls: vi.fn(),
      revokeExpiredRotated: vi.fn(),
    }
    const useCase = new RevokePharmacyApiKeyUseCase(repository)

    await expect(useCase.execute('pharmacy-1', 'key-1', 'reason')).resolves.toBe(false)
  })
})
