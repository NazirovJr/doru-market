import { describe, expect, it, vi } from 'vitest'
import { RevokeExpiredRotatedKeyUseCase } from './revoke-expired-rotated-key.use-case.js'
import type { PharmacyApiKeysRepository } from '../ports/pharmacy-api-keys.repository.port.js'
import type { Clock } from '@/shared-kernel/application/ports/clock.port.js'

const NOW = new Date('2026-01-02T00:00:00.000Z')

describe('RevokeExpiredRotatedKeyUseCase (DTJ-365)', () => {
  it('передаёт clock.now() в репозиторий и возвращает результат', async () => {
    const revokeExpiredRotated = vi.fn().mockResolvedValue(true)
    const repository: PharmacyApiKeysRepository = {
      create: vi.fn(),
      listByPharmacy: vi.fn(),
      revoke: vi.fn(),
      rotate: vi.fn(),
      setRequireMtls: vi.fn(),
      revokeExpiredRotated,
    }
    const clock: Clock = { now: () => NOW }
    const useCase = new RevokeExpiredRotatedKeyUseCase(repository, clock)

    await expect(useCase.execute('key-1')).resolves.toBe(true)
    expect(revokeExpiredRotated).toHaveBeenCalledWith('key-1', NOW)
  })
})
