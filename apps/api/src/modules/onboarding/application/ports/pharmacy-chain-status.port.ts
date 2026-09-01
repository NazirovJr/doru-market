/**
 * `PharmacyChainStatusPort` (DTJ-070) — внутримодульный порт, потребляемый
 * ДОМЕНОМ этого же модуля в `PharmacyAccount.activate()` (SRS-DOM-048).
 * Реализация — в `infrastructure/adapters/pharmacy-chain-status.adapter.ts`,
 * читает `PharmacyChainRepository` напрямую (один bounded context).
 */
import type { OnboardingStatus } from '@/modules/onboarding/domain/value-objects/onboarding-status.vo.js'

export const PHARMACY_CHAIN_STATUS = Symbol.for('@dorutj/onboarding/pharmacy-chain-status')

export interface PharmacyChainStatusPort {
  getStatus(chainId: string): Promise<OnboardingStatus | null>
}
