/**
 * Публичные контракты модуля `orders` (EP-09, DTJ-220) — заготовки DTO, наполняются по мере
 * готовности `DTJ-221` (домен `Order`/`OrderItem`) / `DTJ-222` (state machine, `OrdersFacade`) /
 * `DTJ-223..226` (корзина).
 *
 * `OrderStatus` — 1:1 с БД (`order_status` enum, `db/schema/enums.schema.ts`,
 * `11-database-schema.md` строки 107-116). Денежные поля — целые дирамы (`*Diram`, `number` на
 * границе JSON — правило 6 AGENTS.md, SRS-DB-003: конвертация `NUMERIC(10,2) ↔ diram`
 * происходит ИСКЛЮЧИТЕЛЬНО в infrastructure-мапперах, сюда попадает уже целое число). Даты —
 * ISO-8601 UTC-строки (граница JSON, конвенция `pharmacies-map.ts`/`search.ts`).
 */
import { z } from 'zod'
import type { ReportItemIssueReason } from './orders-pharmacy-terminal.contracts.js'

/** DTJ-380 — 1:1 с `product_events.session_id VARCHAR(128)` (`db/schema/product-events.ts`). */
const SESSION_ID_MAX_LENGTH = 128

/** 1:1 с enum `order_status` (D-25: `confirmed` — синхронный результат `cash_courier`). */
export const ORDER_STATUS_VALUES = [
  'pending_payment',
  'confirmed',
  'paid_escrow',
  'processing',
  'picked_up',
  'delivered',
  'cancelled',
  'refunded',
  'return_in_progress',
] as const
export type OrderStatus = (typeof ORDER_STATUS_VALUES)[number]

/** `orders.payment_method` (VARCHAR в БД — 1:1 tz.log, но значения ограничены этим набором). */
export const ORDER_PAYMENT_METHOD_VALUES = ['alif_mobi', 'dc_next', 'cash_courier'] as const
export type OrderPaymentMethod = (typeof ORDER_PAYMENT_METHOD_VALUES)[number]

/**
 * `orders.billing_strategy` (DTJ-228, миграция `0028_orders_payments_extensions.sql`,
 * SRS-DOM-162/SRS-RET-009) — снэпшот стратегии биллинга на момент checkout. Домен
 * (`OrderCreateCommand`) и приложение (`ResolveBillingStrategyService`) делят ОДИН тип отсюда
 * — тот же приём, что `OrderPaymentMethod`/`OrderStatus` выше, чтобы не заводить локальный
 * дубль в `apps/api` (правило 15 AGENTS.md). R1 резолвит ИСКЛЮЧИТЕЛЬНО `single_invoice`
 * (D-EP09-33, ADR утверждён) — `split_items_delivery` числится в домене уже сейчас, чтобы
 * возврат (EP-11) не потребовал ещё одной миграции схемы, когда `split_items_delivery` станет
 * достижима (TODO(DTJ-242/244)).
 */
export const BILLING_STRATEGY_VALUES = ['single_invoice', 'split_items_delivery'] as const
export type BillingStrategy = (typeof BILLING_STRATEGY_VALUES)[number]

/**
 * `OrderDto` (заготовка, DTJ-220) — DTO заказа для presentation-слоя. Поля соответствуют
 * `orders` (`11-database-schema.md` Группа D), наполняется/уточняется DTJ-221/222/233.
 */
export interface OrderDto {
  readonly id: string
  readonly orderNumber: string
  readonly tenantId: string
  readonly customerId: string
  readonly pharmacyId: string | null
  readonly status: OrderStatus
  readonly paymentMethod: OrderPaymentMethod
  /** DTJ-228 — снэпшот на момент checkout, см. JSDoc `BillingStrategy` выше. */
  readonly billingStrategy: BillingStrategy
  readonly itemsTotalDiram: number
  readonly deliveryFeeDiram: number
  readonly totalAmountDiram: number
  readonly deliveryAddress: string
  readonly deliveryLandmark: string | null
  readonly deliveryLatitude: number | null
  readonly deliveryLongitude: number | null
  readonly courierId: string | null
  readonly courierEtaMinutes: number | null
  readonly cancelReason: string | null
  readonly slaDeadlineAt: string | null
  readonly processingStartedAt: string | null
  readonly pickedUpAt: string | null
  readonly deliveredAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * `OrderItemDto` (заготовка, DTJ-220) — DTO позиции заказа. `commissionBps`/
 * `platformFeeDiram` — снэпшот на момент заказа (SRS-DOM-008), НЕИЗМЕНЯЕМ.
 */
export interface OrderItemDto {
  readonly id: string
  readonly orderId: string
  readonly medicineId: string
  readonly unitPriceDiram: number
  readonly quantity: number
  readonly totalPriceDiram: number
  readonly commissionBps: number
  readonly platformFeeDiram: number
  /**
   * РАСШИРЕНИЕ (DTJ-302/303, EP-12 §A.3/A.4, SRS-PHT-002/011..018) — прогресс физической
   * сборки этой позиции терминалом фармацевта. `scannedAt` — ISO-8601 UTC-строка (конвенция
   * файла, см. JSDoc выше), не `Date` (граница JSON). `itemIssueReason` переиспользует
   * `ReportItemIssueReason` (`orders-pharmacy-terminal.contracts.ts`) — тот же набор значений,
   * не дублируется третий раз в этом файле.
   */
  readonly fulfillmentStatus: 'pending' | 'scanned_ok' | 'unavailable'
  readonly scannedBatchId: string | null
  readonly scannedAt: string | null
  readonly scannedBy: string | null
  readonly scanMethod: 'camera' | 'manual' | null
  readonly itemIssueReason: ReportItemIssueReason | null
}

/**
 * `CartItemDto` (заготовка, DTJ-220) — позиция серверной корзины, привязана к конкретной
 * аптеке (цена/остаток различаются между аптеками, REQ-UX-4). Наполняется DTJ-223/225/226.
 */
export interface CartItemDto {
  readonly id: string
  readonly medicineId: string
  readonly pharmacyId: string
  readonly quantity: number
  readonly addedAt: string
}

/**
 * `CartDto` (заготовка, DTJ-220) — серверная корзина (не доменный агрегат, простое
 * хранилище выбора товара до checkout). Наполняется DTJ-223/225/226 (группировка по
 * аптекам, живой пересчёт цены/остатка).
 */
export interface CartDto {
  readonly id: string
  readonly tenantId: string
  readonly customerId: string | null
  readonly items: readonly CartItemDto[]
}

/**
 * `POST /api/v1/orders/:id/cancel` (EP-09, DTJ-232, SRS-ORD-029/030) — причины отмены,
 * доступные РУЧНОМУ инициатору (`customer`/`pharmacist`/`pharmacy_admin`/`super_admin`) через
 * этот единый эндпоинт. Подмножество полного канонического enum `OrderCancelReason`
 * (`apps/api/.../orders/domain/order-domain-event.ts`, DTJ-222/304, 9 значений, SRS-ORD-030) —
 * ТРИ значения этого домена-enum'а НЕ входят сюда намеренно: `payment_timeout`
 * (`UnpaidOrderTimeoutJob`, SRS-ORD-032), `late_payment_after_cancellation` (SRS-PAY-027) — обе
 * ставятся ТОЛЬКО системой (`actor.kind === 'system'`); и `customer_rejected_partial_fulfillment`
 * (DTJ-304, SRS-PHT-023) — ставится ТОЛЬКО `ResolvePartialFulfillmentUseCase` через СВОЙ,
 * отдельный от этого эндпоинта, клиентский `confirm`/`reject` (`apps/web`, вне этого барабана),
 * человек её тоже не выбирает через ЭТУ форму. Значения синхронизированы
 * буквально с доменным enum (значения дублируются между `packages/contracts` и `apps/api`
 * умышленно — `orders`-домен `apps/api` не имеет права импортировать `packages/contracts`
 * настолько тесно и наоборот `packages/contracts` не может импортировать `apps/api`; тот же
 * класс дублирования значений, что уже есть между `order_status`-enum БД и `OrderStatus` здесь).
 */
export const CANCEL_ORDER_REASON_VALUES = [
  'customer_changed_mind',
  'found_cheaper_elsewhere',
  'pharmacy_suspended',
  'pickup_sla_timeout',
  'fraud_or_safety_force_cancel',
  'license_revoked_force_cancel',
] as const
export type CancelOrderReason = (typeof CANCEL_ORDER_REASON_VALUES)[number]

/** `reason` — enum, НЕ свободная строка (SRS-ORD-030): свободный текст клиента (если есть) —
 * забота presentation-слоя (`audit_log.metadata`, не эта схема). */
export const CancelOrderRequestSchema = z.object({
  reason: z.enum(CANCEL_ORDER_REASON_VALUES),
})
export type CancelOrderRequest = z.infer<typeof CancelOrderRequestSchema>

/**
 * `GET/POST/PATCH /api/v1/cart*` response DTOs (EP-09, DTJ-226, SRS-ORD-002/004/010/012).
 * Отдельно от `CartItemDto`/`CartDto` выше (заготовки DTJ-220, скромный набор полей) — эти
 * несут ЖИВУЮ цену/остаток/группировку по аптекам, которых `CartItemDto` не предполагает;
 * не расширяют существующие интерфейсы, чтобы не трогать чужие строки этого общего файла.
 * Деньги — `number` на границе JSON (не `bigint`, который не сериализуется нативно) — тот же
 * приём конвертации, что `order.mapper.ts` (`unitPriceDiram`/`totalAmountDiram`).
 */
export interface CartItemResponseDto {
  readonly id: string
  readonly cartId: string
  readonly medicineId: string
  /** DTJ-234 (дефект приёмки — корзина рендерила UUID вместо названия): `medicines.trade_name`,
   *  `NOT NULL` в БД — всегда `string`, никогда `null`, когда строка вообще попала в `items[]`. */
  readonly medicineTradeName: string
  readonly pharmacyId: string
  readonly pharmacyName: string | null
  readonly quantity: number
  readonly priceDiram: number
  readonly availableQuantity: number
  readonly addedAt: string
}

/** SRS-ORD-012: единственный тип предупреждения `GET /api/v1/cart` на сегодня. */
export const CART_ITEM_WARNING_INSUFFICIENT_STOCK = 'insufficient_stock' as const

export interface CartInsufficientStockWarningDto {
  readonly cartItemId: string
  readonly type: typeof CART_ITEM_WARNING_INSUFFICIENT_STOCK
  readonly availableQuantity: number
}

/** SRS-ORD-004/SRS-DOM-175: предупреждение `POST /api/v1/cart/items`, отдельное от GET-warnings. */
export const CART_WARNING_DUPLICATE_SUBSTANCE = 'duplicate_substance' as const

/**
 * `existingMedicineTradeName`/`newMedicineTradeName`/`substanceNames` (DTJ-234, дефект приёмки):
 * до этой правки DTO нёс только `existingMedicineId`/`newMedicineId` (UUID) — предупреждение
 * физически не могло назвать ни препараты, ни само действующее вещество пользователю.
 * `existingMedicineTradeName: string | null` — `null`, если медикамент, уже лежащий в корзине,
 * сняли с публикации между добавлением и этим вызовом (тот же приём, что `pharmacyName` выше);
 * `newMedicineTradeName` — ВСЕГДА `string` (медикамент этого вызова уже прошёл существование).
 * `substanceNames` — названия ПЕРЕСЕКШИХСЯ веществ, может быть больше одного.
 */
export interface CartDuplicateSubstanceWarningDto {
  readonly type: typeof CART_WARNING_DUPLICATE_SUBSTANCE
  readonly existingMedicineId: string
  readonly existingMedicineTradeName: string | null
  readonly newMedicineId: string
  readonly newMedicineTradeName: string
  readonly substanceNames: readonly string[]
}

export interface CartPharmacyGroupItemDto {
  readonly medicineId: string
  /** DTJ-234 (дефект приёмки) — `| null`, НЕ как `CartItemResponseDto.medicineTradeName`: этот
   *  DTO строится из `PricedCartLineItem` (`apps/api/.../split-cart-by-pharmacy.use-case.ts`),
   *  общего типа с `CheckoutUseCase` (чужой периметр), где поле не заполняется — см. JSDoc там. */
  readonly medicineTradeName: string | null
  readonly pharmacyId: string
  readonly pharmacyName: string | null
  readonly quantity: number
  readonly unitPriceDiram: number
}

/** SRS-ORD-002: сплит корзины по аптекам, показывается ДО перехода к оплате. */
export interface CartPharmacyGroupDto {
  readonly pharmacyId: string
  readonly pharmacyName: string | null
  readonly items: readonly CartPharmacyGroupItemDto[]
  readonly subtotalDiram: number
  readonly distanceMeters?: number
}

export interface CartViewResponseDto {
  readonly items: readonly CartItemResponseDto[]
}

export interface CartViewMetaDto {
  readonly pharmacyGroups: readonly CartPharmacyGroupDto[]
  readonly warnings: readonly CartInsufficientStockWarningDto[]
  // Индексная сигнатура — совместимость с `EnvelopeMeta` (`envelope.ts`), которую `ok(data,
  // meta)` требует вторым аргументом (SRS-API-014).
  readonly [key: string]: unknown
}

/**
 * `POST /api/v1/orders` — тело запроса и композитный ответ (SRS-ORD-017/019, EP-09, DTJ-233).
 * Перенесено сюда из `apps/api/.../orders/presentation/checkout/dto/*` (волна 6, поправка CTO
 * под SRS-ORD-023) — до этой правки форма была продублирована ВРУЧНУЮ во фронте построчной
 * транскрипцией бэкенд-DTO (DTJ-235, задокументировано как DISPUTED в отчёте сдачи) вместо
 * общего источника: третий такой случай в проекте после аналогов и корзины, накапливающийся
 * долг против правила 15 AGENTS.md. Обе стороны границы процесса (`apps/api` контроллер,
 * `apps/web` `features/checkout/api`) импортируют схему/типы ОТСЮДА, копий больше не заводят.
 */
export interface CreateOrderInlineAddressDto {
  readonly addressText: string
  readonly landmarkText: string | null
  readonly latitude: number
  readonly longitude: number
}

const CreateOrderInlineAddressSchema = z.object({
  addressText: z.string().min(1),
  landmarkText: z.string().min(1).nullable().optional(),
  latitude: z.number(),
  longitude: z.number(),
})

/**
 * `expectedTotalDiramByPharmacy` — «Поправка CTO (волна 6)» под SRS-ORD-023: ожидаемая сумма
 * ПОЗИЦИЙ (`items_total`, БЕЗ доставки — её считает сервер, клиент на момент подтверждения не
 * знает) передаётся ПО ГРУППАМ, ключ — `pharmacyId`. Поле целиком опционально; группа, для
 * которой ключа нет, оформляется без проверки дрейфа цены (`DetectPriceDriftService`,
 * `apps/api/.../orders/application/checkout/`). Прежняя форма — одно число `expectedTotalDiram`
 * на весь запрос — сверялась с суммой КАЖДОЙ группы по отдельности и была неприменима при
 * мультиаптечной корзине (главный сценарий продукта, см. поправку в спеке).
 */
export const CreateOrderRequestSchema = z.object({
  cartItemIds: z.array(z.uuid()).min(1),
  deliveryAddressId: z.uuid().nullable().optional(),
  inlineAddress: CreateOrderInlineAddressSchema.nullable().optional(),
  deliveryLandmark: z.string().min(1).nullable().optional(),
  paymentMethod: z.enum(ORDER_PAYMENT_METHOD_VALUES),
  prescriptionIds: z.array(z.uuid()).optional(),
  expectedTotalDiramByPharmacy: z.record(z.string(), z.number().int().nonnegative()).optional(),
  /** DTJ-380 — клиентский телеметрийный sessionId (см. `analytics.ts#ProductEventInputSchema`), для реализованной экономии `order_placed`. */
  sessionId: z.string().min(1).max(SESSION_ID_MAX_LENGTH).nullable().optional(),
})
export type CreateOrderRequestDto = z.infer<typeof CreateOrderRequestSchema>

/** `status`/`reason` — `string`, НЕ узкие `OrderStatus`/`ErrorCode`: ответ отдаёт их буквально
 *  как строку (см. `apps/api/.../order-response.dto.ts`), сужать здесь значило бы утверждать
 *  гарантию, которую бэкенд-контракт не даёт. */
export interface OrderResultResponseDto {
  readonly orderId: string
  readonly orderNumber: string
  readonly pharmacyId: string
  readonly status: string
  readonly totalAmountDiram: number
  readonly paymentPending: boolean
}

export interface FailedGroupResponseDto {
  readonly pharmacyId: string
  readonly reason: string
  readonly details?: Record<string, unknown> | undefined
}

export interface ExcludedItemResponseDto {
  readonly cartItemId: string
  readonly reason: string
}

/** `data` — тело ответа `POST /api/v1/orders` (SRS-ORD-019, композитный ответ с частичным успехом). */
export interface CheckoutResponseDataDto {
  readonly orders: readonly OrderResultResponseDto[]
  readonly failedGroups: readonly FailedGroupResponseDto[]
}

export interface CheckoutResponseMetaDto {
  readonly excludedItems: readonly ExcludedItemResponseDto[]
  // Индексная сигнатура — совместимость с `EnvelopeMeta` (`ok(data, meta)`, SRS-API-014).
  readonly [key: string]: unknown
}
