import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getClientEnv } from '@/shared/config/env'
import { HttpError } from '@/shared/api/http-client'
import { useAuthStore } from '@/shared/api/auth-store'
import { useCartSessionStore } from '../model/cart-session-store'
import { addCartItem, fetchCart, removeCartItem, updateCartItemQuantity } from './cart.api'

/**
 * `cart.api.spec.ts` (DTJ-234).
 *
 * Мокает `fetch` напрямую (тот же приём, что `use-pharmacy-map-pins.spec.tsx`/
 * `search-bar.spec.tsx`). Кейс 6 — ОБЯЗАТЕЛЬНЫЙ по заданию: клиент принимает НОВЫЙ токен из
 * ответа и на СЛЕДУЮЩЕМ запросе шлёт именно его, не устаревший (правило 2 «Идентификация
 * корзины» тикета, D-EP09-23 — защита от session fixation).
 */

const CART_URL = `${getClientEnv().apiBaseUrl}/api/v1/cart`
const CART_ITEMS_URL = `${getClientEnv().apiBaseUrl}/api/v1/cart/items`
const SESSION_TOKEN_HEADER = 'x-cart-session-token'

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function jsonResponse(
  body: unknown,
  init: { readonly status?: number; readonly headers?: HeadersInit } = {},
): Response {
  const responseInit: ResponseInit =
    init.headers === undefined
      ? { status: init.status ?? 200 }
      : { status: init.status ?? 200, headers: init.headers }
  return new Response(JSON.stringify(body), responseInit)
}

function readHeader(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name)
}

beforeEach(() => {
  window.localStorage.clear()
  useCartSessionStore.setState({ sessionToken: null })
  useAuthStore.setState({ accessToken: null, refreshToken: null, user: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('cart.api (DTJ-234)', () => {
  it('1. fetchCart(false) — GET /api/v1/cart без extendHold в query', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(jsonResponse({ data: { items: [] }, meta: { pharmacyGroups: [], warnings: [] } })),
    )
    await fetchCart(false)
    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(CART_URL)
  })

  it('2. fetchCart(true) — GET /api/v1/cart?extendHold=true (SRS-ORD-005)', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(jsonResponse({ data: { items: [] }, meta: { pharmacyGroups: [], warnings: [] } })),
    )
    await fetchCart(true)
    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${CART_URL}?extendHold=true`)
  })

  it('3. гость без сохранённого токена — запрос БЕЗ X-Cart-Session-Token', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(jsonResponse({ data: { items: [] }, meta: { pharmacyGroups: [], warnings: [] } })),
    )
    await fetchCart(false)
    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(readHeader(init, SESSION_TOKEN_HEADER)).toBeNull()
  })

  it('4. гость с сохранённым токеном — запрос несёт X-Cart-Session-Token с этим значением', async () => {
    useCartSessionStore.getState().setToken('stored-token-a')
    const fetchMock = stubFetch(() =>
      Promise.resolve(jsonResponse({ data: { items: [] }, meta: { pharmacyGroups: [], warnings: [] } })),
    )
    await fetchCart(false)
    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(readHeader(init, SESSION_TOKEN_HEADER)).toBe('stored-token-a')
  })

  it('5. аутентифицированный пользователь (accessToken задан) — X-Cart-Session-Token НЕ шлётся, даже если сохранён', async () => {
    useCartSessionStore.getState().setToken('stored-token-a')
    useAuthStore.setState({ accessToken: 'jwt-access-token', refreshToken: null, user: null })
    const fetchMock = stubFetch(() =>
      Promise.resolve(jsonResponse({ data: { items: [] }, meta: { pharmacyGroups: [], warnings: [] } })),
    )
    await fetchCart(false)
    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(readHeader(init, SESSION_TOKEN_HEADER)).toBeNull()
    expect(readHeader(init, 'authorization')).toBe('Bearer jwt-access-token')
  })

  it('6. [правило 2] новый токен из ответа принимается и заменяет устаревший на СЛЕДУЮЩЕМ запросе', async () => {
    useCartSessionStore.getState().setToken('token-stale')
    const responses = [
      jsonResponse(
        { data: { items: [] }, meta: { pharmacyGroups: [], warnings: [] } },
        { headers: { [SESSION_TOKEN_HEADER]: 'token-issued-by-server' } },
      ),
      jsonResponse({ data: { items: [] }, meta: { pharmacyGroups: [], warnings: [] } }),
    ]
    let call = 0
    const fetchMock = stubFetch(() => {
      const response = responses[call] ?? responses[responses.length - 1]!
      call += 1
      return Promise.resolve(response)
    })

    // Запрос 1: клиент шлёт устаревший `token-stale`, сервер отвечает НОВЫМ `token-issued-by-server`.
    await fetchCart(false)
    expect(readHeader(fetchMock.mock.calls[0]?.[1], SESSION_TOKEN_HEADER)).toBe('token-stale')
    expect(useCartSessionStore.getState().sessionToken).toBe('token-issued-by-server')

    // Запрос 2: клиент ОБЯЗАН слать уже новый токен, не `token-stale`.
    await fetchCart(false)
    expect(readHeader(fetchMock.mock.calls[1]?.[1], SESSION_TOKEN_HEADER)).toBe('token-issued-by-server')
  })

  it('7. заголовок ответа читается даже когда тело — бизнес-ошибка (422/400 и т.п.)', async () => {
    useCartSessionStore.getState().setToken('token-stale')
    stubFetch(() =>
      Promise.resolve(
        jsonResponse(
          { error: { code: 'CONTROLLED_SUBSTANCE_FORBIDDEN', message: 'forbidden' } },
          { status: 422, headers: { [SESSION_TOKEN_HEADER]: 'token-issued-on-error' } },
        ),
      ),
    )
    await expect(addCartItem({ medicineId: 'm1', pharmacyId: 'p1', quantity: 1 })).rejects.toBeInstanceOf(
      HttpError,
    )
    expect(useCartSessionStore.getState().sessionToken).toBe('token-issued-on-error')
  })

  it('8. addCartItem — POST /cart/items, warnings из meta прокидываются как есть', async () => {
    stubFetch(() =>
      Promise.resolve(
        jsonResponse({
          data: {
            id: 'item-1',
            cartId: 'cart-1',
            medicineId: 'm1',
            pharmacyId: 'p1',
            quantity: 2,
            addedAt: '2026-01-01T00:00:00Z',
          },
          meta: {
            warnings: [{ type: 'duplicate_substance', existingMedicineId: 'm0', newMedicineId: 'm1' }],
          },
        }),
      ),
    )
    const result = await addCartItem({ medicineId: 'm1', pharmacyId: 'p1', quantity: 2 })
    expect(result.item.id).toBe('item-1')
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]?.type).toBe('duplicate_substance')
  })

  it('9. updateCartItemQuantity — ответ {removed:true} маппится в kind:"removed"', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ data: { removed: true } })))
    const result = await updateCartItemQuantity('item-1', 0)
    expect(result).toEqual({ kind: 'removed' })
  })

  it('10. updateCartItemQuantity — обычный ответ маппится в kind:"updated"', async () => {
    stubFetch(() =>
      Promise.resolve(
        jsonResponse({
          data: {
            id: 'item-1',
            cartId: 'cart-1',
            medicineId: 'm1',
            pharmacyId: 'p1',
            quantity: 3,
            addedAt: 'x',
          },
        }),
      ),
    )
    const result = await updateCartItemQuantity('item-1', 3)
    expect(result.kind).toBe('updated')
    expect(result.kind === 'updated' && result.item.quantity).toBe(3)
  })

  it('11. removeCartItem — 204 без тела резолвится успешно (не бросает UNKNOWN_ERROR на пустое тело)', async () => {
    stubFetch(() => Promise.resolve(new Response(null, { status: 204 })))
    await expect(removeCartItem('item-1')).resolves.toBeUndefined()
  })

  it('12. removeCartItem — статус, отличный от 204, бросает HttpError с реальным статусом', async () => {
    stubFetch(() => Promise.resolve(new Response(null, { status: 500 })))
    await expect(removeCartItem('item-1')).rejects.toMatchObject({ status: 500 })
  })

  it('13. removeCartItem бьёт в правильный URL с методом DELETE', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(new Response(null, { status: 204 })))
    await removeCartItem('item-42')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${CART_ITEMS_URL}/item-42`)
    expect(init?.method).toBe('DELETE')
  })
})
