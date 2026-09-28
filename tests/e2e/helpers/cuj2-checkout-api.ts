import type { APIRequestContext } from '@playwright/test'

// API-хелперы корзины/checkout (DTJ-419) — в обход UI, т.к. `checkout-result-section.tsx` не
// рендерит `order.status` текстом и клиентский мьютекс двойного клика (`submitLockRef`) гасит
// второй сетевой запрос раньше, чем до сервера долетит второй `Idempotency-Key`.

interface MedicineSearchItem {
  readonly medicineId: string
  readonly tradeName: string
}

/** Каталог не входит в контракт сида (только имена) — id ищем через тот же поиск, что и UI. */
export async function findMedicineIdByTradeName(request: APIRequestContext, tradeName: string): Promise<string> {
  const response = await request.get(`/api/v1/medicines/search?q=${encodeURIComponent(tradeName)}`)
  if (!response.ok()) {
    throw new Error(`findMedicineIdByTradeName: GET /medicines/search вернул ${String(response.status())}`)
  }
  const body = (await response.json()) as { data: readonly MedicineSearchItem[] }
  const match = body.data.find((item) => item.tradeName === tradeName)
  if (match === undefined) {
    throw new Error(`findMedicineIdByTradeName: «${tradeName}» не найден в результатах поиска каталога`)
  }
  return match.medicineId
}

export interface AddedCartItem {
  readonly cartItemId: string
}

export async function addCartItem(
  request: APIRequestContext,
  accessToken: string,
  input: { readonly medicineId: string; readonly pharmacyId: string; readonly quantity: number },
): Promise<AddedCartItem> {
  const response = await request.post('/api/v1/cart/items', {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: input,
  })
  if (!response.ok()) {
    throw new Error(`addCartItem: POST /cart/items вернул ${String(response.status())}: ${await response.text()}`)
  }
  const body = (await response.json()) as { data: { id: string } }
  return { cartItemId: body.data.id }
}

/** Форма `CreateOrderRequestDto` — повторена буквально, `@dorutj/e2e` не зависит от `@dorutj/contracts`. */
export interface CreateOrderApiInput {
  readonly cartItemIds: readonly string[]
  readonly paymentMethod: 'cash_courier' | 'dc_next' | 'alif_mobi'
  readonly inlineAddress: {
    readonly addressText: string
    readonly landmarkText: string | null
    readonly latitude: number
    readonly longitude: number
  }
}

export interface CreateOrderApiResult {
  readonly status: number
  readonly body: unknown
}

/** Объект-параметр (C5, `max-params` ≤3) — общий для `createOrderViaApi`/`createOrderViaFetch`. */
export interface CreateOrderCall {
  readonly accessToken: string
  readonly idempotencyKey: string
  readonly input: CreateOrderApiInput
}

export async function createOrderViaApi(request: APIRequestContext, call: CreateOrderCall): Promise<CreateOrderApiResult> {
  const response = await request.post('/api/v1/orders', {
    headers: { Authorization: `Bearer ${call.accessToken}`, 'Idempotency-Key': call.idempotencyKey },
    data: call.input,
  })
  return { status: response.status(), body: await response.json() }
}

export const DUSHANBE_DEMO_ADDRESS: CreateOrderApiInput['inlineAddress'] = {
  addressText: 'ул. Рудаки 1',
  landmarkText: 'рядом с ЦУМ',
  latitude: 38.5598,
  longitude: 68.787,
}

// То же, что `createOrderViaApi`, но через `fetch` — `APIRequestContext` на практике сериализует
// два `.post()` внутри одного `Promise.all` (живым прогоном: оба получали один кэшированный ответ
// вместо 409 у одного из них), независимые `fetch` реально гонятся одновременно.
export async function createOrderViaFetch(baseUrl: string, call: CreateOrderCall): Promise<CreateOrderApiResult> {
  const response = await fetch(`${baseUrl}/api/v1/orders`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${call.accessToken}`,
      'Idempotency-Key': call.idempotencyKey,
    },
    body: JSON.stringify(call.input),
  })
  return { status: response.status, body: await response.json() }
}
