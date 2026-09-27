import { describe, expect, it, vi } from 'vitest'
import { CreatePharmacyApiKeyUseCase } from './create-pharmacy-api-key.use-case.js'
import type { CreatedPharmacyApiKey, PharmacyApiKeysRepository } from '../ports/pharmacy-api-keys.repository.port.js'

const CREATED: CreatedPharmacyApiKey = { id: 'key-1', secret: 'abc123', keyPrefix: 'abc123def', createdAt: new Date('2026-01-01') }

describe('CreatePharmacyApiKeyUseCase (DTJ-365)', () => {
  it('делегирует репозиторию и возвращает секрет РОВНО в этом ответе', async () => {
    const create = vi.fn().mockResolvedValue(CREATED)
    const repository: PharmacyApiKeysRepository = {
      create,
      listByPharmacy: vi.fn(),
      revoke: vi.fn(),
      rotate: vi.fn(),
      setRequireMtls: vi.fn(),
      revokeExpiredRotated: vi.fn(),
    }
    const useCase = new CreatePharmacyApiKeyUseCase(repository)

    const result = await useCase.execute('pharmacy-1', 'admin-1')

    expect(result).toBe(CREATED)
    expect(create).toHaveBeenCalledWith('pharmacy-1', 'admin-1')
  })
})
