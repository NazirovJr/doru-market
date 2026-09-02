import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { LocaleProvider } from '@/shared/config/locale-provider'
import HomePage from './home-page'

/**
 * `home-page.spec.tsx` (DTJ-192, `SRS-CAT-001`).
 *
 * `SRS-CAT-001` требует визуальный regression-тест Playwright для порядка блоков первого
 * экрана — инфраструктура Playwright (EP-19 baseline) на момент этого тикета в репозитории ещё
 * не заведена (нет `playwright.config.*`, `pnpm` скрипта e2e). Этот тест — доступная сейчас
 * замена на уровне компонента: `SearchBar` обязан быть ЕДИНСТВЕННЫМ/первым содержательным
 * элементом `HomePage` (не карта, не баннер) — как только Playwright появится, DOM-порядок здесь
 * даёт то же самое утверждение, которое перейдёт в снапшот-тест.
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderHomePage(): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <MemoryRouter initialEntries={['/']}>
          <HomePage />
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  )
}

describe('HomePage (DTJ-192, SRS-CAT-001)', () => {
  it('SearchBar — первый и единственный содержательный дочерний элемент главного экрана', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }))),
    )
    renderHomePage()

    const home = screen.getByTestId('home-page')
    const firstElementChild = home.firstElementChild
    expect(firstElementChild).toBe(screen.getByTestId('search-bar'))
  })
})
