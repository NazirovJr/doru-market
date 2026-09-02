import { afterEach, describe, expect, it, vi } from 'vitest'
import { getClientEnv } from '@/shared/config/env'
import { fetchSearchResults } from './search-results.api'

/**
 * `search-results.api.spec.ts` (DTJ-193).
 *
 * Мокает `fetch` напрямую (`vi.stubGlobal`), тот же приём, что `use-pharmacy-map-pins.ts`/
 * `map-page.spec.tsx`/`use-search-suggestions.spec.tsx` — единый слой `httpGetJson(WithMeta)`,
 * второй способ ходить в сеть не заводится.
 */

const searchUrl = `${getClientEnv().apiBaseUrl}/api/v1/medicines/search`

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function resultItem(medicineId: string): Record<string, unknown> {
  return {
    medicineId,
    tradeName: `Товар ${medicineId}`,
    innName: 'Действующее вещество',
    dosageForm: 'таблетки',
    dosageStrength: '500 мг',
    imageUrl: null,
    isPrescriptionRequired: false,
    cheapestOffer: null,
    offersCountInRadius: 0,
    relevanceScore: 0.5,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchSearchResults (DTJ-193)', () => {
  it('строит query из text/cursor и распаковывает meta.pagination в nextCursor/hasMore', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(
        jsonResponse({
          data: [resultItem('m1')],
          meta: { pagination: { nextCursor: 'cursor-2', hasMore: true, limit: 20 } },
        }),
      ),
    )

    const page = await fetchSearchResults('парацетамол', 'cursor-1')

    const [calledUrl] = fetchMock.mock.calls[0] ?? []
    expect(calledUrl).toBe(`${searchUrl}?text=${encodeURIComponent('парацетамол')}&cursor=cursor-1`)
    expect(page.items).toHaveLength(1)
    expect(page.nextCursor).toBe('cursor-2')
    expect(page.hasMore).toBe(true)
  })

  it('cursor не передан — не попадает в query-строку', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: [] })))

    await fetchSearchResults('аспирин', undefined)

    const [calledUrl] = fetchMock.mock.calls[0] ?? []
    expect(calledUrl).toBe(`${searchUrl}?text=${encodeURIComponent('аспирин')}`)
  })

  it('meta.pagination отсутствует в ответе — nextCursor=null, hasMore=false (не бросает)', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ data: [resultItem('m1')] })))

    const page = await fetchSearchResults('аспирин', undefined)

    expect(page.nextCursor).toBeNull()
    expect(page.hasMore).toBe(false)
  })

  it('503 (SRS-CAT-075) — пробрасывает HttpError со status=503', async () => {
    stubFetch(() =>
      Promise.resolve(jsonResponse({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 503)),
    )

    await expect(fetchSearchResults('аспирин', undefined)).rejects.toMatchObject({ status: 503 })
  })
})
