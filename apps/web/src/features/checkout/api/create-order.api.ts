import type {
  CheckoutResponseDataDto,
  CreateOrderInlineAddressDto,
  CreateOrderRequestDto,
  ExcludedItemResponseDto,
  FailedGroupResponseDto,
  OrderResultResponseDto,
} from '@dorutj/contracts'
import { requestJsonEnvelope } from '@/shared/api/http-client'

/**
 * `create-order.api.ts` (DTJ-235, EP-09, волна 6 — поправка CTO под SRS-ORD-023) — сетевой вызов
 * `POST /api/v1/orders` (бэкенд DTJ-233, `checkout.controller.ts`, прочитан целиком для этого
 * тикета).
 *
 * **Типы запроса/ответа — из `@dorutj/contracts` (`orders.ts`).** До этой правки они жили
 * ЛОКАЛЬНО, транскрибированные построчно с бэкенд-DTO (DTJ-235, задокументировано как DISPUTED в
 * отчёте сдачи) — третий такой случай в проекте после аналогов и корзины, накапливающийся долг
 * против правила 15 AGENTS.md. Перенесены в контракты вместе с этой правкой (см. отчёт сдачи,
 * раздел «Перенос типов в contracts») — `CreateOrderInput`/`CreateOrderResultItem`/
 * `CreateOrderFailedGroup`/`CreateOrderExcludedItem` ниже теперь просто алиасы на них: остальной
 * код фичи (модель/UI/тесты) продолжает импортировать привычные локальные имена ИЗ ЭТОГО файла,
 * а не дублирует форму заново.
 *
 * **`expectedTotalDiramByPharmacy` (SRS-ORD-023, «Поправка CTO волна 6») — ТЕПЕРЬ ОТПРАВЛЯЕТСЯ,
 * ПО ГРУППАМ.** Старая форма (ОДНО поле `expectedTotalDiram` на весь запрос) была намеренно НЕ
 * отправлена в исходной версии этого файла (DTJ-235, см. DISPUTED в старом отчёте сдачи) — при
 * мультиаптечной корзине она гарантированно рассинхронизировала бы минимум все группы, кроме
 * одной, чужим числом и создавала бы ЛОЖНЫЕ `PRICE_OR_STOCK_CHANGED`. Новая форма — объект
 * `{ [pharmacyId]: itemsTotalDiram }`, ключ на каждую аптеку корзины — устраняет обе причины:
 * сравнение идёт ПО ГРУППЕ (`build-create-order-input.ts` строит объект из
 * `CartPharmacyGroupDto.subtotalDiram`, которую клиент реально видел на экране) И по сумме
 * ПОЗИЦИЙ (без доставки, которую сервер считает и клиент на момент подтверждения не знает).
 *
 * **Запрос НЕ отменяется при unmount/навигации (SRS-UX-052).** `AbortSignal` НАМЕРЕННО не
 * передаётся в `requestJsonEnvelope` — в отличие от GET-запросов (`httpGetJson`, `signal`
 * пробрасывается ради устаревших автодополнений), кнопка «Назад» браузера ПОСЛЕ отправки не
 * обязана прервать уже летящий `POST /orders`: заказ обязан продолжить создаваться на сервере
 * независимо от того, остался ли пользователь на странице.
 */

const ORDERS_PATH = '/api/v1/orders'
const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key'

export type CreateOrderInlineAddress = CreateOrderInlineAddressDto
export type CreateOrderInput = CreateOrderRequestDto
export type CreateOrderResultItem = OrderResultResponseDto
export type CreateOrderFailedGroup = FailedGroupResponseDto
export type CreateOrderExcludedItem = ExcludedItemResponseDto

export interface CreateOrderResponse {
  readonly orders: readonly CreateOrderResultItem[]
  readonly failedGroups: readonly CreateOrderFailedGroup[]
  readonly excludedItems: readonly CreateOrderExcludedItem[]
}

function isJsonArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value)
}

export async function createOrder(input: CreateOrderInput, idempotencyKey: string): Promise<CreateOrderResponse> {
  const envelope = await requestJsonEnvelope<CheckoutResponseDataDto>(ORDERS_PATH, {
    method: 'POST',
    headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
    body: JSON.stringify(input),
  })
  const excludedItems = envelope.meta?.excludedItems
  return {
    orders: envelope.data.orders,
    failedGroups: envelope.data.failedGroups,
    excludedItems: isJsonArray(excludedItems) ? (excludedItems as readonly CreateOrderExcludedItem[]) : [],
  }
}
