/**
 * `OnboardingFacade` (DTJ-070) — ПУБЛИЧНЫЙ контракт модуля `onboarding` для
 * других модулей (EP-02 tenancy, EP-09 checkout). Реализует Facade-паттерн
 * из `02` §1.2: «несуществующая аптека» и «не активная аптека» для
 * потребителя-чекаута эквивалентны (SRS-ADM-015) — возвращаем `false`, не бросаем.
 */
import { Inject, Injectable } from '@nestjs/common'
import { PHARMACY_ACCOUNT_REPOSITORY, type PharmacyAccountRepositoryPort } from '@/modules/onboarding/application/ports/pharmacy-account.repository.port.js'
import { PHARMACY_CHAIN_REPOSITORY, type PharmacyChainRepositoryPort } from '@/modules/onboarding/application/ports/pharmacy-chain.repository.port.js'
import type { OnboardingStatus } from '@/modules/onboarding/domain/value-objects/onboarding-status.vo.js'
import type { PharmacySuspensionReason } from '@/modules/onboarding/domain/pharmacy-account-entity.types.js'

const CHAIN_STATUSES_ALLOWING_PHARMACY_ACTIVE: ReadonlySet<OnboardingStatus> = new Set<OnboardingStatus>([
  'approved',
  'active',
])

@Injectable()
export class OnboardingFacade {
  constructor(
    @Inject(PHARMACY_ACCOUNT_REPOSITORY)
    private readonly pharmacyAccountRepository: PharmacyAccountRepositoryPort,
    @Inject(PHARMACY_CHAIN_REPOSITORY)
    private readonly pharmacyChainRepository: PharmacyChainRepositoryPort,
  ) {}

  /** SRS-ADM-013: аптека доступна для чекаута только если `active` И сеть в `approved|active`. */
  async isPharmacyActive(pharmacyId: string): Promise<boolean> {
    const account = await this.pharmacyAccountRepository.findById(pharmacyId)
    if (account?.status !== 'active') {
      return false
    }
    const chain = await this.pharmacyChainRepository.findById(account.chainId)
    if (chain === null) {
      return false
    }
    return CHAIN_STATUSES_ALLOWING_PHARMACY_ACTIVE.has(chain.status)
  }

  /** SRS-ADM-015: возвращает причину приостановки (для внутренних логов/аудита, клиенту не утекает). */
  async getPharmacySuspensionReason(pharmacyId: string): Promise<PharmacySuspensionReason | null> {
    const account = await this.pharmacyAccountRepository.findById(pharmacyId)
    return account?.suspensionReason ?? null
  }

  /**
   * РАСШИРЕНИЕ (DTJ-227, EP-09 checkout) — отображаемые имена аптек по батчу id
   * (`OnboardingFacadePort.getPharmacyNames`, DTJ-225). `PharmacyAccountRepositoryPort` не
   * несёт батч-метода по id (`findById` — единственный, DTJ-063/070) — `Promise.all` по
   * одиночным `findById` внутри ЭТОГО модуля, а не N+1 через межмодульную границу (сам вызов
   * снаружи — ровно один `await facade.getPharmacyNames(ids)`). ПРАГМАТИЧНЫЙ выбор
   * (foundIssue, отчёт сдачи DTJ-227): реальный batch-SQL (`findByIds`) — улучшение вне
   * периметра этого тикета (правка `application/ports/pharmacy-account.repository.port.ts` +
   * Drizzle-реализации, чужой модуль). Несуществующая/удалённая аптека — молча пропускается в
   * `Map` (тот же приём, что `getMedicineSnapshot`), НЕ подставляется `pharmacyId` вместо
   * имени.
   */
  async getPharmacyNames(pharmacyIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const accounts = await Promise.all(pharmacyIds.map((id) => this.pharmacyAccountRepository.findById(id)))
    const out = new Map<string, string>()
    for (const account of accounts) {
      if (account !== null) {
        out.set(account.id, account.name)
      }
    }
    return out
  }

  /** Контракт для EP-02 DTJ-057 — провижининг тенанта с правами whitelabel. */
  async getChainEligibilityForWhitelabel(
    chainId: string,
  ): Promise<{ readonly status: OnboardingStatus; readonly isWhitelabelRequested: boolean } | null> {
    const chain = await this.pharmacyChainRepository.findById(chainId)
    if (chain === null) {
      return null
    }
    return { status: chain.status, isWhitelabelRequested: chain.isWhitelabelRequested }
  }
}
