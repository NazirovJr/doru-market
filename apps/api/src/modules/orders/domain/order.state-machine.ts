/**
 * Таблица допустимых переходов `order_status` (EP-09, DTJ-222, D-25).
 *
 * Единственный источник истины для допустимости перехода (`02` §2.4/C15) — используется
 * КАЖДЫМ методом-намерением `Order` (`domain/order.entity.ts`), не дублируется `if/else` в
 * каждом методе. Образец стиля — `modules/inventory/domain/inventory-sync-batch.entity.ts`
 * (`ALLOWED_TRANSITIONS`), см. `reports/EP09-CTO-BRIEF.md` §5.
 *
 * Источник — `docs/spec/10-domain-model.md` §«State machines»/1 (обе диаграммы: основная ветка
 * `pending_payment ⇄ paid_escrow` и параллельная ветка D-25 через `confirmed`) +
 * `docs/spec/21-module-orders-payments-escrow.md` §2.4 (SRS-ORD-027 п.5).
 *
 * `confirmed` — НЕ цель ни одного перехода в этой таблице: он присваивается синхронно внутри
 * `Order.create()` (D-25), минуя таблицу переходов целиком, поэтому у него нет входящих рёбер
 * здесь — только исходящие.
 *
 * `attachReturn`/`markRefunded` (EP-11, заготовки — DTJ-222 п.2 последний пункт) — рёбра
 * `picked_up|delivered → return_in_progress`, `return_in_progress → cancelled|delivered|refunded`
 * включены в таблицу, чтобы она была ПОЛНОЙ с первого дня (не дробить единственный источник
 * истины между эпиками), хотя бизнес-логика самих методов принадлежит EP-11
 * (`tickets/00-EPICS.md` строка 30 — эпик документирован, но ещё не нарезан на тикеты; явный
 * маркер владельца вместо выдуманного `DTJ-*`, тот же приём, что CTO утвердил для `TODO(R2-4)`
 * в `reports/EP09-CTO-BRIEF.md` §4 D-EP09-8).
 *
 * Запрещённые переходы (SRS-DOM-102, дополнено D-25) — НЕ отдельная структура, а то, что
 * ОТСУТСТВУЕТ в `ORDER_ALLOWED_TRANSITIONS` (allowlist, не blocklist). Явный список ниже —
 * комментарий-справка для ревью, не источник истины:
 *   - `delivered → processing|paid_escrow|pending_payment` (нет отката назад);
 *   - `cancelled → *`, `refunded → *` (терминальны);
 *   - `pending_payment → picked_up|delivered` напрямую;
 *   - `paid_escrow → picked_up|delivered` напрямую;
 *   - `processing → delivered` напрямую (нельзя миновать `picked_up`/OTP);
 *   - любой статус `→ paid_escrow`, кроме `pending_payment` (эскроу не переоткрывается);
 *   - `confirmed → paid_escrow` И `paid_escrow → confirmed` (D-25, обе стороны запрещены —
 *     наличные и эскроу описывают взаимоисключающие финансовые истории одного заказа).
 */
import type { OrderStatus } from '@dorutj/contracts'

/** `Readonly` — единственный источник истины, см. DoD DTJ-222: grep не находит второй такой таблицы. */
export const ORDER_ALLOWED_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  // Основная ветка (non-cash) — SRS-DOM-089/090.
  pending_payment: ['paid_escrow', 'cancelled'],
  // Ветка D-25 (cash_courier) — SRS-ORD-027 п.3/4, SRS-DOM-178/179. Вход — ТОЛЬКО из Order.create(),
  // не из другого статуса (нет входящих рёбер в этой таблице).
  confirmed: ['processing', 'cancelled'],
  // SRS-DOM-091/092.
  paid_escrow: ['processing', 'cancelled'],
  // SRS-DOM-093/094 (обе ветки сходятся в одном узле `processing`, см. JSDoc файла).
  processing: ['cancelled', 'picked_up'],
  // SRS-DOM-095/096.
  picked_up: ['delivered', 'return_in_progress'],
  // SRS-DOM-098/101 (`resolveRefundFull` — полный переход в `refunded`; частичный НЕ меняет статус).
  delivered: ['return_in_progress', 'refunded'],
  // SRS-DOM-097 (из `picked_up`, → `cancelled`), SRS-DOM-099 (из `delivered`, `return_rejected` →
  // `delivered`), SRS-DOM-100 (→ `refunded`). Один статус-значение обслуживает оба источника —
  // допустимость конкретной пары «источник → return_in_progress → цель» обеспечивает вызывающий
  // application-код (EP-11), не эта таблица (она допускает объединение исходящих рёбер обеих веток).
  return_in_progress: ['cancelled', 'delivered', 'refunded'],
  // Терминальные (SRS-DOM-102) — исходящих рёбер нет.
  cancelled: [],
  refunded: [],
}

/** `true`, если переход `from → to` разрешён таблицей выше. Единственная точка проверки. */
export function isOrderTransitionAllowed(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_ALLOWED_TRANSITIONS[from].includes(to)
}
