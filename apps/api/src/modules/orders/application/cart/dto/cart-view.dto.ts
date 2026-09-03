/**
 * `CartViewDto` (EP-09, DTJ-225, SRS-ORD-010..012). Форма ответа `GetCartUseCase` — application-
 * уровневый DTO (даты — `Date`, деньги — `bigint` дирамов), НЕ wire-JSON: presentation-слой
 * (DTJ-226) сериализует его в HTTP-ответ.
 *
 * `priceDiram` (НЕ `priceTjs`, вопреки буквальному тексту тикета «Что сделать» §2, foundIssue):
 * правило 6 AGENTS.md — деньги ТОЛЬКО целые дирамы, никогда float/decimal-строка. Название
 * `priceTjs` намекало бы на десятичное TJS-представление; кодовая база последовательно
 * называет денежные поля суффиксом `Diram` даже там, где значение уходит в DTO/wire-границу
 * (`order.mapper.ts`: `unitPriceDiram`/`totalAmountDiram`, там же `bigint` → `Number` на
 * границе, суффикс сохраняется). Тот же приём, что отклонение сигнатуры `RemoveCartItemUseCase`
 * от буквального текста DTJ-223 (см. JSDoc там) — задокументированное отклонение, не молчаливое.
 *
 * `pharmacyName: string | null` (доработка по замечанию CTO, отчёт сдачи DTJ-225): источник —
 * `OnboardingFacadePort.getPharmacyNames` (батч, один вызов на все уникальные `pharmacyId`
 * корзины). `null`, когда имя неизвестно (аптека не найдена в источнике/`NullAdapter` до
 * DTJ-227) — ЗАПРЕЩЕНО подставлять `pharmacyId` вместо имени: `string`-поле, содержащее UUID
 * вместо отображаемого имени, типонеотличимо от настоящего имени и проходит все статические
 * проверки, обнаруживаясь только в живом интерфейсе.
 */
import type { PharmacyGroup } from '../split-cart-by-pharmacy.use-case.js'

/** SRS-ORD-012: тип предупреждения «в корзине больше, чем доступно». Единственный на сегодня. */
export const CART_ITEM_WARNING_INSUFFICIENT_STOCK = 'insufficient_stock' as const

export interface CartInsufficientStockWarning {
  readonly cartItemId: string
  readonly type: typeof CART_ITEM_WARNING_INSUFFICIENT_STOCK
  readonly availableQuantity: number
}

export interface CartItemViewDto {
  readonly id: string
  readonly cartId: string
  readonly medicineId: string
  /** DTJ-234 (дефект приёмки) — `medicines.trade_name`, `NOT NULL`, всегда есть, когда снимок есть. */
  readonly medicineTradeName: string
  readonly pharmacyId: string
  readonly pharmacyName: string | null
  readonly quantity: number
  /** Живая цена (SRS-ORD-010) — актуальная на момент запроса, НЕ снэпшот на момент добавления. */
  readonly priceDiram: bigint
  /** Живой остаток за вычетом чужих холдов (`AvailabilityCalculator`, DTJ-224). Не блокирует ничего. */
  readonly availableQuantity: number
  readonly addedAt: Date
}

export interface CartMetaDto {
  readonly pharmacyGroups: readonly PharmacyGroup[]
  /** SRS-ORD-012: `quantity в items` НЕ обрезается — предупреждение сопровождает, не заменяет. */
  readonly warnings: readonly CartInsufficientStockWarning[]
}

export interface CartViewDto {
  readonly items: readonly CartItemViewDto[]
  readonly meta: CartMetaDto
}
