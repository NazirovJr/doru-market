import { describe, expect, it, vi } from 'vitest'
import type { OnboardingFacadePort, OnboardingReviewDurationStat } from '../ports/onboarding-facade.port.js'
import { GetOnboardingFunnelUseCase } from './get-onboarding-funnel.use-case.js'

function buildHarness(stats: readonly OnboardingReviewDurationStat[] = []) {
  const getReviewDurationStatsMock = vi.fn<OnboardingFacadePort['getReviewDurationStats']>().mockResolvedValue(stats)
  const onboardingFacade: OnboardingFacadePort = { getReviewDurationStats: getReviewDurationStatsMock }
  const useCase = new GetOnboardingFunnelUseCase(onboardingFacade)
  return { useCase, getReviewDurationStatsMock }
}

describe('GetOnboardingFunnelUseCase', () => {
  it('АС1 — тонкая делегация OnboardingFacadePort, обе группы решения приходят как есть', async () => {
    const stats: readonly OnboardingReviewDurationStat[] = [
      { decision: 'approved', averageDurationHours: 30, count: 7 },
      { decision: 'rejected', averageDurationHours: 12, count: 3 },
    ]
    const { useCase } = buildHarness(stats)

    const result = await useCase.execute({ tenantId: 'tenant-1', period: '2026-08' })

    expect(result).toEqual(stats)
  })

  it('не применяет собственную альтернативную формулу поверх значения порта (ДоД тикета)', async () => {
    const stats: readonly OnboardingReviewDurationStat[] = [{ decision: 'approved', averageDurationHours: 42, count: 1 }]
    const { useCase } = buildHarness(stats)

    const result = await useCase.execute({ tenantId: 'tenant-1', period: '2026-08' })

    expect(result[0]?.averageDurationHours).toBe(42)
  })

  it('АС3 — период без решённых заявок → пустой массив, не ошибка', async () => {
    const { useCase } = buildHarness([])

    const result = await useCase.execute({ tenantId: 'tenant-1', period: '2026-08' })

    expect(result).toEqual([])
  })

  it('передаёт tenantId и распарсенный период порту', async () => {
    const { useCase, getReviewDurationStatsMock } = buildHarness()

    await useCase.execute({ tenantId: 'tenant-1', period: '2026-08' })

    expect(getReviewDurationStatsMock).toHaveBeenCalledExactlyOnceWith(
      'tenant-1',
      expect.objectContaining({ start: expect.any(Date) as Date, end: expect.any(Date) as Date }),
    )
  })
})
