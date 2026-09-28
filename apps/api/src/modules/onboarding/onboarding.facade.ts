/**
 * `OnboardingFacade` (DTJ-070) — ПУБЛИЧНЫЙ контракт модуля `onboarding` для
 * других модулей (EP-02 tenancy, EP-09 checkout). Реализует Facade-паттерн
 * из `02` §1.2: «несуществующая аптека» и «не активная аптека» для
 * потребителя-чекаута эквивалентны (SRS-ADM-015) — возвращаем `false`, не бросаем.
 */
import { Inject, Injectable } from '@nestjs/common'
import { NotFoundError } from '@dorutj/contracts'
import { PHARMACY_ACCOUNT_REPOSITORY, type PharmacyAccountRepositoryPort } from '@/modules/onboarding/application/ports/pharmacy-account.repository.port.js'
import { PHARMACY_CHAIN_REPOSITORY, type PharmacyChainRepositoryPort } from '@/modules/onboarding/application/ports/pharmacy-chain.repository.port.js'
import {
  ONBOARDING_REVIEW_LOG_REPOSITORY,
  type OnboardingReviewDurationStat,
  type OnboardingReviewLogRepositoryPort,
  type OnboardingReviewPeriodRange,
} from '@/modules/onboarding/application/ports/onboarding-review-log.repository.port.js'
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
    @Inject(ONBOARDING_REVIEW_LOG_REPOSITORY)
    private readonly reviewLogRepository: OnboardingReviewLogRepositoryPort,
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

  /** Для cross-tenant policy-проверок других модулей (несуществующая аптека — null, не throw). */
  async getPharmacyChainId(pharmacyId: string): Promise<string | null> {
    const account = await this.pharmacyAccountRepository.findById(pharmacyId)
    return account?.chainId ?? null
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

  async listActivePharmacyIds(tenantId: string): Promise<readonly string[]> {
    return this.pharmacyAccountRepository.listActiveIdsByTenant(tenantId)
  }

  // РАСШИРЕНИЕ (DTJ-353), тот же приём, что getPharmacyNames — имя сети догружается батчем по
  // уникальным chainId страницы, не всей таблицы.
  async findPharmacyAccountsAny(
    filter: { readonly status?: string; readonly chainId?: string; readonly nameLike?: string },
    pagination: { readonly limit: number; readonly cursor?: { readonly v: string; readonly id: string } | null },
  ): Promise<{
    readonly items: readonly {
      readonly id: string
      readonly chainId: string | null
      readonly chainName: string | null
      readonly name: string
      readonly status: string
      readonly licenseExpiryDate: Date | null
    }[]
    readonly nextCursor: { readonly v: string; readonly id: string } | null
    readonly hasMore: boolean
  }> {
    const page = await this.pharmacyAccountRepository.listAny({ filter, limit: pagination.limit, cursor: pagination.cursor ?? null })
    const chainNames = await this.resolveChainNames(page.items.map((item) => item.chainId))
    return {
      items: page.items.map((item) => ({ ...item, chainName: item.chainId === null ? null : (chainNames.get(item.chainId) ?? null) })),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    }
  }

  private async resolveChainNames(chainIds: readonly (string | null)[]): Promise<ReadonlyMap<string, string>> {
    const uniqueIds = [...new Set(chainIds.filter((id): id is string => id !== null))]
    const chains = await Promise.all(uniqueIds.map((id) => this.pharmacyChainRepository.findById(id)))
    const out = new Map<string, string>()
    for (const chain of chains) {
      if (chain !== null) {
        out.set(chain.id, chain.name)
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

  /**
   * РАСШИРЕНИЕ (DTJ-252, REQ-MON-9, SRS-DOM-161) — `pharmacy_chains.status: active → suspended`
   * за неоплаченный B2B-инвойс `cash_courier`-комиссии (`BillingInvoiceOverdueJob`,
   * `apps/worker` → HTTP-мост `payments/presentation/internal/suspend-chain-for-unpaid-invoice.
   * controller.ts` → этот метод). Публикуется здесь, а не только в `payments`, потому что
   * `pharmacy_chains` — таблица `onboarding` (Группа A) — ЕДИНАЯ точка домена, читающая/
   * пишущая её `status`, тот же приём, что `isPharmacyActive` ниже (тикет DTJ-252, «Технический
   * контекст»: переиспользует ТУ ЖЕ ветку приостановки, не дублирует `is_active`-подобное поле).
   *
   * Идемпотентно: уже `suspended` → no-op, БЕЗ повторной записи (джоба может честно повторить
   * вызов на следующий тик, если предыдущий HTTP-ответ потерялся в сети — тот же класс защиты,
   * что `PayoutScheduleRepository.insertPending`'s `ON CONFLICT DO NOTHING`, DTJ-244).
   *
   * Несуществующий `chainId` — `NotFoundError` (В ОТЛИЧИЕ от `isPharmacyActive` ниже, где
   * «несуществующая аптека» осознанно эквивалентна «неактивной», SRS-ADM-015): здесь вызывающий
   * — СИСТЕМНАЯ джоба, читающая `chain_id` из реальной строки `platform_billing_invoices` (FK
   * на `pharmacy_chains`) — несуществующий id указывает на рассинхронизацию данных, о которой
   * стоит узнать явно, не проглотить молча.
   *
   * Чужой НЕ-`active`/НЕ-`suspended` статус (`draft`/`pending_review`/`terminated`/...) —
   * `chain.suspend()` бросает `InvalidOnboardingTransitionError` (её `assertTransitionAllowed`) —
   * пробрасывается вызывающему (HTTP 4xx/5xx через `AllExceptionsFilter`), джоба логирует и
   * повторяет попытку на следующий тик (`Promise.allSettled`, не роняя остальной батч).
   */
  async suspendChainForUnpaidInvoice(chainId: string, actor: { readonly id: string }): Promise<void> {
    const chain = await this.pharmacyChainRepository.findById(chainId)
    if (chain === null) {
      throw new NotFoundError({ chainId })
    }
    if (chain.status === 'suspended') {
      return
    }
    await this.pharmacyChainRepository.save(chain.suspend(actor, 'unpaid_invoice'))
  }

  /** DTJ-367 — текущие значения формы `admin`-кабинета ДО первого PATCH. Несуществующая аптека — null. */
  async getScheduleAndZone(
    pharmacyId: string,
  ): Promise<{
    readonly id: string
    readonly isOpen247: boolean
    readonly openingTime: string | null
    readonly closingTime: string | null
    readonly maxDeliveryRadiusKm: number
  } | null> {
    const account = await this.pharmacyAccountRepository.findById(pharmacyId)
    if (account === null) {
      return null
    }
    return {
      id: account.id,
      isOpen247: account.isOpen24x7,
      openingTime: account.openingTime,
      closingTime: account.closingTime,
      maxDeliveryRadiusKm: account.maxDeliveryRadiusKm,
    }
  }

  /** DTJ-367 (SRS-ADM-049) — `admin`-расширение: расписание работы точки, `status` не меняется. */
  async updateSchedule(
    pharmacyId: string,
    update: { readonly isOpen247: boolean; readonly openingTime: string | null; readonly closingTime: string | null },
    actor: { readonly id: string },
  ): Promise<{ readonly id: string; readonly isOpen247: boolean; readonly openingTime: string | null; readonly closingTime: string | null }> {
    void actor
    const account = await this.pharmacyAccountRepository.findById(pharmacyId)
    if (account === null) {
      throw new NotFoundError({ pharmacyId })
    }
    const updated = account.updateSchedule(update)
    await this.pharmacyAccountRepository.save(updated)
    return { id: updated.id, isOpen247: updated.isOpen24x7, openingTime: updated.openingTime, closingTime: updated.closingTime }
  }

  /** DTJ-367 (SRS-ADM-050) — `admin`-расширение: круговая зона доставки, `status` не меняется. */
  async updateDeliveryZone(
    pharmacyId: string,
    update: { readonly maxDeliveryRadiusKm: number },
    actor: { readonly id: string },
  ): Promise<{ readonly id: string; readonly maxDeliveryRadiusKm: number }> {
    void actor
    const account = await this.pharmacyAccountRepository.findById(pharmacyId)
    if (account === null) {
      throw new NotFoundError({ pharmacyId })
    }
    const updated = account.updateDeliveryZone(update)
    await this.pharmacyAccountRepository.save(updated)
    return { id: updated.id, maxDeliveryRadiusKm: updated.maxDeliveryRadiusKm }
  }

  /** DTJ-384 (гостевое расширение из EP-17, `modules/analytics`) — тонкая делегация порту, без своей формулы. */
  async getReviewDurationStats(
    tenantId: string,
    period: OnboardingReviewPeriodRange,
  ): Promise<readonly OnboardingReviewDurationStat[]> {
    return this.reviewLogRepository.getReviewDurationStats(tenantId, period)
  }

  /** Обратный переход `suspendChainForUnpaidInvoice` — `tx` опционален, для атомарности с audit_log. */
  async liftInvoiceBlock(chainId: string, actor: { readonly id: string }, tx?: unknown): Promise<void> {
    const chain = await this.pharmacyChainRepository.findById(chainId, tx)
    if (chain === null) {
      throw new NotFoundError({ chainId })
    }
    await this.pharmacyChainRepository.save(chain.liftInvoiceBlock(actor), tx)
  }

  /** Батч-имена сетей, тот же приём, что `getPharmacyNames` выше. */
  async findChainNames(chainIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    return this.resolveChainNames(chainIds)
  }
}
