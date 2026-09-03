/**
 * `DetectPriceDriftService` (EP-09, DTJ-231, SRS-ORD-023, «Поправка CTO волна 6») —
 * application-сервис, вызываемый из `CheckoutUseCase.createAndSaveOrder` (DTJ-227,
 * `checkout.use-case.ts`) СРАЗУ ПОСЛЕ `CalculateOrderCostService.calculate()` (DTJ-228) и ДО
 * `Order.create()` (`processGroup`, ВНУТРИ транзакции ГРУППЫ) — сервер никогда не доверяет
 * сумме от клиента (SRS-DOM-003): `Order.create()` снэпшотит `totalAmount`, посчитанный на
 * актуальной цене/остатке, а НЕ то, что клиент видел в корзине раньше.
 *
 * Сравнение — сумма ПОЗИЦИЙ группы (`items_total`, БЕЗ доставки). Доставку считает сервер
 * (`CalculateOrderCostService`/`DeliveryFacadePort`) и клиент на момент подтверждения её не
 * знает — сверка с суммой, включающей доставку, была бы невыполнима по построению.
 *
 * Клиент передаёт ожидание ПО ГРУППАМ: `CheckoutCommand.expectedTotalDiramByPharmacy`, ключ —
 * `pharmacyId`. `CheckoutUseCase` резолвит запись ИМЕННО этой группы ПЕРЕД вызовом `check()` —
 * сам сервис остаётся сравнением двух `bigint`, ничего не знает о структуре checkout целиком.
 * Группа, для которой ключа в `expectedTotalDiramByPharmacy` нет (в том числе когда клиент
 * вообще не передал поле), проверку пропускает — `expectedItemsTotalDiram === null`.
 *
 * **История дефекта (исправлено этой правкой).** До поправки поле было ОДНИМ числом на весь
 * запрос, а `check()` всё равно вызывался отдельно для каждой группы с ЕЁ суммой — при
 * мультиаптечной корзине (главный сценарий продукта) любое переданное значение могло совпасть
 * максимум с одной группой и давало ложный `PRICE_OR_STOCK_CHANGED` всем остальным. Защита
 * фактически не работала ни в каком виде; дефект независимо обнаружили и честно
 * задокументировали два исполнителя (DTJ-231 — в этом JSDoc, DTJ-235 — отказом слать поле с
 * фронта). Форма `expectedTotalDiramByPharmacy` (по группам) и сравнение по `items_total` (без
 * доставки) устраняют обе половины дефекта разом.
 *
 * Брошенная `PriceOrStockChangedError` ловится `CheckoutUseCase.processGroup` catch-веткой
 * (`error instanceof DomainError`) точно так же, как `InsufficientStockError` — откатывает
 * транзакцию ЭТОЙ группы (реверсирует уже выполненный `reserveStock`), остальные группы того же
 * checkout не затрагиваются (SRS-ORD-019).
 */
import { Injectable } from '@nestjs/common'
import { PriceOrStockChangedError } from './errors/price-or-stock-changed.error.js'

/**
 * DoD DTJ-231 — именованная константа. ASSUMPTION `0` (SRS-ORD-023: «точное совпадение») —
 * банковские округления уже применены на обеих сторонах сравнения (`bankersRoundDivide`,
 * `order-item.entity.ts`, DTJ-221) до дирама, допуск сверх точного совпадения не обоснован
 * спекой; ненулевой допуск вводится отдельным ADR, если продукт решит иначе.
 */
export const PRICE_DRIFT_TOLERANCE_DIRAM = 0n

@Injectable()
export class DetectPriceDriftService {
  /**
   * `expectedItemsTotalDiram === null` — клиент не передал ожидание ДЛЯ ЭТОЙ группы (ключ
   * `pharmacyId` отсутствует в `expectedTotalDiramByPharmacy`, включая случай, когда поле не
   * передано вовсе) — проверка пропускается целиком, ничего не бросает. Оба аргумента — сумма
   * ПОЗИЦИЙ (`items_total`, без доставки, см. JSDoc файла), не `total_amount`.
   */
  check(expectedItemsTotalDiram: bigint | null, actualItemsTotalDiram: bigint): void {
    if (expectedItemsTotalDiram === null) {
      return
    }
    const driftDiram = absBigint(actualItemsTotalDiram - expectedItemsTotalDiram)
    if (driftDiram > PRICE_DRIFT_TOLERANCE_DIRAM) {
      throw new PriceOrStockChangedError({
        expectedTotalDiram: Number(expectedItemsTotalDiram),
        actualTotalDiram: Number(actualItemsTotalDiram),
      })
    }
  }
}

const ZERO_DIRAM = 0n

function absBigint(value: bigint): bigint {
  return value < ZERO_DIRAM ? -value : value
}
