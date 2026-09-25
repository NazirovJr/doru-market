import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { getClientEnv } from '@/shared/config/env'
import { addSearchHistoryEntry } from './search-history'
import { MIN_SUGGEST_QUERY_LENGTH, SUGGEST_DEBOUNCE_MS, useSearchSuggestions } from './use-search-suggestions'

/**
 * `use-search-suggestions.spec.tsx` (DTJ-192).
 *
 * Мокает `fetch` напрямую (тот же приём, что `use-pharmacy-map-pins.spec.tsx`).
 *
 * **Стабилизация под нагрузкой (см. отчёт задачи стабилизации тестов).** Раньше файл ждал debounce
 * реальными миллисекундами (`setTimeout` + `await`) — изолированно проходило, но под параллельным
 * `turbo run test` (4 CPU, все пакеты монорепо разом) реальный `setTimeout` внутри SUT регулярно
 * срабатывал позже, чем тест успевал прождать фиксированный `AFTER_DEBOUNCE_MS`, и тест либо не
 * видел вызов `fetch`, либо ловил гонку раньше времени — гейт падал нерегулярно, хотя код SUT не
 * менялся. Фикс — `vi.useFakeTimers({ shouldAdvanceTime: true })` (тот же приём, что
 * `ImportProgressBar.spec.tsx`, DTJ-168): виртуальные часы продвигаются явным
 * `vi.advanceTimersByTimeAsync(ms)` вместо ожидания реального времени, поэтому таймер debounce
 * срабатывает детерминированно независимо от загрузки CPU; `shouldAdvanceTime: true` при этом
 * оставляет часы тикающими и в реальном времени — `waitFor` (который опрашивает через реальные
 * интервалы) продолжает работать для промисов `fetch`/TanStack Query, довешивающихся ПОСЛЕ
 * срабатывания таймера.
 */

const suggestUrl = `${getClientEnv().apiBaseUrl}/api/v1/medicines/suggest`
const DEBOUNCE_BUFFER_MS = 60
const AFTER_DEBOUNCE_MS = SUGGEST_DEBOUNCE_MS + DEBOUNCE_BUFFER_MS

type FetchImpl = (input: string) => Promise<Response>

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

/** Симулирует сетевую задержку ВНУТРИ `fetch`-мока — таймер тоже фейковый, продвигается через `advance()`/реальный тик `shouldAdvanceTime`. */
function networkDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** Детерминированно продвигает виртуальные часы теста (debounce SUT) вместо ожидания реального времени. */
async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

function wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

function renderSuggestions(initialQuery: string, enabled = true) {
  return renderHook(({ rawQuery, isEnabled }: { rawQuery: string; isEnabled: boolean }) => useSearchSuggestions(rawQuery, isEnabled), {
    wrapper,
    initialProps: { rawQuery: initialQuery, isEnabled: enabled },
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

describe('useSearchSuggestions (DTJ-192)', () => {
  it('1. дребезг: серия быстрых изменений ввода даёт РОВНО ОДИН сетевой запрос — с финальным значением', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: [suggestionItem('Парацетамол')] })))

    // Стартуем с однобуквенного ввода (ниже MIN_SUGGEST_QUERY_LENGTH — на монтировании сеть НЕ
    // дёргается вообще, см. тест 3), иначе первый рендер debounce не задерживает (это её штатное
    // поведение) и дал бы ложный "нулевой" вызов ДО серии быстрых правок ниже.
    const { rerender } = renderSuggestions('п')
    rerender({ rawQuery: 'по', isEnabled: true })
    rerender({ rawQuery: 'пар', isEnabled: true })
    rerender({ rawQuery: 'параце', isEnabled: true })

    await advance(AFTER_DEBOUNCE_MS)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${suggestUrl}?q=${encodeURIComponent('параце')}&limit=10`)
  })

  it('2. гонка ответов: устаревший (медленный) ответ на "по" не затирает более свежий результат по "пар"', async () => {
    const fetchMock = stubFetch((input: string) => {
      const isStaleQuery = input.includes('q=%D0%BF%D0%BE&')
      const delayMs = isStaleQuery ? AFTER_DEBOUNCE_MS * 2 : DEBOUNCE_BUFFER_MS
      const tradeName = isStaleQuery ? 'Устаревшее' : 'Свежее'
      return networkDelay(delayMs).then(() => jsonResponse({ data: [suggestionItem(tradeName)] }))
    })

    const { result, rerender } = renderSuggestions('по')
    await advance(AFTER_DEBOUNCE_MS)
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1) // устаревший запрос уже запущен, ждёт медленного resolve
    })

    rerender({ rawQuery: 'пар', isEnabled: true })
    await advance(AFTER_DEBOUNCE_MS)

    await waitFor(() => {
      expect(result.current.suggestions.map((item) => item.tradeName)).toEqual(['Свежее'])
    })

    // Ждём дольше, чем нужно устаревшему запросу на "по", чтобы убедиться: даже когда он ДОЙДЁТ,
    // отображаемый результат не откатится назад к "Устаревшее".
    await advance(AFTER_DEBOUNCE_MS * 2)
    expect(result.current.suggestions.map((item) => item.tradeName)).toEqual(['Свежее'])
  })

  it(`3. запрос короче ${String(MIN_SUGGEST_QUERY_LENGTH)} символов НЕ уходит в сеть (belowMinLength=true)`, async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: [] })))

    const { result } = renderSuggestions('а')
    await advance(AFTER_DEBOUNCE_MS)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.belowMinLength).toBe(true)
    expect(result.current.suggestions).toEqual([])
  })

  it(`4. запрос длины ровно ${String(MIN_SUGGEST_QUERY_LENGTH)} уходит в сеть`, async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: [suggestionItem('Аспирин')] })))

    const { result } = renderSuggestions('ас')
    await advance(AFTER_DEBOUNCE_MS)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    expect(result.current.belowMinLength).toBe(false)
  })

  it('5. пустой ввод, история пуста — идёт серверный trending-запрос (q="")', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: [suggestionItem('Тренд')] })))

    const { result } = renderSuggestions('')

    await waitFor(() => {
      expect(result.current.suggestions.map((item) => item.tradeName)).toEqual(['Тренд'])
    })
    expect(result.current.source).toBe('network')
    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${suggestUrl}?q=&limit=10`)
  })

  it('6. пустой ввод, история непуста — показана история, сеть НЕ вызывается вовсе', async () => {
    addSearchHistoryEntry('Ношпа')
    addSearchHistoryEntry('Аспирин')
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: [] })))

    const { result } = renderSuggestions('')

    await advance(AFTER_DEBOUNCE_MS)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.source).toBe('history')
    expect(result.current.suggestions.map((item) => item.tradeName)).toEqual(['Аспирин', 'Ношпа'])
  })

  it('7. enabled=false (дропдаун закрыт) — сеть не вызывается, даже если длина запроса валидна', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: [suggestionItem('X')] })))

    renderSuggestions('парацетамол', false)
    await advance(AFTER_DEBOUNCE_MS)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('8. состояние ошибки сети: isError=true, suggestions пуст', async () => {
    stubFetch(() => Promise.resolve(new Response(JSON.stringify({ error: { code: 'UNKNOWN_ERROR' } }), { status: 500 })))

    const { result } = renderSuggestions('парацетамол')

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })
    expect(result.current.suggestions).toEqual([])
  })
})
