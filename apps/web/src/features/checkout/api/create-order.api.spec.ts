import { afterEach, describe, expect, it, vi } from 'vitest'
import { getClientEnv } from '@/shared/config/env'
import { HttpError } from '@/shared/api/http-client'
import { createOrder, type CreateOrderInput } from './create-order.api'

/**
 * `create-order.api.spec.ts` (DTJ-235) — сетевой контракт `POST /api/v1/orders`: заголовок
 * `Idempotency-Key`, тело запроса, распаковка частичного успеха (`orders`+`failedGroups`).
 */

const ORDERS_URL = `${getClientEnv().apiBaseUrl}/api/v1/orders`
const IDEMPOTENCY_KEY = '11111111-1111-4111-8111-111111111111'

const INPUT: CreateOrderInput = {
  cartItemIds: ['item-1'],
  deliveryAddressId: null,
  inlineAddress: { addressText: 'ул. Рудаки, 12', landmarkText: null, latitude: 38.55, longitude: 68.78 },
  deliveryLandmark: null,
  paymentMethod: 'cash_courier',
}

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createOrder (DTJ-235)', () => {
  it('1. POST /api/v1/orders с заголовком Idempotency-Key и JSON-телом = input', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ data: { orders: [], failedGroups: [] } }), { status: 200 })),
    )
    await createOrder(INPUT, IDEMPOTENCY_KEY)

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(ORDERS_URL)
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(IDEMPOTENCY_KEY)
    // SRS-UX-052: запрос НЕ отменяется при уходе со страницы («Назад» браузера) — никакой
    // AbortSignal сюда намеренно не передаётся (см. JSDoc create-order.api.ts).
    expect(init?.signal).toBeUndefined()
    expect(JSON.parse(init?.body as string)).toEqual(INPUT)
  })

  it('2. частичный успех — оба массива непустые одновременно возвращаются как есть (AC2)', async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              orders: [
                { orderId: 'order-1', orderNumber: 'A-1', pharmacyId: 'pharm-1', status: 'confirmed', totalAmountDiram: 5000, paymentPending: false },
              ],
              failedGroups: [{ pharmacyId: 'pharm-2', reason: 'INSUFFICIENT_STOCK' }],
            },
            meta: { excludedItems: [] },
          }),
          { status: 200 },
        ),
      ),
    )

    const result = await createOrder(INPUT, IDEMPOTENCY_KEY)

    expect(result.orders).toHaveLength(1)
    expect(result.failedGroups).toHaveLength(1)
    expect(result.orders[0]?.orderId).toBe('order-1')
    expect(result.failedGroups[0]?.reason).toBe('INSUFFICIENT_STOCK')
  })

  it('3. ВСЕ группы провалились — 200 с пустым orders и непустым failedGroups (не трактуется как ошибка всего запроса)', async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ data: { orders: [], failedGroups: [{ pharmacyId: 'pharm-1', reason: 'PRICE_OR_STOCK_CHANGED' }] } }),
          { status: 200 },
        ),
      ),
    )

    const result = await createOrder(INPUT, IDEMPOTENCY_KEY)
    expect(result.orders).toEqual([])
    expect(result.failedGroups).toHaveLength(1)
  })

  it('4. 400 IDEMPOTENCY_KEY_REQUIRED — бросает HttpError с этим кодом (сервер отвечает без заголовка, дефект вызывающего кода)', async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'x' } }), { status: 400 }),
      ),
    )
    await expect(createOrder(INPUT, IDEMPOTENCY_KEY)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' })
  })

  it('5. 409 IDEMPOTENCY_KEY_CONFLICT (параллельный дубль с тем же ключом) — HttpError, не тихо проглатывается', async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { code: 'IDEMPOTENCY_KEY_CONFLICT', message: 'x' } }), { status: 409 }),
      ),
    )
    const error: unknown = await createOrder(INPUT, IDEMPOTENCY_KEY).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).status).toBe(409)
  })

  it('6. excludedItems из meta распаковывается (не теряется молча)', async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: { orders: [], failedGroups: [] },
            meta: { excludedItems: [{ cartItemId: 'item-9', reason: 'PHARMACY_SUSPENDED' }] },
          }),
          { status: 200 },
        ),
      ),
    )
    const result = await createOrder(INPUT, IDEMPOTENCY_KEY)
    expect(result.excludedItems).toEqual([{ cartItemId: 'item-9', reason: 'PHARMACY_SUSPENDED' }])
  })
})
