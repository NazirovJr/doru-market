/**
 * `OnboardingFacadeAdapter` (`payments`, DTJ-252) — реализация ЭТОГО модуля `OnboardingFacadePort`
 * поверх публичного фасада `modules/onboarding/index.ts` (`OnboardingFacade`). Тот же приём, что
 * `orders/infrastructure/adapters/onboarding-facade.adapter.ts` (DTJ-227) — тонкая
 * проброс-обёртка, НЕ импорт того адаптера (он принадлежит `orders`, другому модулю).
 *
 * `SYSTEM_ACTOR_ID` — тот же nil-UUID, что `PharmacySuspensionController`/
 * `PharmacyVerificationRevocationController` (`onboarding/presentation/controllers/**`, DTJ-071):
 * вызывающий — ВСЕГДА системная джоба (`BillingInvoiceOverdueJob`, HTTP-мост), не
 * аутентифицированный человек — актора неоткуда взять из реального JWT (маршрут защищён
 * `PaymentsInternalServiceGuard`, не `AuthGuard`), константа фиксирует это явно, а не `null`/
 * пустую строку.
 */
import { Inject, Injectable } from '@nestjs/common'
import { OnboardingFacade } from '@/modules/onboarding/index.js'
import { ONBOARDING_FACADE_PORT, type OnboardingFacadePort } from '@/modules/payments/application/ports/onboarding-facade.port.js'

const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000'

@Injectable()
export class OnboardingFacadeAdapter implements OnboardingFacadePort {
  constructor(@Inject(OnboardingFacade) private readonly onboardingFacade: OnboardingFacade) {}

  suspendChain(chainId: string): Promise<void> {
    return this.onboardingFacade.suspendChainForUnpaidInvoice(chainId, { id: SYSTEM_ACTOR_ID })
  }
}

export const ONBOARDING_FACADE_PORT_PROVIDER = {
  provide: ONBOARDING_FACADE_PORT,
  useClass: OnboardingFacadeAdapter,
} as const
