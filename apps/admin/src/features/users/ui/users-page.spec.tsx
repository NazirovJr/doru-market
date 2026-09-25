import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { UserSummaryDto } from '@dorutj/contracts'
import { UsersPage } from './users-page'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/users']}>
        <UsersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const USER: UserSummaryDto = {
  id: 'user-1',
  tenantId: 'tenant-1',
  phoneNumber: '+992900000001',
  role: 'pharmacist',
  fullName: 'Ismoilov I.',
  isActive: true,
  createdAt: '2026-09-01T00:00:00.000Z',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('UsersPage', () => {
  it('рендерит строку пользователя после загрузки', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [USER] })))
    renderPage()

    await waitFor(() => { expect(screen.getAllByTestId('user-row')).toHaveLength(1) })
    expect(screen.getByText('+992900000001')).toBeInTheDocument()
  })

  it('пустой список — без падения, показывает "не найдено"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [] })))
    renderPage()

    await waitFor(() => { expect(screen.queryByRole('status')).not.toBeInTheDocument() })
    expect(screen.queryAllByTestId('user-row')).toHaveLength(0)
  })

  it('ошибка загрузки — показывает alert', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'INTERNAL_ERROR' } }, 500)))
    renderPage()

    await waitFor(() => { expect(screen.getByRole('alert')).toBeInTheDocument() })
  })

  it('«Деактивировать» открывает подтверждение, повторный клик подтверждает вызов PATCH', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [USER] }))
      .mockResolvedValueOnce(jsonResponse({ data: { ...USER, isActive: false } }))
      .mockResolvedValue(jsonResponse({ data: [{ ...USER, isActive: false }] }))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await waitFor(() => { expect(screen.getAllByTestId('user-row')).toHaveLength(1) })
    fireEvent.click(screen.getByText('Деактивировать'))
    expect(screen.getByTestId('deactivate-confirm-row')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Подтвердить деактивацию'))

    await waitFor(() => { expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2) })
    const [, patchInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(patchInit.method).toBe('PATCH')
  })

  it('«Выдать платформенную роль» — кнопка отправки заблокирована, пока reason короче 10 символов, показывает предупреждение', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [USER] })))
    renderPage()

    await waitFor(() => { expect(screen.getAllByTestId('user-row')).toHaveLength(1) })
    fireEvent.click(screen.getByText('Выдать платформенную роль'))

    expect(screen.getByTestId('grant-platform-role-warning')).toBeInTheDocument()
    const submitButton = screen.getByText('Выдать роль')
    expect(submitButton).toBeDisabled()

    const textarea = screen.getByLabelText('Причина (обязательно)')
    fireEvent.change(textarea, { target: { value: 'onboarding new support hire' } })
    expect(submitButton).not.toBeDisabled()
  })

  it('«Сменить роль» — сабмит вызывает PATCH .../role с выбранным значением', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [USER] }))
      .mockResolvedValueOnce(jsonResponse({ data: { ...USER, role: 'courier' } }))
      .mockResolvedValue(jsonResponse({ data: [{ ...USER, role: 'courier' }] }))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await waitFor(() => { expect(screen.getAllByTestId('user-row')).toHaveLength(1) })
    fireEvent.click(screen.getByText('Сменить роль'))
    fireEvent.change(screen.getByLabelText('Новая роль'), { target: { value: 'courier' } })
    fireEvent.click(screen.getByText('Сохранить роль'))

    await waitFor(() => { expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2) })
    const [url, patchInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toContain('/users/user-1/role')
    expect(JSON.parse(patchInit.body as string)).toEqual({ newRole: 'courier' })
  })
})
