import { describe, expect, it, vi } from 'vitest'
import { OnboardingFacadeAdapter } from './onboarding-facade.adapter.js'
import type { OnboardingFacade } from '@/modules/onboarding/index.js'

const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000'

describe('OnboardingFacadeAdapter (DTJ-252)', () => {
  it('suspendChain делегирует OnboardingFacade.suspendChainForUnpaidInvoice с системным актором', async () => {
    // Отдельная переменная (не `onboardingFacade.suspendChainForUnpaidInvoice`) — @typescript-eslint/unbound-method.
    const suspendChainForUnpaidInvoice = vi.fn().mockResolvedValue(undefined)
    const onboardingFacade = { suspendChainForUnpaidInvoice } as unknown as OnboardingFacade
    const adapter = new OnboardingFacadeAdapter(onboardingFacade)

    await adapter.suspendChain('chain-1')

    expect(suspendChainForUnpaidInvoice).toHaveBeenCalledWith('chain-1', { id: SYSTEM_ACTOR_ID })
  })
})
