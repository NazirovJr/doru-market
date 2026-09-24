import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMedicineSuggest } from './use-medicine-suggest'

type FetchImpl = (input: string) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function searchItem(tradeName: string): unknown {
  return {
    medicineId: `id-${tradeName}`,
    tradeName,
    innName: tradeName,
    dosageForm: 'tablets',
    dosageStrength: '500 mg',
    imageUrl: null,
    isPrescriptionRequired: false,
    cheapestOffer: null,
    offersCountInRadius: 0,
    relevanceScore: 1,
  }
}

function wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useMedicineSuggest (DTJ-167, GET /medicines/search)', () => {
  it('запрос длины >= порога уходит в сеть, результат несёт dosageForm/dosageStrength (критерий приёмки 1)', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(new Response(JSON.stringify({ data: [searchItem('Цитрамон')] }), { status: 200 })))

    const { result } = renderHook(() => useMedicineSuggest('цитра', true), { wrapper })

    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })
    expect(result.current.data).toEqual([{ medicineId: 'id-Цитрамон', tradeName: 'Цитрамон', dosageForm: 'tablets', dosageStrength: '500 mg' }])

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('/api/v1/medicines/search')
    expect(url).toContain('text=')
  })

  it('запрос короче порога НЕ уходит в сеть', () => {
    const fetchMock = stubFetch(() => Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 })))
    renderHook(() => useMedicineSuggest('ц', true), { wrapper })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('enabled=false — сеть не вызывается, даже при валидной длине запроса', () => {
    const fetchMock = stubFetch(() => Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 })))
    renderHook(() => useMedicineSuggest('цитрамон', false), { wrapper })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
