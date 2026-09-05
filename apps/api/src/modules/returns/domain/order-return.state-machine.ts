/**
 * Таблица допустимых переходов `return_status` (EP-11, DTJ-271, SRS-DOM-055/056).
 *
 * Единственный источник истины для допустимости перехода (`02` §2.4/C15) — используется КАЖДЫМ
 * мутирующим методом `OrderReturn` (`domain/order-return.entity.ts`), не дублируется `if/else`
 * в каждом методе. Образец стиля — `modules/orders/domain/order.state-machine.ts` (образец,
 * явно указанный DTJ-271 — «НЕ if (status === ...) россыпью, реализовать таблицу в отдельном
 * order-return.state-machine.ts, entity делегирует проверку ей»).
 *
 * `returned_to_pharmacy` — значение есть в enum (схема БД — закон, SRS-DB-008), но НИ ОДИН
 * переход R1 в него не ведёт (D-EP11-4, `reports/EP11-EP14-CTO-BRIEF.md`): приёмка и решение
 * «restock vs destroy» — один шаг `confirmReceived()`. TODO(DTJ-273): если use case когда-либо
 * разделит «товар доехал» и «фармацевт принял» на два шага, статус войдёт в таблицу без
 * изменения enum'а — задел уже физически на месте (нет входящих/исходящих рёбер здесь, но
 * значение существует).
 *
 * `return_rejected` НЕ терминален (SRS-DOM-056, REQ-RET-13) — единственный статус этой таблицы
 * с исходящими рёбрами из «неглавной» ветки: `adminOverride()` → `return_confirmed`,
 * `retryTransit()` → `return_in_transit`. `return_confirmed` — терминален (нулевые исходящие
 * рёбра, критерий приёмки 4 DTJ-271).
 */
import type { ReturnStatus } from '@dorutj/contracts'

/** `Readonly` — единственный источник истины (тот же приём, что `ORDER_ALLOWED_TRANSITIONS`). */
export const RETURN_ALLOWED_TRANSITIONS: Readonly<Record<ReturnStatus, readonly ReturnStatus[]>> = {
  // markInTransit(): курьер назначен после запроса возврата (ветка ПОСЛЕ вручения, SRS-RET-002).
  return_requested: ['return_in_transit'],
  // confirmReceived(): приёмка ВСЕГДА переводит в return_confirmed (restock/destroy — это
  // disposition, не отдельный статус, см. JSDoc entity). reject(): фармацевт/курьер отклоняет
  // приёмку (например, товар не совпадает с описанием).
  return_in_transit: ['return_confirmed', 'return_rejected'],
  // D-EP11-4 — задел под будущий шаг, недостижим в R1.
  returned_to_pharmacy: [],
  // Терминальный статус (SRS-DOM-055, критерий приёмки 4 DTJ-271).
  return_confirmed: [],
  // НЕ терминален (SRS-DOM-056/REQ-RET-13): adminOverride() форсирует подтверждение,
  // retryTransit() запускает повторную попытку транзита.
  return_rejected: ['return_confirmed', 'return_in_transit'],
}

/** `true`, если переход `from → to` разрешён таблицей выше. Единственная точка проверки. */
export function isReturnTransitionAllowed(from: ReturnStatus, to: ReturnStatus): boolean {
  return RETURN_ALLOWED_TRANSITIONS[from].includes(to)
}
