import { describe, expect, it, vi } from 'vitest'
import { OnboardingFacadeAdapter } from './onboarding-facade.adapter.js'
import type { OnboardingFacade } from '@/modules/onboarding/index.js'
import type { OnboardingReviewDurationStat } from '@/modules/analytics/application/ports/onboarding-facade.port.js'

function fakeOnboarding(stats: readonly OnboardingReviewDurationStat[]): OnboardingFacade {
  return { getReviewDurationStats: vi.fn().mockResolvedValue(stats) } as unknown as OnboardingFacade
}

describe('OnboardingFacadeAdapter.getReviewDurationStats (DTJ-384)', () => {
  it('пробрасывает результат OnboardingFacade.getReviewDurationStats как есть', async () => {
    const stats: readonly OnboardingReviewDurationStat[] = [{ decision: 'approved', averageDurationHours: 30, count: 7 }]
    const adapter = new OnboardingFacadeAdapter(fakeOnboarding(stats))
    const period = { start: new Date('2026-08-01'), end: new Date('2026-09-01') }

    await expect(adapter.getReviewDurationStats('tenant-1', period)).resolves.toEqual(stats)
  })
})
