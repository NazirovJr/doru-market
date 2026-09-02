import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { LocaleProvider } from '@/shared/config/locale-provider'
import { getClientEnv } from '@/shared/config/env'
import SearchResultsPage from './search-results-page'

/**
 * `search-results-page.spec.tsx` (DTJ-193, `SRS-CAT-011/018/075/077`, `TC-CAT-025`).
 *
 * Сеть мокается через `vi.stubGlobal('fetch', ...)` — тот же приём, что `map-page.spec.tsx`
 * (единый слой `httpGetJson(WithMeta)` → `fetch`, второй способ ходить в сеть не заводим).
 *
 * Локаторы — `data-testid`/`role`, НЕ переведённый текст (дефолтная локаль проекта не русская,
 * недостающие i18n-ключи в dev-режиме рендерятся как `[[missing: key]]` — см. инструкции тикета).
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
    innName: 'Вещество',
    dosageForm: 'таблетки',
    dosageStrength: '500 мг',
    imageUrl: null,
    isPrescriptionRequired: medicineId === 'rx',
    cheapestOffer:
      medicineId === 'no-offer'
        ? null
        : {
            pharmacyId: 'ph1',
            pharmacyName: 'Аптека №1',
            priceDiram: 1250,
            stockQuantity: 3,
            distanceMeters: 500,
            lastSyncedAt: '2026-09-01T00:00:00Z',
            isStale: false,
          },
    offersCountInRadius: 2,
    relevanceScore: 0.8,
  }
}

function renderSearchPage(initialEntry: string): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/search" element={<SearchResultsPage />} />
          </Routes>
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SearchResultsPage (DTJ-193)', () => {
  it('1. без ?text= в URL — состояние "нет запроса", сеть не запрашивается', () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: [] })))

    renderSearchPage('/search')

    expect(screen.getByTestId('search-results-no-query')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('2. загрузка — видно состояние "загрузка" до ответа API', async () => {
    let resolveFetch: (response: Response) => void = () => undefined
    stubFetch(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )

    renderSearchPage('/search?text=аспирин')

    await waitFor(() => {
      expect(screen.getByTestId('search-results-loading')).toBeInTheDocument()
    })

    resolveFetch(jsonResponse({ data: [] }))
    await waitFor(() => {
      expect(screen.queryByTestId('search-results-loading')).not.toBeInTheDocument()
    })
  })

  it('3. пустой результат — SRS-CAT-077, состояние "пусто", не 404/белый экран', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ data: [] })))

    renderSearchPage('/search?text=несуществующий')

    await waitFor(() => {
      expect(screen.getByTestId('search-results-empty')).toBeInTheDocument()
    })
  })

  it('4. сетевая ошибка — баннер + кнопка "Повторить" запускает повторный fetch', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ error: { code: 'UNKNOWN_ERROR' } }, 500)))

    renderSearchPage('/search?text=аспирин')

    await waitFor(() => {
      expect(screen.getByTestId('search-results-error')).toBeInTheDocument()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockImplementationOnce(() => Promise.resolve(jsonResponse({ data: [] })))
    fireEvent.click(screen.getByTestId('search-results-retry'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  it('5. деградация поиска (SRS-CAT-075/TC-CAT-025) — HTTP 503 показывает ОТДЕЛЬНЫЙ баннер, не generic-ошибку', async () => {
    stubFetch(() =>
      Promise.resolve(jsonResponse({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 503)),
    )

    renderSearchPage('/search?text=аспирин')

    await waitFor(() => {
      expect(screen.getByTestId('search-results-degraded')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('search-results-error')).not.toBeInTheDocument()
    expect(screen.getByTestId('search-results-degraded')).toHaveAttribute('role', 'alert')
  })

  it('6. есть результаты — карточки отрендерены, Rx-бейдж только у рецептурного товара', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ data: [resultItem('rx'), resultItem('otc')] })))

    renderSearchPage('/search?text=аспирин')

    await waitFor(() => {
      expect(screen.getAllByTestId('search-result-card')).toHaveLength(2)
    })
    expect(screen.getAllByTestId('search-result-rx-badge')).toHaveLength(1)
  })

  it('7. пагинация — кнопка "Загрузить ещё" видна при hasMore, дозагружает вторую страницу курсором', async () => {
    const fetchMock = stubFetch((url) => {
      if (url.includes('cursor=')) {
        return Promise.resolve(jsonResponse({ data: [resultItem('page2-item')] }))
      }
      return Promise.resolve(
        jsonResponse({ data: [resultItem('page1-item')], meta: { pagination: { nextCursor: 'c2', hasMore: true, limit: 20 } } }),
      )
    })

    renderSearchPage('/search?text=аспирин')

    await waitFor(() => {
      expect(screen.getByTestId('search-results-load-more')).toBeInTheDocument()
    })
    expect(screen.getAllByTestId('search-result-card')).toHaveLength(1)

    fireEvent.click(screen.getByTestId('search-results-load-more'))

    await waitFor(() => {
      expect(screen.getAllByTestId('search-result-card')).toHaveLength(2)
    })
    expect(fetchMock.mock.calls.some(([url]) => url.startsWith(`${searchUrl}?`) && url.includes('cursor=c2'))).toBe(true)
    expect(screen.queryByTestId('search-results-load-more')).not.toBeInTheDocument()
  })

  it('8. запрос сохранён в URL — прямое открытие ?text=<query> сразу бьёт в API этим текстом', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: [] })))

    renderSearchPage(`/search?text=${encodeURIComponent('парацетамол форте')}`)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    const [calledUrl] = fetchMock.mock.calls[0] as [string]
    // `fetch` уходит через `URLSearchParams.toString()` (`buildQueryString`, `shared/api/http-client.ts`),
    // которая кодирует пробел как `+`, не `%20` (в отличие от `encodeURIComponent` в самом URL строки 191).
    expect(calledUrl).toContain(new URLSearchParams({ text: 'парацетамол форте' }).toString())
  })

  it('9. возврат к поиску не теряет введённый запрос — SearchBar на странице результатов предзаполнен из URL', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ data: [] })))

    renderSearchPage(`/search?text=${encodeURIComponent('старый запрос')}`)

    await waitFor(() => {
      expect(screen.getByTestId('search-bar-input')).toHaveValue('старый запрос')
    })
  })
})
