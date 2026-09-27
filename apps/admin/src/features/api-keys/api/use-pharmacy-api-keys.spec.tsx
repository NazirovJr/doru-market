import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { getClientEnv } from '@/shared/api/http-client'
import { useCreatePharmacyApiKey, usePharmacyApiKeys, useRevokePharmacyApiKey, useRotatePharmacyApiKey, useSetPharmacyApiKeyMtls } from './use-pharmacy-api-keys'

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

describe('usePharmacyApiKeys', () => {
  it('GET /pharmacy-accounts/:id/api-keys, БЕЗ секрета в ответе', async () => {
    const summary = { id: 'key-1', keyPrefix: 'abc12345', isActive: true, createdAt: '2026-01-01T00:00:00.000Z' }
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: [summary] })))
    const { result } = renderHook(() => usePharmacyApiKeys('pharmacy-1'), { wrapper: makeWrapper() })

    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })

    expect(fetchMock.mock.calls[0]?.[0]).toContain(`${API_BASE}/api/v1/pharmacy-accounts/pharmacy-1/api-keys`)
    expect(result.current.data).toEqual([summary])
  })

  it('pharmacyId=null — не шлёт запрос', () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: [] })))
    renderHook(() => usePharmacyApiKeys(null), { wrapper: makeWrapper() })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('useCreatePharmacyApiKey', () => {
  it('POST /pharmacy-accounts/:id/api-keys — возвращает секрет РОВНО из этого ответа', async () => {
    const created = { id: 'key-1', apiKey: 'abc12345.abc12345secret', hmacSecret: 'abc12345secret', keyPrefix: 'abc12345', createdAt: '2026-01-01T00:00:00.000Z' }
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: created })))
    const { result } = renderHook(() => useCreatePharmacyApiKey('pharmacy-1'), { wrapper: makeWrapper() })

    act(() => { result.current.mutate() })
    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${API_BASE}/api/v1/pharmacy-accounts/pharmacy-1/api-keys`)
    expect(init.method).toBe('POST')
    expect(result.current.data).toEqual(created)
  })
})

describe('useRevokePharmacyApiKey', () => {
  it('POST /pharmacy-accounts/:id/api-keys/:keyId/revoke { reason }', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: { revoked: true } })))
    const { result } = renderHook(() => useRevokePharmacyApiKey('pharmacy-1'), { wrapper: makeWrapper() })

    act(() => { result.current.mutate({ keyId: 'key-1', reason: 'скомпрометирован' }) })
    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${API_BASE}/api/v1/pharmacy-accounts/pharmacy-1/api-keys/key-1/revoke`)
    expect(JSON.parse(init.body as string)).toEqual({ reason: 'скомпрометирован' })
  })
})

describe('useRotatePharmacyApiKey', () => {
  it('POST /pharmacy-accounts/:id/api-keys/:keyId/rotate с заголовком Idempotency-Key', async () => {
    const rotated = { id: 'key-2', apiKey: 'secret2x.secret2', hmacSecret: 'secret2', keyPrefix: 'secret2x', createdAt: '2026-01-02T00:00:00.000Z' }
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: rotated })))
    const { result } = renderHook(() => useRotatePharmacyApiKey('pharmacy-1'), { wrapper: makeWrapper() })

    act(() => { result.current.mutate('key-1') })
    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${API_BASE}/api/v1/pharmacy-accounts/pharmacy-1/api-keys/key-1/rotate`)
    expect(new Headers(init.headers).get('idempotency-key')).toBeTruthy()
    expect(result.current.data).toEqual(rotated)
  })
})

describe('useSetPharmacyApiKeyMtls', () => {
  it('PATCH /pharmacy-accounts/:id/api-keys/:keyId { requireMtls }', async () => {
    const summary = { id: 'key-1', keyPrefix: 'abc12345', isActive: true, requireMtls: true, createdAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null, revokedAt: null }
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: summary })))
    const { result } = renderHook(() => useSetPharmacyApiKeyMtls('pharmacy-1'), { wrapper: makeWrapper() })

    act(() => { result.current.mutate({ keyId: 'key-1', requireMtls: true }) })
    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${API_BASE}/api/v1/pharmacy-accounts/pharmacy-1/api-keys/key-1`)
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ requireMtls: true })
  })
})
