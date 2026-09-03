/**
 * `SplitCartByPharmacyUseCase` (EP-09, DTJ-223, SRS-ORD-002, «Что сделать» §4).
 *
 * Группирует позиции по `pharmacyId` и суммирует стоимость каждой группы. ЕДИНСТВЕННЫЙ
 * источник этой логики в кодовой базе (DoD DTJ-223 №4) — переиспользуется ДВАЖДЫ:
 * `meta.pharmacyGroups` в ответе `GET /api/v1/cart` (DTJ-225/226) и внутри `CheckoutUseCase`
 * (DTJ-227) для реального разбиения на N заказов.
 *
 * Вход — `PricedCartLineItem`, НЕ `CartItemRecord` репозитория: `cart_items` цену не хранит
 * (живой пересчёт — DTJ-225, вне периметра этого тикета), а `CheckoutUseCase` группирует уже
 * СНЯТЫЕ на checkout `OrderItem`, а не сырые строки корзины. Общий вход, независимый от
 * источника (корзина или заказ) — то, что делает класс переиспользуемым без дублирования
 * (DoD №4), это и есть контракт: «дай мне позиции с ценой и аптекой — я сгруппирую и посчитаю
 * итог», а не «я умею читать корзину».
 *
 * `distanceMeters` — сознательно ОТСУТСТВУЕТ на выходе (заполняется presentation-слоем при
 * наличии `GeoPoint` клиента, use case не обязан знать о геолокации, SRS-ORD-002).
 *
 * Деньги — исключительно через `Money` VO (правило 6 AGENTS.md): суммирование `bigint`
 * напрямую здесь запрещено себе намеренно, даже притом что результат был бы тем же, — VO
 * несёт инвариант неотрицательности и единую точку контроля переполнения/валюты.
 *
 * `pharmacyName: string | null` (доработка DTJ-225 по замечанию CTO): `null`, когда имя аптеки
 * неизвестно вызывающему (`OnboardingFacadePort.getPharmacyNames` не вернул запись). ЗАПРЕЩЕНО
 * подставлять `pharmacyId` вместо отсутствующего имени — UUID типонеотличим от строки в поле
 * `string`, такая подмена проходит все статические проверки и обнаруживается только в живом
 * интерфейсе («Аптека 3f2a91c8-...»). `string | null` заставляет вызывающего (DTJ-226)
 * обработать отсутствие имени явно.
 */
import { Injectable } from '@nestjs/common'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'

export interface PricedCartLineItem {
  readonly medicineId: string
  /**
   * ОПЦИОНАЛЬНОЕ поле (доработка DTJ-234, дефект приёмки) — НЕ `readonly medicineTradeName:
   * string`, хотя `GetCartUseCase.toPricedLine` (единственный источник для `GET /api/v1/cart`)
   * ВСЕГДА его заполняет. Этот тип переиспускается ДВАЖДЫ (DoD DTJ-223 №4, JSDoc файла выше) —
   * ВТОРОЙ потребитель, `CheckoutUseCase.buildPharmacyGroups` (`application/checkout/**`, чужой
   * периметр этой сессии, ЗАПРЕЩЕНО трогать), строит `PricedCartLineItem[]` без этого поля
   * (группировка для order-сплита, имя препарата туда не нужно). Сделать поле обязательным
   * сломало бы компиляцию `checkout.use-case.ts` — вне объёма этой правки и вне разрешённых
   * файлов. `CartPharmacyGroupItemDto.medicineTradeName` (contracts) поэтому тоже `| null`.
   */
  readonly medicineTradeName?: string
  readonly pharmacyId: string
  readonly pharmacyName: string | null
  readonly quantity: number
  readonly unitPriceDiram: bigint
}

export interface PharmacyGroup {
  readonly pharmacyId: string
  readonly pharmacyName: string | null
  readonly items: readonly PricedCartLineItem[]
  readonly subtotalDiram: bigint
  readonly distanceMeters?: number
}

interface MutableGroupAccumulator {
  readonly pharmacyName: string | null
  readonly items: PricedCartLineItem[]
  subtotal: Money
}

@Injectable()
export class SplitCartByPharmacyUseCase {
  execute(items: readonly PricedCartLineItem[]): readonly PharmacyGroup[] {
    const byPharmacy = new Map<string, MutableGroupAccumulator>()
    for (const item of items) {
      const lineTotal = Money.fromDiram(item.unitPriceDiram).multiplyByQuantity(item.quantity)
      const accumulator = byPharmacy.get(item.pharmacyId)
      if (accumulator === undefined) {
        byPharmacy.set(item.pharmacyId, { pharmacyName: item.pharmacyName, items: [item], subtotal: lineTotal })
      } else {
        accumulator.items.push(item)
        accumulator.subtotal = accumulator.subtotal.add(lineTotal)
      }
    }
    return [...byPharmacy.entries()].map(([pharmacyId, group]) => ({
      pharmacyId,
      pharmacyName: group.pharmacyName,
      items: group.items,
      subtotalDiram: group.subtotal.diram,
    }))
  }
}
