/**
 * `order-response.dto.ts` (EP-09, DTJ-233) — DTO ответов `CheckoutController`
 * (`POST /api/v1/orders`, `POST /api/v1/orders/:id/cancel`). Маппинг 1:1 из
 * `CheckoutResultDto`/`CancelOrderResult` (application, DTJ-227/232), поля НЕ переименованы
 * (JSON-контракт SRS-ORD-019/029 совпадает буквально с application-DTO).
 *
 * Типы ответа `POST /api/v1/orders` (`OrderResultResponseDto`/`FailedGroupResponseDto`/
 * `ExcludedItemResponseDto`/`CheckoutResponseDataDto`/`CheckoutResponseMetaDto`) перенесены в
 * `@dorutj/contracts` (волна 6, поправка CTO под SRS-ORD-023, «Перенос типов в contracts») —
 * `apps/web/features/checkout` потребляет ИХ ЖЕ, копия во фронте убрана. `CancelOrderResponseDataDto`
 * ниже НЕ перенесён — вне периметра этой правки (только `POST /orders`, не `.../cancel`).
 */
import type {
  CheckoutExcludedItemDto,
  CheckoutFailedGroupDto,
  CheckoutOrderResultDto,
  CheckoutResultDto,
} from '@/modules/orders/application/checkout/dto/checkout-result.dto.js'
import type { CancelOrderResult } from '@/modules/orders/application/order-lifecycle/dto/cancel-order-command.dto.js'
import type {
  CheckoutResponseDataDto,
  CheckoutResponseMetaDto,
  ExcludedItemResponseDto,
  FailedGroupResponseDto,
  OrderResultResponseDto,
} from '@dorutj/contracts'

export interface CancelOrderResponseDataDto {
  readonly orderId: string
  readonly status: string
  readonly refundIssued: boolean
}

function toOrderResultResponseDto(order: CheckoutOrderResultDto): OrderResultResponseDto {
  return {
    orderId: order.orderId,
    orderNumber: order.orderNumber,
    pharmacyId: order.pharmacyId,
    status: order.status,
    totalAmountDiram: order.totalAmountDiram,
    paymentPending: order.paymentPending,
  }
}

function toFailedGroupResponseDto(group: CheckoutFailedGroupDto): FailedGroupResponseDto {
  return { pharmacyId: group.pharmacyId, reason: group.reason, details: group.details }
}

function toExcludedItemResponseDto(item: CheckoutExcludedItemDto): ExcludedItemResponseDto {
  return { cartItemId: item.cartItemId, reason: item.reason }
}

export function toCheckoutResponseData(result: CheckoutResultDto): CheckoutResponseDataDto {
  return {
    orders: result.orders.map(toOrderResultResponseDto),
    failedGroups: result.failedGroups.map(toFailedGroupResponseDto),
  }
}

export function toCheckoutResponseMeta(result: CheckoutResultDto): CheckoutResponseMetaDto {
  return { excludedItems: result.meta.excludedItems.map(toExcludedItemResponseDto) }
}

export function toCancelOrderResponseData(result: CancelOrderResult): CancelOrderResponseDataDto {
  return { orderId: result.orderId, status: result.status, refundIssued: result.refundIssued }
}
