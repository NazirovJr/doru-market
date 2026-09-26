import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { getClientEnv } from '@/shared/api/http-client'
import { useOnboardingFunnel, type OnboardingFunnelData } from './use-onboarding-funnel'

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

const ONBOARDING_FUNNEL: OnboardingFunnelData = [
  { decision: 'approved', averageDurationHours: 30, count: 7 },
  { decision: 'rejected', averageDurationHours: 12, count: 3 },
]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useOnboardingFunnel', () => {
  it('GET /api/v1/analytics/onboarding-funnel с tenantId и period в query', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: ONBOARDING_FUNNEL })))

    const { result } = renderHook(() => useOnboardingFunnel('tenant-1', '2026-08'), { wrapper: makeWrapper() })

    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })

    const url = new URL(fetchMock.mock.calls[0]![0])
    expect(url.origin + url.pathname).toBe(`${API_BASE}/api/v1/analytics/onboarding-funnel`)
    expect(url.searchParams.get('tenantId')).toBe('tenant-1')
    expect(url.searchParams.get('period')).toBe('2026-08')
    expect(result.current.data).toEqual(ONBOARDING_FUNNEL)
  })

  it('tenantId=null — запрос не выполняется (enabled: false)', () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: ONBOARDING_FUNNEL })))

    renderHook(() => useOnboardingFunnel(null, '2026-08'), { wrapper: makeWrapper() })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
