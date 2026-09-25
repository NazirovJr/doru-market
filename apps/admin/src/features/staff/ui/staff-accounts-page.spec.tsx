import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { StaffAccountSummaryDto } from '@dorutj/contracts'
import { ACCESS_TOKEN_STORAGE_KEY } from '@/shared/auth/current-role'
import { StaffAccountsPage } from './staff-accounts-page'

const CHAIN_A = '11111111-1111-1111-1111-111111111111'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

/** Не подписан (тесты не проверяют подпись — `decodeRoleFromAccessToken`/`decodeChainIdFromAccessToken` её не читают). */
function fakeJwt(payload: Record<string, unknown>): string {
  const base64url = (obj: unknown): string => btoa(JSON.stringify(obj)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  return `${base64url({ alg: 'none' })}.${base64url(payload)}.sig`
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/staff']}>
        <StaffAccountsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const STAFF: StaffAccountSummaryDto = {
  id: 'user-1',
  phoneNumber: '+992917123456',
  fullName: 'Ismoilov I.',
  role: 'pharmacist',
  pharmacyId: 'pharmacy-1',
  chainId: CHAIN_A,
  isActive: true,
  createdAt: '2026-09-01T00:00:00.000Z',
  courierProvisioned: null,
}

beforeEach(() => {
  localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, fakeJwt({ role: 'pharmacy_admin', chainId: CHAIN_A }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('StaffAccountsPage (DTJ-364)', () => {
  it('рендерит строку сотрудника после загрузки', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [STAFF] })))
    renderPage()

    await waitFor(() => { expect(screen.getAllByTestId('staff-account-row')).toHaveLength(1) })
    expect(screen.getByText('+992917123456')).toBeInTheDocument()
  })

  it('пустой список — без падения, показывает "не найдено"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [] })))
    renderPage()

    await waitFor(() => { expect(screen.queryByRole('status')).not.toBeInTheDocument() })
    expect(screen.queryAllByTestId('staff-account-row')).toHaveLength(0)
  })

  it('запрос списка всегда шлёт scope=own (сервер резолвит сеть из JWT, не из query)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await waitFor(() => { expect(fetchMock).toHaveBeenCalled() })
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('scope=own')
  })

  it('«Деактивировать» открывает подтверждение, подтверждение шлёт PATCH', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [STAFF] }))
      .mockResolvedValueOnce(jsonResponse({ data: { ...STAFF, isActive: false } }))
      .mockResolvedValue(jsonResponse({ data: [{ ...STAFF, isActive: false }] }))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await waitFor(() => { expect(screen.getAllByTestId('staff-account-row')).toHaveLength(1) })
    fireEvent.click(screen.getByText('Деактивировать'))
    expect(screen.getByTestId('deactivate-confirm-row')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Подтвердить деактивацию'))

    await waitFor(() => { expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2) })
    const [, patchInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(patchInit.method).toBe('PATCH')
  })

  it('форма создания: role=pharmacist показывает поле аптеки, role=courier — нет', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [] })))
    renderPage()

    expect(screen.getByLabelText('Аптека (ID)')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Роль'), { target: { value: 'courier' } })
    expect(screen.queryByLabelText('Аптека (ID)')).not.toBeInTheDocument()
  })

  it('создание pharmacist: сабмит шлёт ОДИН POST /staff-accounts (без provision-courier)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: { userId: 'new-user', role: 'pharmacist' } }))
      .mockResolvedValue(jsonResponse({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    fireEvent.change(screen.getByLabelText('Телефон', { exact: false }), { target: { value: '917123456' } })
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'New Employee' } })
    fireEvent.click(screen.getByText('Добавить сотрудника'))

    await waitFor(() => { expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2) })
    const postCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    expect(postCalls).toHaveLength(1)
    const [url, init] = postCalls[0] as [string, RequestInit]
    expect(url).toContain('/staff-accounts')
    expect(JSON.parse(init.body as string)).toMatchObject({ phone: '+992917123456', role: 'pharmacist', chainId: CHAIN_A })
  })

  it('создание courier: успех обоих шагов — POST /staff-accounts ЗАТЕМ POST /staff-accounts/:id/provision-courier', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: { userId: 'new-courier', role: 'courier' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'c-1' } }))
      .mockResolvedValue(jsonResponse({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    fireEvent.change(screen.getByLabelText('Роль'), { target: { value: 'courier' } })
    fireEvent.change(screen.getByLabelText('Телефон', { exact: false }), { target: { value: '917123457' } })
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'New Courier' } })
    fireEvent.click(screen.getByText('Добавить сотрудника'))

    await waitFor(() => {
      const provisionCall = fetchMock.mock.calls.find(([url]) => (url as string).includes('provision-courier'))
      expect(provisionCall).toBeDefined()
    })
    const provisionCall = fetchMock.mock.calls.find(([url]) => (url as string).includes('provision-courier')) as [string, RequestInit]
    expect(provisionCall[0]).toContain('/staff-accounts/new-courier/provision-courier')
  })

  it('создание courier: шаг 2 (provision-courier) падает → показывает partial_error, не молчит', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: { userId: 'new-courier', role: 'courier' } }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'INTERNAL_ERROR' } }, 500))
      .mockResolvedValue(jsonResponse({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    fireEvent.change(screen.getByLabelText('Роль'), { target: { value: 'courier' } })
    fireEvent.change(screen.getByLabelText('Телефон', { exact: false }), { target: { value: '917123458' } })
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Partial Fail Courier' } })
    fireEvent.click(screen.getByText('Добавить сотрудника'))

    await waitFor(() => { expect(screen.getByRole('alert')).toBeInTheDocument() })
  })
})
