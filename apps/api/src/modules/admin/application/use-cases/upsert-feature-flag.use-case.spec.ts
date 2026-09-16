import { describe, expect, it, vi } from 'vitest'
import { ConflictError, ValidationError } from '@dorutj/contracts'
import type { Clock, IdGenerator } from '@/shared-kernel/index.js'
import { FeatureFlag } from '../../domain/feature-flag.entity.js'
import type { FeatureFlagsRepositoryPort } from '../ports/feature-flags-repository.port.js'
import { UpsertFeatureFlagUseCase, type UpsertFeatureFlagCommand } from './upsert-feature-flag.use-case.js'

const NOW = new Date('2026-09-16T10:00:00.000Z')
const TENANT_X = 'tenant-x'
const ACTOR = { userId: 'super-admin-1' }

class FixedClock implements Clock {
  now(): Date {
    return NOW
  }
}

class SequentialIds implements IdGenerator {
  private n = 0
  next(): string {
    this.n += 1
    return `generated-id-${String(this.n)}`
  }
}

function baseCommand(overrides: Partial<UpsertFeatureFlagCommand> = {}): UpsertFeatureFlagCommand {
  return {
    flagKey: 'disputes_workflow_enabled',
    scope: 'global',
    isEnabled: true,
    rolloutPercentage: 100,
    actor: ACTOR,
    ...overrides,
  }
}

function buildHarness(findByKeyResult: readonly FeatureFlag[] = []) {
  const upsertMock = vi.fn<FeatureFlagsRepositoryPort['upsert']>().mockImplementation((flag) => Promise.resolve(flag))
  const findByKeyMock = vi.fn<FeatureFlagsRepositoryPort['findByKey']>().mockResolvedValue(findByKeyResult)
  const repository: FeatureFlagsRepositoryPort = {
    findByKey: findByKeyMock,
    list: vi.fn(),
    upsert: upsertMock,
  }
  const useCase = new UpsertFeatureFlagUseCase(repository, new SequentialIds(), new FixedClock())
  return { useCase, upsertMock, findByKeyMock }
}

describe('UpsertFeatureFlagUseCase', () => {
  it('create (id не задан) — генерирует id через IdGenerator, updatedBy = actor.userId, вызывает repository.upsert', async () => {
    const { useCase, upsertMock } = buildHarness()

    const result = await useCase.execute(baseCommand())

    expect(upsertMock).toHaveBeenCalledTimes(1)
    const savedArg = upsertMock.mock.calls[0]?.[0]
    expect(savedArg?.id).toBe('generated-id-1')
    expect(savedArg?.updatedBy).toBe(ACTOR.userId)
    expect(savedArg?.updatedAt).toBe(NOW)
    expect(result.id).toBe('generated-id-1')
  })

  it('update (id задан из PATCH :id) — переиспользует переданный id, НЕ генерирует новый', async () => {
    const { useCase, upsertMock } = buildHarness()

    await useCase.execute(baseCommand({ id: 'existing-id' }))

    expect(upsertMock.mock.calls[0]?.[0]?.id).toBe('existing-id')
  })

  it('findByKey вызывается с (flagKey, tenantId) команды ДО upsert (pre-check конфликта)', async () => {
    const { useCase, findByKeyMock, upsertMock } = buildHarness()

    await useCase.execute(baseCommand({ scope: 'tenant', tenantId: TENANT_X }))

    expect(findByKeyMock).toHaveBeenCalledWith('disputes_workflow_enabled', TENANT_X)
    expect(upsertMock).toHaveBeenCalledTimes(1)
  })

  it('create с candidate того же (flagKey, scope, tenantId), но ДРУГИМ id → ConflictError, upsert НЕ вызывается', async () => {
    const conflicting = FeatureFlag.create(
      { id: 'other-id', flagKey: 'disputes_workflow_enabled', scope: 'global', isEnabled: false, rolloutPercentage: 100 },
      NOW,
    )
    const { useCase, upsertMock } = buildHarness([conflicting])

    await expect(useCase.execute(baseCommand())).rejects.toThrow(ConflictError)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('update своей ЖЕ записи (candidate.id === command.id) — НЕ считается конфликтом', async () => {
    const own = FeatureFlag.create(
      { id: 'existing-id', flagKey: 'disputes_workflow_enabled', scope: 'global', isEnabled: false, rolloutPercentage: 50 },
      NOW,
    )
    const { useCase, upsertMock } = buildHarness([own])

    await useCase.execute(baseCommand({ id: 'existing-id', rolloutPercentage: 80 }))

    expect(upsertMock).toHaveBeenCalledTimes(1)
  })

  it('невалидная команда (scope="tenant" без tenantId) → ValidationError из домена ДО repository.upsert', async () => {
    const { useCase, upsertMock } = buildHarness()

    await expect(useCase.execute(baseCommand({ scope: 'tenant' }))).rejects.toThrow(ValidationError)
    expect(upsertMock).not.toHaveBeenCalled()
  })
})
