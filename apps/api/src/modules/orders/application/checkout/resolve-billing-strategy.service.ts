/**
 * `ResolveBillingStrategyService` (EP-09, DTJ-228, SRS-DOM-162, SRS-RET-006/009).
 *
 * Резолвит `orders.billing_strategy` — снэпшотится на checkout (`checkout.use-case.ts`), чтобы
 * возврат (EP-11, вне периметра этого тикета) знал, по какой стратегии проводилась оплата,
 * даже если тенант позже поменяет флаг.
 *
 * **D-EP09-33 (решение CTO, ADR утверждён, `reports/EP09-CTO-BRIEF.md`) — в R1 живёт ТОЛЬКО
 * `single_invoice`.** Ветка `split_items_delivery` физически неработоспособна: ей нужны
 * `payment_operations.billing_component` и `tenant_settings.useSplitBilling` (оба — EP-10,
 * `TODO(DTJ-242/244)`), которых в схеме нет. Это НЕ временный хардкод «пока не забыли
 * реализовать» — другой ответ сейчас был бы просто неверным (данных для него не существует).
 * Сервис — осознанный шов для будущего (`resolve()` уже принимает оба параметра, которые
 * понадобятся ветке `split_items_delivery`), а не заготовка полу-реализации: контракт метода
 * не изменится, когда TODO снимут, изменится только тело `if`.
 *
 * `BillingStrategy` — тип из `@dorutj/contracts` (не локальная декларация): домен
 * (`OrderCreateCommand`, DTJ-228 «подключение к CheckoutUseCase») несёт то же поле для
 * снэпшота `orders.billing_strategy`, и application/domain обязаны делить ОДИН тип, не два
 * синонима (правило 15 AGENTS.md).
 */
import { Injectable } from '@nestjs/common'
import type { BillingStrategy, OrderPaymentMethod } from '@dorutj/contracts'

export type { BillingStrategy }

@Injectable()
export class ResolveBillingStrategyService {
  /**
   * `cash_courier` → всегда `single_invoice` (раздельный биллинг бессмыслен без провайдера,
   * D-25 — наличные не проходят через эскроу вовсе). Non-cash в R1 — ТОЖЕ всегда
   * `single_invoice`: `useSplitBilling` недоступен (см. JSDoc файла), `tenantId` — параметр
   * контракта на будущее, сейчас не читается.
   */
  resolve(tenantId: string, paymentMethod: OrderPaymentMethod): BillingStrategy {
    // R1: оба параметра — контракт на будущее (DTJ-242/244), ни один пока не читается.
    // `void` вместо eslint-disable: `noUnusedParameters` в tsconfig подавлением ESLint не
    // снимается, и без этой строки красным становится `tsc` всего apps/api.
    void tenantId
    void paymentMethod
    // TODO(DTJ-242/244): non-cash + tenantSettings.useSplitBilling === true → 'split_items_delivery'.
    return 'single_invoice'
  }
}
