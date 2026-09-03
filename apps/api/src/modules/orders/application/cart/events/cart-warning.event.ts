/**
 * `CartWarningEvent` (EP-09, DTJ-223, SRS-ORD-004/SRS-DOM-175).
 *
 * НЕ доменное событие в outbox — не пересекает границу транзакции/сервиса (DTJ-223 «Что
 * сделать» §6). Простой application-level DTO, возвращаемый `AddCartItemUseCase` в
 * `warnings` результата; presentation-слой (DTJ-226) прокидывает его наружу как
 * `meta.warnings` ответа `POST /api/v1/cart/items`. Добавление товара это НЕ блокирует —
 * предупреждение сопровождает успешный ответ, не заменяет его.
 *
 * `*TradeName`/`substanceNames` (доработка DTJ-234, дефект приёмки) — до этой правки DTO нёс
 * только `existingMedicineId`/`newMedicineId` (UUID), предупреждение физически не могло назвать
 * ни препараты, ни само вещество пользователю. `existingMedicineTradeName: string | null` —
 * тот же приём, что `pharmacyName` в `cart-view.dto.ts`: медикамент уже лежит в корзине, но мог
 * быть снят с публикации между добавлением и этим вызовом — `null`, если снимок недоступен,
 * НИКОГДА не подставляется `existingMedicineId` вместо имени. `newMedicineTradeName` — ВСЕГДА
 * `string`: медикамент, добавляемый ЭТИМ вызовом, уже прошёл `getMedicineSnapshot`
 * (`AddCartItemUseCase.execute` бросает `NotFoundError` раньше, если снимка нет).
 */

/** Единственный тип предупреждения на сегодня: пересечение действующих веществ (SRS-ORD-004). */
export const CART_WARNING_DUPLICATE_SUBSTANCE = 'duplicate_substance' as const

export type CartWarningType = typeof CART_WARNING_DUPLICATE_SUBSTANCE

export interface CartWarningEvent {
  readonly type: CartWarningType
  /** Медикамент, уже лежащий в корзине, с которым обнаружено пересечение веществ. */
  readonly existingMedicineId: string
  readonly existingMedicineTradeName: string | null
  /** Медикамент, который добавляется этим вызовом. */
  readonly newMedicineId: string
  readonly newMedicineTradeName: string
  /** Названия ПЕРЕСЕКШИХСЯ действующих веществ (может быть больше одного). */
  readonly substanceNames: readonly string[]
}
