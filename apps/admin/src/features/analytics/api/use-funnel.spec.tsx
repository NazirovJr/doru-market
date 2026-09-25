import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { getClientEnv } from '@/shared/api/http-client'
import { currentPeriod, isoWeekOf, useFunnel, useFunnelPeriod, type FunnelData } from './use-funnel'

const API_BASE = getClientEnv().apiBaseUrl

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function makeWrapper(): ({ children }: { readonly children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

const FUNNEL: FunnelData = {
  searchPerformed: 500,
  analogShown: 100,
  analogClicked: 20,
  addedToCart: 15,
  orderPlaced: 10,
  conversionRates: { shownToClicked: 0.2, clickedToCart: 0.75, cartToOrder: 0.666_67, overallShownToOrder: 0.1 },
  totalSavingsShownDiram: 100_000,
  totalSavingsRealizedDiram: 15_000,
  weeklyTrend: [{ weekLabel: '2026-08-03', realizedSavingsDiram: 1_000 }],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useFunnel', () => {
  it('GET /api/v1/analytics/funnel с tenantId и period в query', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: FUNNEL })))

    const { result } = renderHook(() => useFunnel('tenant-1', '2026-08'), { wrapper: makeWrapper() })

    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })

    const url = new URL(fetchMock.mock.calls[0]![0])
    expect(url.origin + url.pathname).toBe(`${API_BASE}/api/v1/analytics/funnel`)
    expect(url.searchParams.get('tenantId')).toBe('tenant-1')
    expect(url.searchParams.get('period')).toBe('2026-08')
    expect(result.current.data).toEqual(FUNNEL)
  })

  it('tenantId=null — запрос не выполняется (enabled: false)', () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: FUNNEL })))

    renderHook(() => useFunnel(null, '2026-08'), { wrapper: makeWrapper() })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('useFunnelPeriod', () => {
  it('дефолт — режим "month", period меняется при переключении на "week"', () => {
    const { result } = renderHook(() => useFunnelPeriod())

    expect(result.current.mode).toBe('month')
    const monthPeriod = result.current.period
    expect(monthPeriod).toMatch(/^\d{4}-\d{2}$/)

    act(() => { result.current.setMode('week') })

    expect(result.current.mode).toBe('week')
    expect(result.current.period).toMatch(/^\d{4}-W\d{2}$/)
  })
})

describe('isoWeekOf/currentPeriod', () => {
  it('2026-01-01 (четверг) → ISO-неделя 1 2026 года', () => {
    const { year, week } = isoWeekOf(new Date('2026-01-01T00:00:00.000Z'))

    expect(year).toBe(2026)
    expect(week).toBe(1)
  })

  it('2026-12-31 (четверг) → ISO-неделя 53 2026 года', () => {
    const { year, week } = isoWeekOf(new Date('2026-12-31T00:00:00.000Z'))

    expect(year).toBe(2026)
    expect(week).toBe(53)
  })

  it('currentPeriod("month") для фиксированной даты → "YYYY-MM"', () => {
    expect(currentPeriod('month', new Date('2026-02-15T00:00:00.000Z'))).toBe('2026-02')
  })

  it('currentPeriod("week") для фиксированной даты → "YYYY-Www"', () => {
    expect(currentPeriod('week', new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-W01')
  })
})
