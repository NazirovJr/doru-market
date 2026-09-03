/**
 * `OnboardingFacadeAdapter` (EP-09, DTJ-227) — реальная реализация `OnboardingFacadePort`
 * поверх публичного фасада `modules/onboarding/index.ts` (`OnboardingFacade`, DTJ-070,
 * `getPharmacyNames` — расширение этого тикета, см. `onboarding.facade.ts`). Заменяет
 * `UnimplementedOnboardingFacadeAdapter` (`orders.module.ts`, TODO(DTJ-227), D-EP09-19).
 *
 * Тонкая проброс-обёртка — обе сигнатуры уже 1:1 совпадают с `OnboardingFacade`, никакой
 * дополнительной логики (перевод «читать/бросать» уже сделан ВНУТРИ `OnboardingFacade`, порт
 * и фасад согласованы по семантике D-EP09-16 с момента DTJ-225).
 */
import { Inject, Injectable } from '@nestjs/common'
import { OnboardingFacade } from '@/modules/onboarding/index.js'
import {
  ONBOARDING_FACADE_PORT,
  type OnboardingFacadePort,
} from '@/modules/orders/application/ports/onboarding-facade.port.js'

@Injectable()
export class OnboardingFacadeAdapter implements OnboardingFacadePort {
  constructor(@Inject(OnboardingFacade) private readonly onboardingFacade: OnboardingFacade) {}

  isPharmacyActive(pharmacyId: string): Promise<boolean> {
    return this.onboardingFacade.isPharmacyActive(pharmacyId)
  }

  getPharmacyNames(pharmacyIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    return this.onboardingFacade.getPharmacyNames(pharmacyIds)
  }
}

export const ONBOARDING_FACADE_PORT_PROVIDER = {
  provide: ONBOARDING_FACADE_PORT,
  useClass: OnboardingFacadeAdapter,
} as const
