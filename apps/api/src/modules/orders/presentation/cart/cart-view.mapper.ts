/**
 * `cart-view.mapper.ts` (EP-09, DTJ-226) — конвертация application-DTO (`Date`/`bigint`,
 * `CartViewDto`/`CartItemRecord`/`CartWarningEvent`, DTJ-223/224/225) в wire-DTO
 * (`@dorutj/contracts/orders.ts`, ISO-строки, `number` для денег) для `CartController`.
 * Presentation собирает wire-формат ИЗ этих записей, не наоборот (JSDoc `cart.repository.
 * port.ts`/`cart-view.dto.ts`) — весь маппинг живёт здесь, а не разбросан по хендлерам
 * контроллера (держит их короче лимита C1, `max-lines-per-function` ≤40).
 */
import {
  type CartDuplicateSubstanceWarningDto,
  type CartInsufficientStockWarningDto,
  type CartItemResponseDto,
  type CartPharmacyGroupDto,
  type CartViewMetaDto,
  type CartViewResponseDto,
} from '@dorutj/contracts'
import type {
  CartInsufficientStockWarning,
  CartItemViewDto,
  CartViewDto,
} from '@/modules/orders/application/cart/dto/cart-view.dto.js'
import type { PharmacyGroup } from '@/modules/orders/application/cart/split-cart-by-pharmacy.use-case.js'
import type { CartItemRecord } from '@/modules/orders/application/cart/ports/cart.repository.port.js'
import type { CartWarningEvent } from '@/modules/orders/application/cart/events/cart-warning.event.js'

export function toCartViewResponseDto(view: CartViewDto): CartViewResponseDto {
  return { items: view.items.map(toCartItemResponseDto) }
}

export function toCartViewMetaDto(view: CartViewDto): CartViewMetaDto {
  return {
    pharmacyGroups: view.meta.pharmacyGroups.map(toPharmacyGroupDto),
    warnings: view.meta.warnings.map(toInsufficientStockWarningDto),
  }
}

function toCartItemResponseDto(item: CartItemViewDto): CartItemResponseDto {
  return {
    id: item.id,
    cartId: item.cartId,
    medicineId: item.medicineId,
    medicineTradeName: item.medicineTradeName,
    pharmacyId: item.pharmacyId,
    pharmacyName: item.pharmacyName,
    quantity: item.quantity,
    priceDiram: Number(item.priceDiram),
    availableQuantity: item.availableQuantity,
    addedAt: item.addedAt.toISOString(),
  }
}

function toInsufficientStockWarningDto(warning: CartInsufficientStockWarning): CartInsufficientStockWarningDto {
  // `warning.type` — литеральный тип `'insufficient_stock'`, структурно совпадающий с
  // `CartInsufficientStockWarningDto['type']` (обе стороны — `'x' as const`), каста не нужно.
  return { cartItemId: warning.cartItemId, type: warning.type, availableQuantity: warning.availableQuantity }
}

function toPharmacyGroupDto(group: PharmacyGroup): CartPharmacyGroupDto {
  return {
    pharmacyId: group.pharmacyId,
    pharmacyName: group.pharmacyName,
    items: group.items.map((line) => ({
      medicineId: line.medicineId,
      // `PricedCartLineItem.medicineTradeName` опционально (см. JSDoc там) — `??  null`, НЕ
      // подстановка id: путь `GET /cart` (единственный, что доходит до этого маппера) ВСЕГДА
      // заполняет поле в `GetCartUseCase.toPricedLine`, `undefined` сюда практически не приходит.
      medicineTradeName: line.medicineTradeName ?? null,
      pharmacyId: line.pharmacyId,
      pharmacyName: line.pharmacyName,
      quantity: line.quantity,
      unitPriceDiram: Number(line.unitPriceDiram),
    })),
    subtotalDiram: Number(group.subtotalDiram),
    ...(group.distanceMeters === undefined ? {} : { distanceMeters: group.distanceMeters }),
  }
}

/** `POST/PATCH /api/v1/cart/items*` — строка корзины КАК ЕСТЬ, без живой цены/остатка/имени
 *  аптеки (те требуют батч-запросов `GetCartUseCase`, вне ответственности мутации одной
 *  строки — тот же контракт, что `CartItemRecord` самого репозитория, DTJ-223). */
export interface CartItemRecordResponseDto {
  readonly id: string
  readonly cartId: string
  readonly medicineId: string
  readonly pharmacyId: string
  readonly quantity: number
  readonly addedAt: string
}

export function toCartItemRecordResponseDto(item: CartItemRecord): CartItemRecordResponseDto {
  return {
    id: item.id,
    cartId: item.cartId,
    medicineId: item.medicineId,
    pharmacyId: item.pharmacyId,
    quantity: item.quantity,
    addedAt: item.addedAt.toISOString(),
  }
}

export function toDuplicateSubstanceWarningDto(warning: CartWarningEvent): CartDuplicateSubstanceWarningDto {
  // Тот же приём, что toInsufficientStockWarningDto — литеральные типы структурно совпадают.
  return {
    type: warning.type,
    existingMedicineId: warning.existingMedicineId,
    existingMedicineTradeName: warning.existingMedicineTradeName,
    newMedicineId: warning.newMedicineId,
    newMedicineTradeName: warning.newMedicineTradeName,
    substanceNames: warning.substanceNames,
  }
}
