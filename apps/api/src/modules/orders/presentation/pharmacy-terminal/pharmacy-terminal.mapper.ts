/**
 * `pharmacy-terminal.mapper.ts` (DTJ-301, EP-12, модуль 24 «Терминал фармацевта») — DTO↔domain
 * терминала (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.1: presentation не знает доменных
 * инвариантов, только маппинг структурированных полей — НЕ форматирует пользовательский текст
 * (i18n/цвета — забота клиента, DoD тикета)).
 *
 * `encodeQueueCursor` — НЕ переиспользует `encodeCursor`/`CursorPayload` из `@dorutj/contracts`
 * (`{v, id}`, обе части обязательны по типу): курсор очереди — ОДНА опаковая строка
 * (`OrderQueueSortPolicy.cursorValue`), УЖЕ несущая `orderId` последней строки СВОИМ суффиксом
 * (`order-queue-sort.policy.ts` JSDoc) — второй, структурно обязательный `id`-слот той же формы
 * был бы чистым дублированием, не новой информацией. Формат совместим с `CursorQueryPipe`
 * (`common/http/pipes/cursor-query.pipe.ts`) — тот декодирует ЛЮБОЙ `base64url(JSON{v,...})` и
 * читает только `.v`, лишние/отсутствующие поля не мешают.
 */
import type {
  EnvelopeMeta,
  PharmacyTerminalQueueGroupedByDto,
  PharmacyTerminalQueueItemDto,
  PartialFulfillmentRequestDto,
  HandoverOtpDto,
} from '@dorutj/contracts'
import type { OrderQueueRow } from '@/modules/orders/application/ports/order-repository.port.js'
import type { GetOrderQueueResult } from '@/modules/orders/application/pharmacy-terminal/get-order-queue.use-case.js'
import type { AcceptOrderResult } from '@/modules/orders/application/pharmacy-terminal/accept-order.use-case.js'
import type { ReclaimOrderResult } from '@/modules/orders/application/pharmacy-terminal/reclaim-order.use-case.js'
import type { ProposePartialFulfillmentResult } from '@/modules/orders/application/pharmacy-terminal/propose-partial-fulfillment.use-case.js'
import type { CompletePickingResult } from '@/modules/orders/application/pharmacy-terminal/complete-picking.use-case.js'
import type { GetHandoverOtpResult } from '@/modules/orders/application/pharmacy-terminal/get-handover-otp.use-case.js'
import type { RegenerateHandoverOtpResult } from '@/modules/orders/application/pharmacy-terminal/regenerate-handover-otp.use-case.js'

export function toQueueItemDto(row: OrderQueueRow): PharmacyTerminalQueueItemDto {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    itemsCount: row.itemsCount,
    itemsTotalTjs: row.itemsTotalTjs,
    paymentMethod: row.paymentMethod,
    prescriptionRequired: row.prescriptionRequired,
    slaDeadlineAt: row.slaDeadlineAt === null ? null : row.slaDeadlineAt.toISOString(),
    assignedPharmacistId: row.assignedPharmacistId,
    assignedPharmacistName: row.assignedPharmacistName,
    createdAt: row.createdAt.toISOString(),
  }
}

export function toQueueResponseData(result: GetOrderQueueResult): readonly PharmacyTerminalQueueItemDto[] {
  return result.items.map(toQueueItemDto)
}

/** SRS-PHT-005/005a — `meta.pagination` (конвенция `12-api-conventions...md` §1.1) + `meta.groupedBy`
 *  (`[РАСШИРЕНИЕ]`, ТОЛЬКО для агрегированного вида сети `pharmacy_admin`, см. JSDoc контракта). */
export function toQueueResponseMeta(result: GetOrderQueueResult, limit: number): EnvelopeMeta {
  const meta: EnvelopeMeta = {
    pagination: {
      nextCursor: encodeQueueCursor(result.nextCursor),
      hasMore: result.hasMore,
      limit,
    },
  }
  if (result.groupedByPharmacyId !== null) {
    const groupedBy: PharmacyTerminalQueueGroupedByDto = { pharmacyId: result.groupedByPharmacyId }
    meta.groupedBy = groupedBy
  }
  return meta
}

function encodeQueueCursor(raw: string | null): string | null {
  if (raw === null) return null
  return Buffer.from(JSON.stringify({ v: raw }), 'utf-8').toString('base64url')
}

/** SRS-PHT-008 — `POST /orders/:id/accept` ответ: `{ id, status, slaDeadlineAt, assignedPharmacistId }`. */
export interface AcceptOrderResponseData {
  readonly id: string
  readonly status: 'processing'
  readonly slaDeadlineAt: string
  readonly assignedPharmacistId: string
}

export function toAcceptResponseData(result: AcceptOrderResult): AcceptOrderResponseData {
  return {
    id: result.orderId,
    status: result.status,
    slaDeadlineAt: result.slaDeadlineAt.toISOString(),
    assignedPharmacistId: result.assignedPharmacistId,
  }
}

/** SRS-PHT-010 — `POST /orders/:id/reclaim` ответ: `{ id, assignedPharmacistId, slaDeadlineAt }`. */
export interface ReclaimOrderResponseData {
  readonly id: string
  readonly assignedPharmacistId: string
  readonly slaDeadlineAt: string | null
}

export function toReclaimResponseData(result: ReclaimOrderResult): ReclaimOrderResponseData {
  return {
    id: result.orderId,
    assignedPharmacistId: result.assignedPharmacistId,
    slaDeadlineAt: result.slaDeadlineAt === null ? null : result.slaDeadlineAt.toISOString(),
  }
}

/**
 * DTJ-304 (SRS-PHT-020) — `POST /orders/:id/propose-partial-fulfillment` ответ (`201`). Деньги —
 * `Number(bigint)` на границе JSON, тот же приём, что `order.mapper.ts`/`toQueueItemDto` выше
 * (значения заведомо в пределах `Number.MAX_SAFE_INTEGER` для реалистичных сумм заказа).
 */
export function toPartialFulfillmentResponseData(result: ProposePartialFulfillmentResult): PartialFulfillmentRequestDto {
  return {
    id: result.id,
    orderId: result.orderId,
    status: result.status,
    itemsSnapshot: result.itemsSnapshot,
    itemsTotalBeforeDiram: Number(result.itemsTotalBeforeDiram),
    itemsTotalAfterDiram: Number(result.itemsTotalAfterDiram),
    refundAmountDiram: Number(result.refundAmountDiram),
    expiresAt: result.expiresAt.toISOString(),
  }
}

/** DTJ-305 (SRS-PHT-027) — `POST /orders/:id/complete-picking` ответ (`200`): код вручения СРАЗУ в ответе. */
export interface CompletePickingResponseData {
  readonly orderId: string
  readonly status: 'picked_up'
  readonly handoverOtp: HandoverOtpDto
}

export function toCompletePickingResponseData(result: CompletePickingResult): CompletePickingResponseData {
  return {
    orderId: result.orderId,
    status: result.status,
    handoverOtp: {
      code: result.handoverOtp.code,
      expiresAt: result.handoverOtp.expiresAt.toISOString(),
      purpose: result.handoverOtp.purpose,
    },
  }
}

/** DTJ-306 (SRS-PHT-028) — `GET .../handover-otp`, форма 1:1 с `HandoverOtpDto`. */
export function toHandoverOtpDto(result: GetHandoverOtpResult): HandoverOtpDto {
  return {
    code: result.code,
    expiresAt: result.expiresAt.toISOString(),
    purpose: result.purpose,
  }
}

export interface RegenerateHandoverOtpResponseData extends HandoverOtpDto {
  readonly regenerationsUsed: number
}

/** DTJ-306 (SRS-PHT-029) — `POST .../handover-otp/regenerate`. */
export function toRegenerateHandoverOtpResponseData(
  result: RegenerateHandoverOtpResult,
): RegenerateHandoverOtpResponseData {
  return {
    code: result.code,
    expiresAt: result.expiresAt.toISOString(),
    purpose: result.purpose,
    regenerationsUsed: result.regenerationsUsed,
  }
}
