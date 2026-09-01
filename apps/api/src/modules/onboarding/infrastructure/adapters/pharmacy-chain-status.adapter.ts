/**
 * `PharmacyChainStatusAdapter` (DTJ-070) — реализация `PharmacyChainStatusPort`,
 * читает статус через `PharmacyChainRepository.findById`. Тонкая обёртка для
 * отделения интерфейса от данных (DI-подмена в тестах).
 */
import { Inject, Injectable } from '@nestjs/common'
import { PHARMACY_CHAIN_REPOSITORY, type PharmacyChainRepositoryPort } from '@/modules/onboarding/application/ports/pharmacy-chain.repository.port.js'
import type { OnboardingStatus } from '@/modules/onboarding/domain/value-objects/onboarding-status.vo.js'
import type { PharmacyChainStatusPort } from '@/modules/onboarding/application/ports/pharmacy-chain-status.port.js'

@Injectable()
export class PharmacyChainStatusAdapter implements PharmacyChainStatusPort {
  constructor(
    @Inject(PHARMACY_CHAIN_REPOSITORY)
    private readonly pharmacyChainRepository: PharmacyChainRepositoryPort,
  ) {}

  async getStatus(chainId: string): Promise<OnboardingStatus | null> {
    const chain = await this.pharmacyChainRepository.findById(chainId)
    return chain?.status ?? null
  }
}
