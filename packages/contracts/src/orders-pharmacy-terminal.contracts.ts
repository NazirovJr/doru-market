/**
 * Контракты терминала фармацевта (DTJ-300, EP-12, модуль 24 «Терминал фармацевта», Часть A —
 * `docs/spec/24-module-pharmacy-terminal.md`). Zod-схемы тел запросов ВСЕХ эндпоинтов части A +
 * DTO элемента очереди (SRS-PHT-006) — единственный источник DTO-типов для последующих тикетов
 * (DTJ-301..309, presentation-контроллеры/Flutter-клиент R2).
 *
 * Плоский файл-сиблинг `orders.ts` (НЕ директория `orders/` — `orders.ts` уже существует как
 * плоский файл на лимите строк C2, заводить рядом директорию с тем же именем создало бы
 * наполовину-мигрированную структуру; приём именования — как `domain-errors-security.ts` рядом с
 * `domain-errors.ts`). Экспортируется отдельной строкой из барабанного `index.ts`.
 *
 * Ответы (DTO) — по конвенции файла `orders.ts`: `interface`, НЕ `z.object` (Zod валидирует
 * ВХОДЯЩИЕ данные на границе API, исходящий ответ сервер формирует сам — см. `OrderDto`/
 * `CartItemResponseDto` в `orders.ts`, тот же приём). Причины `reason` (reclaim/report-issue) —
 * буквальные литералы, ДУБЛИРУЮЩИЕ (умышленно, см. JSDoc `CANCEL_ORDER_REASON_VALUES` в
 * `orders.ts`) канонические доменные `ORDER_RECLAIM_REASON_VALUES`/`ORDER_ITEM_ISSUE_REASON_VALUES`
 * из `apps/api/.../orders/domain/order-domain-event.ts` — `packages/contracts` не импортирует
 * `apps/api`, и наоборот.
 */
import { z } from 'zod'

const NOTE_MAX_LENGTH = 500
const BARCODE_MAX_LENGTH = 64
const BATCH_NUMBER_MAX_LENGTH = 64

// ==================== A.2 — accept / reclaim ====================

/** `POST /orders/:id/accept` (SRS-PHT-007) — тело пустое (командует URL + `Idempotency-Key`). */
export const AcceptOrderRequestSchema = z.object({}).strict()
export type AcceptOrderRequestDto = z.infer<typeof AcceptOrderRequestSchema>

/** SRS-PHT-010 — причины `reclaim`, 1:1 с доменным `ORDER_RECLAIM_REASON_VALUES` (см. JSDoc файла). */
export const RECLAIM_ORDER_REASON_VALUES = ['colleague_unavailable', 'shift_change', 'other'] as const
export type ReclaimOrderReason = (typeof RECLAIM_ORDER_REASON_VALUES)[number]

/** `POST /orders/:id/reclaim` (SRS-PHT-010). */
export const ReclaimOrderRequestSchema = z.object({
  reason: z.enum(RECLAIM_ORDER_REASON_VALUES),
  note: z.string().trim().min(1).max(NOTE_MAX_LENGTH).optional(),
})
export type ReclaimOrderRequestDto = z.infer<typeof ReclaimOrderRequestSchema>

// ==================== A.3 — scan ====================

/**
 * `POST /orders/:id/items/:itemId/scan` (SRS-PHT-011). `rawBarcode` — БЕЗ формата (EAN-13 или
 * `internal_sku`, D-06) — только непустая строка: разбор формата — домен (`Barcode.parse()`),
 * не эта Zod-граница (SRS-PHT-047: «клиент лишь проверяет непустую строку перед отправкой»).
 * `scannedBatchNumber`/`scannedExpiryDate` — опциональны (см. SRS-PHT-011: если отсутствуют,
 * валидация партии пропускается, используется изначально зарезервированная).
 */
export const ScanOrderItemRequestSchema = z.object({
  rawBarcode: z.string().trim().min(1).max(BARCODE_MAX_LENGTH),
  manualEntry: z.boolean(),
  scannedBatchNumber: z.string().trim().min(1).max(BATCH_NUMBER_MAX_LENGTH).optional(),
  scannedExpiryDate: z.iso.date().optional(),
})
export type ScanOrderItemRequestDto = z.infer<typeof ScanOrderItemRequestSchema>

// ==================== A.4 — report-issue / propose-partial-fulfillment ====================

/** SRS-PHT-017/018 — причины `report-issue`, 1:1 с доменным `ORDER_ITEM_ISSUE_REASON_VALUES`. */
export const REPORT_ITEM_ISSUE_REASON_VALUES = [
  'out_of_stock',
  'expired_on_shelf',
  'damaged_packaging',
] as const
export type ReportItemIssueReason = (typeof REPORT_ITEM_ISSUE_REASON_VALUES)[number]

/** `POST /orders/:id/items/:itemId/report-issue` (SRS-PHT-017). */
export const ReportItemIssueRequestSchema = z.object({
  reason: z.enum(REPORT_ITEM_ISSUE_REASON_VALUES),
  note: z.string().trim().min(1).max(NOTE_MAX_LENGTH).optional(),
})
export type ReportItemIssueRequestDto = z.infer<typeof ReportItemIssueRequestSchema>

/** `POST /orders/:id/propose-partial-fulfillment` (SRS-PHT-019/020) — тело пустое. */
export const ProposePartialFulfillmentRequestSchema = z.object({}).strict()
export type ProposePartialFulfillmentRequestDto = z.infer<typeof ProposePartialFulfillmentRequestSchema>

/**
 * ДОБАВЛЕНО (DTJ-304) — ответ `201` `propose-partial-fulfillment` (SRS-PHT-020) и форма строки
 * `order_partial_fulfillment_requests` для будущих клиентских эндпоинтов `confirm`/`reject`
 * (владелец `apps/web`, вне этого эпика — см. «Технический контекст» DTJ-304). Деньги —
 * `number` на границе JSON, тот же приём, что `OrderDto`/`CartItemResponseDto` (`orders.ts`).
 */
export interface PartialFulfillmentSnapshotItemDto {
  readonly orderItemId: string
  readonly medicineName: string
  readonly quantity: number
  readonly reason: ReportItemIssueReason
}

export const PARTIAL_FULFILLMENT_STATUS_VALUES = ['awaiting_customer', 'confirmed', 'rejected', 'auto_confirmed_timeout'] as const
export type PartialFulfillmentStatusDto = (typeof PARTIAL_FULFILLMENT_STATUS_VALUES)[number]

export interface PartialFulfillmentRequestDto {
  readonly id: string
  readonly orderId: string
  readonly status: PartialFulfillmentStatusDto
  readonly itemsSnapshot: readonly PartialFulfillmentSnapshotItemDto[]
  readonly itemsTotalBeforeDiram: number
  readonly itemsTotalAfterDiram: number
  readonly refundAmountDiram: number
  readonly expiresAt: string
}

// ==================== A.5 — complete-picking ====================

/**
 * `POST /orders/:id/complete-picking` (SRS-PHT-024/025). `sealConfirmed` — `z.boolean()`, НЕ
 * `z.literal(true)`: `sealConfirmed: false` — ВАЛИДНОЕ тело, которое должно дойти до
 * `CompletePickingUseCase` и вернуть доменную `400 SEAL_CONFIRMATION_REQUIRED`
 * (`SealConfirmationRequiredError`) — сузив тип здесь до `literal(true)`, `false` отклонялся бы
 * общей `400 VALIDATION_ERROR` presentation-слоя, теряя специфичный код.
 */
export const CompletePickingRequestSchema = z.object({
  sealConfirmed: z.boolean(),
})
export type CompletePickingRequestDto = z.infer<typeof CompletePickingRequestSchema>

// ==================== A.6 — handover-otp/regenerate ====================

/** `POST /orders/:id/handover-otp/regenerate` (SRS-PHT-029) — тело пустое. */
export const RegenerateHandoverOtpRequestSchema = z.object({}).strict()
export type RegenerateHandoverOtpRequestDto = z.infer<typeof RegenerateHandoverOtpRequestSchema>

/** `handoverOtp` — форма из ответов `complete-picking` (SRS-PHT-027) и `GET handover-otp` (SRS-PHT-028). */
export interface HandoverOtpDto {
  readonly code: string
  readonly expiresAt: string
  readonly purpose: 'delivery_handover'
}

// ==================== A.1 — очередь заказов терминала (ответ, SRS-PHT-006) ====================

/**
 * Один элемент `GET /orders?filter[pharmacyId]=...` (SRS-PHT-006) — очередь заказов терминала.
 * `assignedPharmacistId`/`assignedPharmacistName` заполнены только для `status='processing'`
 * (`[РАСШИРЕНИЕ]`).
 */
export interface PharmacyTerminalQueueItemDto {
  readonly id: string
  readonly orderNumber: string
  readonly status: string
  readonly itemsCount: number
  readonly itemsTotalTjs: number
  readonly paymentMethod: string
  readonly prescriptionRequired: boolean
  readonly slaDeadlineAt: string | null
  readonly assignedPharmacistId: string | null
  readonly assignedPharmacistName: string | null
  readonly createdAt: string
}

/**
 * DTJ-301 (SRS-PHT-005a) — `meta.groupedBy` эндпоинта очереди, ТОЛЬКО когда `pharmacy_admin`
 * запросил `GET /orders` БЕЗ `filter[pharmacyId]` (агрегированный вид сети). Решение по формату
 * (тикет DTJ-301 ссылался на этот файл как «уже зафиксировано DTJ-300» — на деле DTJ-300 этот
 * формат НЕ фиксировал, см. отчёт сдачи DTJ-301, foundIssue): словарь `pharmacyId → orderId[]`
 * (порядок id внутри каждой аптеки — тот же, что и в `data`), а НЕ плоское поле `pharmacyId` на
 * каждой позиции — `PharmacyTerminalQueueItemDto` выше 1:1 повторяет перечень полей SRS-PHT-006
 * (единственный, БЕЗ `pharmacyId`) для одноаптечного вида, менять его ради агрегированного случая
 * означало бы два разных контракта на один и тот же эндпоинт.
 */
export interface PharmacyTerminalQueueGroupedByDto {
  readonly pharmacyId: Readonly<Record<string, readonly string[]>>
}
