import { describe, expect, it, vi } from 'vitest'
import { ListPharmacyApiKeysUseCase } from './list-pharmacy-api-keys.use-case.js'
import type { PharmacyApiKeySummary, PharmacyApiKeysRepository } from '../ports/pharmacy-api-keys.repository.port.js'

const SUMMARIES: readonly PharmacyApiKeySummary[] = [
  { id: 'key-1', keyPrefix: 'abc123de', isActive: true, createdAt: new Date('2026-01-01') },
]

describe('ListPharmacyApiKeysUseCase (DTJ-365)', () => {
  it('делегирует репозиторию, БЕЗ полных значений секрета (TC-ADM-017)', async () => {
    const listByPharmacy = vi.fn().mockResolvedValue(SUMMARIES)
    const repository: PharmacyApiKeysRepository = { create: vi.fn(), listByPharmacy, revoke: vi.fn() }
    const useCase = new ListPharmacyApiKeysUseCase(repository)

    const result = await useCase.execute('pharmacy-1')

    expect(result).toBe(SUMMARIES)
    expect(listByPharmacy).toHaveBeenCalledWith('pharmacy-1')
  })
})
