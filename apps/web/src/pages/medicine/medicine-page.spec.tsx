import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { LocaleProvider } from '@/shared/config/locale-provider'
import { getClientEnv } from '@/shared/config/env'
import MedicinePage from './medicine-page'

/**
 * `medicine-page.spec.tsx` (DTJ-104). См. JSDoc `medicine-page.tsx` — минимальный хост-стаб,
 * тест проверяет ТОЛЬКО: `:id` из маршрута доходит до `AnalogsBlock`/сети, и что реально
 * отправляется правильный запрос — не полноту экрана карточки товара (вне `files_owned`).
 */

const MEDICINE_ID = '11111111-1111-1111-1111-111111111111'

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function renderPage(id: string): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <MemoryRouter initialEntries={[`/medicines/${id}`]}>
          <Routes>
            <Route path="/medicines/:id" element={<MedicinePage />} />
          </Routes>
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MedicinePage (DTJ-104)', () => {
  it('1. :id из маршрута доходит до AnalogsBlock — реальный запрос к /medicines/:id/analogs', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(
        jsonResponse({
          data: {
            referenceMedicineId: MEDICINE_ID,
            items: [],
            savingsDiram: null,
            titleKey: 'catalog.analogs.title_neutral',
            disclaimer: 'Дисклеймер.',
          },
        }),
      ),
    )

    renderPage(MEDICINE_ID)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${getClientEnv().apiBaseUrl}/api/v1/medicines/${MEDICINE_ID}/analogs`)
    await waitFor(() => {
      expect(screen.getByTestId('analogs-disclaimer')).toHaveTextContent('Дисклеймер.')
    })
  })
})
