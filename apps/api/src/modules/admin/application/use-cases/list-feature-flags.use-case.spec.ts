import { describe, expect, it, vi } from 'vitest'
import { FeatureFlag } from '../../domain/feature-flag.entity.js'
import type { FeatureFlagsRepositoryPort } from '../ports/feature-flags-repository.port.js'
import { ListFeatureFlagsUseCase } from './list-feature-flags.use-case.js'

const NOW = new Date('2026-09-16T10:00:00.000Z')

function flag(flagKey: string): FeatureFlag {
  return FeatureFlag.create({ id: 'flag-1', flagKey, scope: 'global', isEnabled: true, rolloutPercentage: 100 }, NOW)
}

function buildHarness() {
  const listMock = vi.fn<FeatureFlagsRepositoryPort['list']>().mockResolvedValue({
    items: [flag('prescription_ocr_pipeline_enabled')],
    nextCursor: { v: 'prescription_ocr_pipeline_enabled', id: 'flag-1' },
    hasMore: true,
  })
  const repository: FeatureFlagsRepositoryPort = {
    findByKey: vi.fn(),
    list: listMock,
    upsert: vi.fn(),
  }
  const useCase = new ListFeatureFlagsUseCase(repository)
  return { useCase, listMock }
}

describe('ListFeatureFlagsUseCase', () => {
  it('передаёт limit/cursor из command в repository.list без изменений', async () => {
    const { useCase, listMock } = buildHarness()
    const cursor = { v: 'a', id: 'anchor' }

    await useCase.execute({ limit: 20, cursor })

    expect(listMock).toHaveBeenCalledWith({ limit: 20, cursor })
  })

  it('cursor отсутствует в command → repository.list получает cursor: null', async () => {
    const { useCase, listMock } = buildHarness()

    await useCase.execute({ limit: 20 })

    expect(listMock).toHaveBeenCalledWith({ limit: 20, cursor: null })
  })

  it('маппит доменные FeatureFlag в плоский FeatureFlagView, пробрасывает nextCursor/hasMore', async () => {
    const { useCase } = buildHarness()

    const result = await useCase.execute({ limit: 20 })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      id: 'flag-1',
      flagKey: 'prescription_ocr_pipeline_enabled',
      scope: 'global',
      tenantId: null,
      isEnabled: true,
      rolloutPercentage: 100,
    })
    expect(result.nextCursor).toEqual({ v: 'prescription_ocr_pipeline_enabled', id: 'flag-1' })
    expect(result.hasMore).toBe(true)
  })
})
