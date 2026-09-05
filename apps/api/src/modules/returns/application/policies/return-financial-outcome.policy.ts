/**
 * `ReturnFinancialOutcomeResolver` (EP-11, DTJ-272) — таблица «вина → денежный исход»
 * (`21-module-orders-payments-escrow.md` §7.2, SRS-RET-004/005). Кто платит за брак — аптека,
 * курьер или никто — решается ЗДЕСЬ, объектом-константой, а не разбросанными `if/else` по
 * use case'ам (DTJ-274) — прямой канал финансовой ошибки иначе.
 *
 * `application/policies/` (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §3 — политика расчёта, зависящая
 * от внешнего контекста «кто виноват», не инвариант самой сущности `OrderReturn`, поэтому не в
 * `domain/`). Принимает готовые VO `returns`-домена (`ReturnReason`/`ReturnDisposition`), не
 * примитивные строки — `02` §2.3 (Value Objects обязательны, primitive obsession — запах).
 *
 * Метод — чистая функция (C18): не читает БД, не вызывает порты, только маппинг вход→выход.
 */
import { Injectable } from '@nestjs/common'
import type { ReturnReason, ReturnDisposition } from '../../domain/index.js'
import { UnsupportedReturnReasonError } from '../../domain/index.js'
import type { ReturnFinancialOutcome } from './return-financial-outcome.types.js'

const FULL_REFUND: ReturnFinancialOutcome = { itemsRefund: 'full', deliveryFeeRefund: 'full', courierReturnFeeApplies: true }
const ITEMS_ONLY_REFUND: ReturnFinancialOutcome = { itemsRefund: 'full', deliveryFeeRefund: 'none', courierReturnFeeApplies: true }
const NO_REFUND: ReturnFinancialOutcome = { itemsRefund: 'none', deliveryFeeRefund: 'none', courierReturnFeeApplies: true }

/**
 * Таблица правил SRS-RET-004 — все причины, КРОМЕ `undelivered` (не резолвится этой политикой
 * вовсе, см. `resolve()`) и `customer_dispute_post_delivery` (зависит от `disposition`, не
 * укладывается в статическую таблицу «причина → фиксированный исход», см. `resolve()`).
 */
const STATIC_OUTCOMES_BY_REASON: Readonly<
  Record<'defect' | 'wrong_item' | 'damaged_packaging' | 'expired_or_near_expiry' | 'refused_at_door' | 'undeliverable', ReturnFinancialOutcome>
> = {
  defect: FULL_REFUND,
  wrong_item: FULL_REFUND,
  damaged_packaging: FULL_REFUND,
  expired_or_near_expiry: FULL_REFUND,
  refused_at_door: ITEMS_ONLY_REFUND,
  undeliverable: ITEMS_ONLY_REFUND,
}

@Injectable()
export class ReturnFinancialOutcomeResolver {
  /**
   * `reason='undelivered'` — программная ошибка вызывающего кода (SRS-RET-003, эта причина
   * обрабатывается через `OrderDispute`/`SupportFacade`, не через возврат): бросает
   * `UnsupportedReturnReasonError`, тот же класс, что `OrderReturn.request()` (DTJ-271).
   *
   * `reason='customer_dispute_post_delivery'` — исход зависит от `disposition`
   * (SRS-RET-004, последняя строка таблицы): `'restock'` (подтверждённый брак) → полный
   * возврат; иначе (`'destroy'`/`null`) → деньги не возвращаются. `disposition=null`
   * представляет «решение ещё не принято» (тот же смысл, что `pending_inspection` в БД-enum —
   * `OrderReturn` в этом кодовой базе никогда не материализует `ReturnDisposition.
   * pendingInspection()` как реальное значение поля, см. JSDoc `order-return.entity.ts`,
   * `_disposition` стартует `null` и остаётся им до `confirmReceived()`/`adminOverride()`).
   * `disposition='destroy'` без физического обоснования брака — REST-use case (DTJ-274)
   * ОБЯЗАН не вызывать `resolve()` вовсе для отклонённого возврата (см. «Риски» тикета
   * DTJ-272) — эта политика не защищена от такого неправильного вызова доменной проверкой
   * статуса сознательно (не знает про `OrderReturn`, только про причину и диспозицию).
   */
  resolve(reason: ReturnReason, disposition: ReturnDisposition | null): ReturnFinancialOutcome {
    const reasonValue = reason.value
    if (reasonValue === 'undelivered') {
      throw new UnsupportedReturnReasonError({
        reason: reasonValue,
        hint: 'undelivered is redirected to SupportFacade/OrderDispute, not resolved by ReturnFinancialOutcomeResolver (SRS-RET-003)',
      })
    }
    if (reasonValue === 'customer_dispute_post_delivery') {
      return disposition?.value === 'restock' ? FULL_REFUND : NO_REFUND
    }
    return STATIC_OUTCOMES_BY_REASON[reasonValue]
  }
}
