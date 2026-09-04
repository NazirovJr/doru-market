/**
 * Команда `DeliveryAssignment.create()` (EP-13, DTJ-313). Вынесена в отдельный файл — тот же
 * приём, что `modules/orders/domain/order-create-command.ts` (C2 ≤300 строк/файл).
 *
 * Домен принимает уже РЕЗОЛВЛЕННЫЕ значения, не порты (`02` §2.6): `requiresColdChain` уже
 * агрегирован вызывающим `CreateDeliveryAssignmentUseCase` (DTJ-314+, `OR` по `order_items` заказа
 * — SRS-DELIV-004), `hasActiveNonTerminalAssignment` уже проверен через
 * `DeliveryAssignmentRepositoryPort` ДО вызова `create()` (SRS-DOM-036 — уникальность физически
 * гарантирует БД, `ux_delivery_assignment_one_active`; этот флаг даёт агрегату дешёвый,
 * без-БД доменный тест АС3 тикета).
 *
 * `geoPoint` из сигнатуры `10-domain-model.md` («DeliveryAssignment.create(orderId, landmark,
 * geoPoint)») сюда НЕ включён: `delivery_assignments.delivery_geo_point` канонического DDL не
 * создана этим тикетом (foundIssue — PostGIS недоступен в окружении, к тому же поле было бы
 * избыточным дублем `orders.delivery_latitude/longitude` — см. JSDoc `db/schema/delivery-
 * assignments.ts`); агрегату негде было бы его хранить.
 */
export interface DeliveryAssignmentCreateCommand {
  readonly id: string
  readonly orderId: string
  readonly landmarkText: string | null
  readonly requiresColdChain: boolean
  readonly hasActiveNonTerminalAssignment: boolean
  /** `Clock.now()` — домен не вызывает `new Date()` напрямую (`02` §2.6). */
  readonly now: Date
}
