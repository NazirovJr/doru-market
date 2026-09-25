import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { getClientEnv } from '@/shared/api/http-client'
import { useCreateStaffAccount, useDeactivateStaffAccount, StaffAccountCreatePartialError } from './use-staff-accounts'

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
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return function wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useDeactivateStaffAccount', () => {
  it('шлёт PATCH /staff-accounts/:id { isActive: false }', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: { id: 'user-1', isActive: false } })))
    const { result } = renderHook(() => useDeactivateStaffAccount(), { wrapper: makeWrapper() })

    act(() => { result.current.mutate('user-1') })
    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${API_BASE}/api/v1/staff-accounts/user-1`)
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ isActive: false })
  })
})

describe('useCreateStaffAccount', () => {
  it('role=pharmacist → ровно один вызов fetch (POST /staff-accounts)', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: { userId: 'new-1', role: 'pharmacist' } })))
    const { result } = renderHook(() => useCreateStaffAccount(), { wrapper: makeWrapper() })

    act(() => {
      result.current.mutate({ phone: '+992917000000', fullName: 'Test', role: 'pharmacist', chainId: 'chain-1', pharmacyId: 'pharmacy-1' })
    })
    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.data).toBe('new-1')
  })

  it('role=courier, шаг 2 padает → StaffAccountCreatePartialError с userId шага 1', async () => {
    const fetchMock = stubFetch((url) => {
      if (typeof url === 'string' && url.includes('provision-courier')) {
        return Promise.resolve(jsonResponse({ error: { code: 'INTERNAL_ERROR' } }, 500))
      }
      return Promise.resolve(jsonResponse({ data: { userId: 'new-courier', role: 'courier' } }))
    })
    const { result } = renderHook(() => useCreateStaffAccount(), { wrapper: makeWrapper() })

    act(() => {
      result.current.mutate({ phone: '+992917000001', fullName: 'Courier', role: 'courier', chainId: 'chain-1' })
    })
    await waitFor(() => { expect(result.current.isError).toBe(true) })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current.error).toBeInstanceOf(StaffAccountCreatePartialError)
    expect((result.current.error as StaffAccountCreatePartialError).userId).toBe('new-courier')
  })
})
