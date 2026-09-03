import { afterEach, describe, expect, it, vi } from 'vitest'
import { getClientEnv } from '@/shared/config/env'
import { fetchCheckoutCart } from './checkout-cart.api'

/**
 * `checkout-cart.api.spec.ts` (DTJ-235) — тот же приём мокинга `fetch`, что `features/cart/api/
 * cart.api.spec.ts` (DTJ-234).
 */

const CART_URL = `${getClientEnv().apiBaseUrl}/api/v1/cart`

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchCheckoutCart (DTJ-235)', () => {
  it('1. GET /api/v1/cart (без extendHold — checkout не продлевает холд, это делает CartScreen на входе)', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ data: { items: [] }, meta: { pharmacyGroups: [] } }), { status: 200 })),
    )
    await fetchCheckoutCart()
    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(CART_URL)
  })

  it('2. распаковывает items из data и pharmacyGroups из meta', async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: { items: [{ id: 'item-1', pharmacyId: 'pharm-1' }] },
            meta: { pharmacyGroups: [{ pharmacyId: 'pharm-1', pharmacyName: 'Салом', items: [], subtotalDiram: 5000 }] },
          }),
          { status: 200 },
        ),
      ),
    )
    const result = await fetchCheckoutCart()
    expect(result.items).toHaveLength(1)
    expect(result.pharmacyGroups).toEqual([
      { pharmacyId: 'pharm-1', pharmacyName: 'Салом', items: [], subtotalDiram: 5000 },
    ])
  })

  it('3. meta.pharmacyGroups отсутствует/не массив — фолбэк на пустой массив, не падает', async () => {
    stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ data: { items: [] }, meta: {} }), { status: 200 })),
    )
    const result = await fetchCheckoutCart()
    expect(result.pharmacyGroups).toEqual([])
  })
})
