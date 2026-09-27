import { describe, expect, it, vi } from 'vitest'
import { SetPharmacyApiKeyMtlsUseCase } from './set-pharmacy-api-key-mtls.use-case.js'
import type { PharmacyApiKeySummary, PharmacyApiKeysRepository } from '../ports/pharmacy-api-keys.repository.port.js'

const SUMMARY: PharmacyApiKeySummary = { id: 'key-1', keyPrefix: 'abc12345', isActive: true, requireMtls: true, createdAt: new Date('2026-01-01'), lastUsedAt: null, revokedAt: null }

describe('SetPharmacyApiKeyMtlsUseCase (DTJ-365)', () => {
  it('делегирует репозиторию', async () => {
    const setRequireMtls = vi.fn().mockResolvedValue(SUMMARY)
    const repository: PharmacyApiKeysRepository = { create: vi.fn(), listByPharmacy: vi.fn(), revoke: vi.fn(), rotate: vi.fn(), setRequireMtls, revokeExpiredRotated: vi.fn() }
    const useCase = new SetPharmacyApiKeyMtlsUseCase(repository)

    const result = await useCase.execute('pharmacy-1', 'key-1', true)

    expect(result).toBe(SUMMARY)
    expect(setRequireMtls).toHaveBeenCalledWith('pharmacy-1', 'key-1', true)
  })

  it('не найдено/чужая аптека — null', async () => {
    const repository: PharmacyApiKeysRepository = { create: vi.fn(), listByPharmacy: vi.fn(), revoke: vi.fn(), rotate: vi.fn(), setRequireMtls: vi.fn().mockResolvedValue(null), revokeExpiredRotated: vi.fn() }
    const useCase = new SetPharmacyApiKeyMtlsUseCase(repository)

    await expect(useCase.execute('pharmacy-1', 'key-1', true)).resolves.toBeNull()
  })
})
