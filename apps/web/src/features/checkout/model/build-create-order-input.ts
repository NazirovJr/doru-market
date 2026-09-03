import type { TranslateFunction } from '@dorutj/i18n'
import type { CartPharmacyGroupDto } from '@dorutj/contracts'
import type { CreateOrderInput } from '../api/create-order.api'
import type { CheckoutFormState } from './checkout-form.model'
import { composeDeliveryLandmark } from './compose-delivery-landmark'

/**
 * `build-create-order-input.ts` (DTJ-235, волна 6 — поправка CTO под SRS-ORD-023) — чистый
 * маппинг `CheckoutFormState` + список id строк корзины + группы корзины по аптекам → тело
 * `POST /orders` (`CreateOrderInput`, `api/create-order.api.ts`).
 *
 * Возвращает `null`, если состояние формы ещё не готово к отправке (та же форма несёт свою
 * защиту — `checkout-form.model.ts#validateCheckoutForm` — этот маппинг остаётся защитным
 * вторым рубежом: `checkout-screen.tsx` уже не должен звать `submit()` при `!isValid`, но если
 * бы позвал, сеть НЕ получила бы полузаполненное тело).
 *
 * `deliveryLandmark` (верхнеуровневое поле) vs `inlineAddress.landmarkText` — см.
 * `ResolveDeliveryAddressService.resolve` (бэкенд, прочитан целиком): для СОХРАНЁННОГО адреса
 * ориентир идёт ТОЛЬКО через верхнеуровневое `deliveryLandmark` (у сохранённого адреса нет
 * своего инлайн-поля в этом запросе); для ИНЛАЙН-адреса — через `inlineAddress.landmarkText`
 * (верхнеуровневое поле оставлено `null`, чтобы не дублировать один и тот же текст в двух
 * местах тела запроса).
 *
 * `expectedTotalDiramByPharmacy` (SRS-ORD-023, «Поправка CTO волна 6») — строится ИЗ
 * `CartPharmacyGroupDto.subtotalDiram` (`meta.pharmacyGroups`, `GET /api/v1/cart`) ключом
 * `pharmacyId`: это ИМЕННО та сумма позиций аптеки, которую пользователь видел на экране
 * checkout (`OrderSummarySection`, тот же источник данных). Доставка сюда сознательно НЕ
 * подмешивается — сервер сравнивает ожидание с суммой ПОЗИЦИЙ, не с итогом (см. JSDoc
 * `DetectPriceDriftService`, бэкенд); группа без товаров в текущей попытке checkout просто не
 * попадает в объект — сервер пропускает проверку дрейфа для той группы, которую клиент не
 * подтверждал (SRS-ORD-023: поле опционально по каждой группе).
 */
function buildExpectedTotalDiramByPharmacy(pharmacyGroups: readonly CartPharmacyGroupDto[]): Record<string, number> {
  return Object.fromEntries(pharmacyGroups.map((group) => [group.pharmacyId, group.subtotalDiram]))
}

/** Объект-параметр `buildCreateOrderInput` (C5, `max-params` ≤3) — весь контекст ОДНОГО checkout. */
export interface BuildCreateOrderInputContext {
  readonly state: CheckoutFormState
  readonly cartItemIds: readonly string[]
  readonly pharmacyGroups: readonly CartPharmacyGroupDto[]
}

export function buildCreateOrderInput(ctx: BuildCreateOrderInputContext, t: TranslateFunction): CreateOrderInput | null {
  const { state, cartItemIds, pharmacyGroups } = ctx
  const landmark = composeDeliveryLandmark(state, t)
  const expectedTotalDiramByPharmacy = buildExpectedTotalDiramByPharmacy(pharmacyGroups)

  if (state.addressMode === 'saved') {
    if (state.savedAddressId === null) {
      return null
    }
    return {
      cartItemIds: [...cartItemIds],
      deliveryAddressId: state.savedAddressId,
      inlineAddress: null,
      deliveryLandmark: landmark,
      paymentMethod: state.paymentMethod,
      expectedTotalDiramByPharmacy,
    }
  }

  const { addressText, latitude, longitude } = state.inlineAddress
  if (latitude === null || longitude === null || addressText.trim().length === 0) {
    return null
  }
  return {
    cartItemIds: [...cartItemIds],
    deliveryAddressId: null,
    inlineAddress: { addressText: addressText.trim(), landmarkText: landmark, latitude, longitude },
    deliveryLandmark: null,
    paymentMethod: state.paymentMethod,
    expectedTotalDiramByPharmacy,
  }
}
