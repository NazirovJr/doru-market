import { act, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { LocaleProvider } from '@/shared/config/locale-provider'
import { SUGGEST_DEBOUNCE_MS } from '../model/use-search-suggestions'
import { SearchBar } from './search-bar'

/**
 * `search-bar.spec.tsx` (DTJ-192).
 *
 * Сеть мокается через `vi.stubGlobal('fetch', ...)` — тот же приём, что `map-page.spec.tsx`/
 * `use-search-suggestions.spec.tsx`. `fireEvent` (не `@testing-library/user-event` — пакет НЕ
 * заведён в `apps/web/package.json`, ставить новые зависимости запрещено тикетом DTJ-192).
 *
 * **Стабилизация под нагрузкой (см. отчёт задачи стабилизации тестов).** Раньше `wait(ms)` ждал
 * РЕАЛЬНОЕ время через `setTimeout`, рассчитывая, что debounce (250мс) внутри SUT истечёт
 * раньше, чем истечёт `WAIT_TIMEOUT_MS` теста. Изолированно проходило, но под параллельным
 * `turbo run test` (4 CPU, все пакеты монорепо разом) реальный таймер SUT срабатывал с задержкой
 * от загрузки CPU, и тест либо не успевал зафиксировать сетевой вызов, либо гонка происходила
 * раньше расчётного момента — гейт падал нерегулярно. Фикс — `vi.useFakeTimers({ shouldAdvanceTime:
 * true })` (тот же приём, что `ImportProgressBar.spec.tsx`, DTJ-168 и
 * `use-search-suggestions.spec.tsx`): `wait(ms)` теперь детерминированно продвигает виртуальные
 * часы через `vi.advanceTimersByTimeAsync`, а `shouldAdvanceTime: true` оставляет `waitFor`
 * (реальные интервалы опроса) рабочим для промисов `fetch`/TanStack Query, довешивающихся ПОСЛЕ
 * срабатывания таймера debounce.
 *
 * Локаторы — `data-testid`/`role`, НЕ переведённый текст (дефолтная локаль проекта не русская —
 * см. инструкции тикета).
 */

const WAIT_TIMEOUT_MS = SUGGEST_DEBOUNCE_MS + 1000

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function suggestionItem(tradeName: string): { medicineId: string; tradeName: string; innName: string; matchedVia: string } {
  return { medicineId: `id-${tradeName}`, tradeName, innName: tradeName, matchedVia: 'prefix' }
}

/** Роут-заглушка `/search` — рендерит `location.search`, чтобы тест мог проверить, куда реально повёл `navigate()`, изолированно от настоящей `search-results-page.tsx` (DTJ-193). */
const SearchPageStub = (): ReactElement => {
  const location = useLocation()
  return (
    <div data-testid="search-page-stub">
      {location.pathname}
      {location.search}
    </div>
  )
}

function renderSearchBar(initialQuery?: string): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<SearchBar {...(initialQuery === undefined ? {} : { initialQuery })} />} />
            <Route path="/search" element={<SearchPageStub />} />
          </Routes>
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  )
}

function locationProbeText(): string {
  return screen.getByTestId('search-page-stub').textContent
}

/** Детерминированно продвигает виртуальные часы (debounce/fetch резолвятся асинхронно ВНЕ обработчика события, без `act` React ругается "not wrapped in act"). */
async function wait(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  window.localStorage.clear()
})

describe('SearchBar (DTJ-192)', () => {
  it('1. на монтировании — role=combobox, закрыт (aria-expanded=false), без активного descendant', () => {
    stubFetch(() => Promise.resolve(jsonResponse({ data: [] })))
    renderSearchBar()

    const input = screen.getByTestId('search-bar-input')
    expect(input).toHaveAttribute('role', 'combobox')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(input).not.toHaveAttribute('aria-activedescendant')
  })

  it('2. фокус на пустом поле без истории — открывает дропдаун и показывает trending (состояние "готово")', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ data: [suggestionItem('Тренд-1')] })))
    renderSearchBar()

    fireEvent.focus(screen.getByTestId('search-bar-input'))

    await waitFor(
      () => {
        expect(screen.getByTestId('search-bar-input')).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getAllByTestId('suggest-dropdown-option')).toHaveLength(1)
      },
      { timeout: WAIT_TIMEOUT_MS },
    )
  })

  it('3. ввод короче порога — сеть за НИМ не уходит, дропдаун в итоге скрыт', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: [] })))
    renderSearchBar()
    const input = screen.getByTestId('search-bar-input')

    // Реалистичный порядок событий браузера: сначала `focus` (сам по себе легитимно запрашивает
    // trending-фолбэк на пустом поле — тест 2), ЗАТЕМ ввод. Снимаем счётчик вызовов ПОСЛЕ focus,
    // чтобы изолированно проверить именно порог длины непустого ввода, а не смешивать его с
    // отдельным сценарием "пустое поле в фокусе".
    fireEvent.focus(input)
    await wait(WAIT_TIMEOUT_MS)
    const callsAfterFocus = fetchMock.mock.calls.length

    fireEvent.change(input, { target: { value: 'а' } })
    await wait(WAIT_TIMEOUT_MS)

    expect(fetchMock.mock.calls.length).toBe(callsAfterFocus)
    expect(screen.queryByTestId('suggest-dropdown')).not.toBeInTheDocument()
  })

  it('4. ошибка сети — role=alert в дропдауне', async () => {
    stubFetch(() => Promise.resolve(new Response(JSON.stringify({ error: { code: 'UNKNOWN_ERROR' } }), { status: 500 })))
    renderSearchBar()

    fireEvent.change(screen.getByTestId('search-bar-input'), { target: { value: 'парацетамол' } })

    await waitFor(
      () => {
        expect(screen.getByTestId('suggest-dropdown-error')).toBeInTheDocument()
      },
      { timeout: WAIT_TIMEOUT_MS },
    )
    expect(screen.getByTestId('suggest-dropdown-error')).toHaveAttribute('role', 'alert')
  })

  it('5. пустой результат — состояние "пусто" (role=status)', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ data: [] })))
    renderSearchBar()

    fireEvent.change(screen.getByTestId('search-bar-input'), { target: { value: 'зз' } })

    await waitFor(
      () => {
        expect(screen.getByTestId('suggest-dropdown-empty')).toBeInTheDocument()
      },
      { timeout: WAIT_TIMEOUT_MS },
    )
  })

  it('6. ArrowDown/ArrowUp двигают активный пункт (aria-activedescendant + aria-selected), обход циклический', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ data: [suggestionItem('Аспирин'), suggestionItem('Ношпа')] })))
    renderSearchBar()
    const input = screen.getByTestId('search-bar-input')

    fireEvent.change(input, { target: { value: 'ас' } })
    await waitFor(
      () => {
        expect(screen.getAllByTestId('suggest-dropdown-option')).toHaveLength(2)
      },
      { timeout: WAIT_TIMEOUT_MS },
    )

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    let options = screen.getAllByTestId('suggest-dropdown-option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0]?.id)

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    options = screen.getAllByTestId('suggest-dropdown-option')
    expect(options[1]).toHaveAttribute('aria-selected', 'true')

    // Циклический обход: ArrowDown с последнего пункта уходит обратно на первый.
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    options = screen.getAllByTestId('suggest-dropdown-option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')

    // ArrowUp с первого пункта уходит на последний.
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    options = screen.getAllByTestId('suggest-dropdown-option')
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
  })

  it('7. Enter на активном пункте — переход на /search?text=<tradeName>, запись в историю', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ data: [suggestionItem('Парацетамол')] })))
    renderSearchBar()
    const input = screen.getByTestId('search-bar-input')

    fireEvent.change(input, { target: { value: 'пар' } })
    await waitFor(
      () => {
        expect(screen.getAllByTestId('suggest-dropdown-option')).toHaveLength(1)
      },
      { timeout: WAIT_TIMEOUT_MS },
    )

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(screen.getByTestId('search-page-stub')).toBeInTheDocument()
    })
    expect(locationProbeText()).toBe(`/search?text=${encodeURIComponent('Парацетамол')}`)
    expect(JSON.parse(window.localStorage.getItem('dorutj:search-history:v1') ?? '[]')).toEqual(['Парацетамол'])
  })

  it('8. Enter БЕЗ активного пункта — переход по сырому введённому тексту', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ data: [] })))
    renderSearchBar()
    const input = screen.getByTestId('search-bar-input')

    fireEvent.change(input, { target: { value: 'редкий запрос' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(screen.getByTestId('search-page-stub')).toBeInTheDocument()
    })
    expect(locationProbeText()).toBe(`/search?text=${encodeURIComponent('редкий запрос')}`)
  })

  it('9. Escape закрывает дропдаун (aria-expanded=false, дропдаун размонтирован)', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ data: [suggestionItem('Аспирин')] })))
    renderSearchBar()
    const input = screen.getByTestId('search-bar-input')

    fireEvent.change(input, { target: { value: 'ас' } })
    await waitFor(
      () => {
        expect(screen.getByTestId('suggest-dropdown')).toBeInTheDocument()
      },
      { timeout: WAIT_TIMEOUT_MS },
    )

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('suggest-dropdown')).not.toBeInTheDocument()
  })

  it('10. клик по подсказке из истории (medicineId=null) — тоже переходит на /search?text=', async () => {
    window.localStorage.setItem('dorutj:search-history:v1', JSON.stringify(['Старый запрос']))
    stubFetch(() => Promise.resolve(jsonResponse({ data: [] })))
    renderSearchBar()

    fireEvent.focus(screen.getByTestId('search-bar-input'))
    await waitFor(() => {
      expect(screen.getAllByTestId('suggest-dropdown-option')).toHaveLength(1)
    })

    // `onMouseDown` (не `click`) — см. JSDoc `suggest-dropdown.tsx`: предотвращает blur инпута
    // ДО обработки выбора.
    fireEvent.mouseDown(screen.getByTestId('suggest-dropdown-option'))

    await waitFor(() => {
      expect(screen.getByTestId('search-page-stub')).toBeInTheDocument()
    })
    expect(locationProbeText()).toBe(`/search?text=${encodeURIComponent('Старый запрос')}`)
  })

  it('11. initialQuery (DTJ-193) — поле предзаполнено при монтировании, без пропа поведение не меняется', () => {
    stubFetch(() => Promise.resolve(jsonResponse({ data: [] })))
    renderSearchBar('уже введённый запрос')

    expect(screen.getByTestId('search-bar-input')).toHaveValue('уже введённый запрос')
  })
})
