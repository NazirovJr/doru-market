/**
 * `CheckoutCommand` (EP-09, DTJ-227, SRS-DOM-166, «Что сделать» п.1) — вход
 * `CheckoutUseCase.execute()`. Presentation-слой (DTJ-233) собирает эту команду из тела
 * `POST /api/v1/orders` + `TenantContext`/`AuthContext` + заголовка `Idempotency-Key`
 * (`checkoutAttemptId` — СЫРОЕ значение заголовка, тот же UUID, что `Order.checkoutAttemptId`,
 * SRS-DOM-166).
 *
 * `tenantId`/`customerId`/`customerPhone` — не часть HTTP-тела, но обязательные явные поля
 * команды (SRS-API-043, тот же приём, что `AddCartItemInput.tenantId`): presentation читает их
 * из контекста и прокидывает явно, use case НЕ обращается к `AsyncLocalStorage` сам.
 * `customerPhone` — нужен `PaymentInvoicePort.createInvoice` (шаг 4h, non-cash-инвойс), не
 * резолвится внутри use case (пользователь уже аутентифицирован presentation-слоем).
 *
 * `deliveryAddressId`/`inlineAddress` — взаимоисключающие (ДТЖ-229 «Что сделать» п.1); ровно
 * ОДИН ненулевой. `deliveryLandmark`, если передан, ПЕРЕЗАПИСЫВАЕТ ориентир сохранённого адреса
 * ТОЛЬКО для этого заказа (одноразовое уточнение) — см. DTJ-229.
 */
import type { OrderPaymentMethod } from '@dorutj/contracts'

export interface InlineDeliveryAddress {
  readonly addressText: string
  readonly landmarkText: string | null
  readonly latitude: number
  readonly longitude: number
}

export interface CheckoutCommand {
  readonly tenantId: string
  readonly customerId: string
  readonly customerPhone: string
  readonly cartItemIds: readonly string[]
  readonly deliveryAddressId: string | null
  readonly inlineAddress: InlineDeliveryAddress | null
  readonly deliveryLandmark: string | null
  readonly paymentMethod: OrderPaymentMethod
  readonly prescriptionIds: readonly string[]
  /**
   * SRS-ORD-023, «Поправка CTO (волна 6)» — ожидаемая сумма ПОЗИЦИЙ (`items_total`, БЕЗ
   * доставки), ключ — `pharmacyId`. Целиком опционально (пустой объект = клиент не подтвердил
   * ничего) И по каждой группе (отсутствие ключа для конкретной аптеки пропускает проверку
   * дрейфа ТОЛЬКО для неё, `DetectPriceDriftService`, вне периметра этого файла). Заменяет
   * прежнее одно число `expectedTotalDiram` на весь запрос — то не могло совпасть больше чем с
   * одной группой при мультиаптечной корзине (см. поправку под SRS-ORD-023 в спеке) и сравнивало
   * итог С доставкой, которую клиент на момент подтверждения не знает.
   */
  readonly expectedTotalDiramByPharmacy: Readonly<Record<string, bigint>>
  /** = заголовок `Idempotency-Key`, СЫРОЙ UUID v4 (SRS-DOM-166). */
  readonly checkoutAttemptId: string
}
