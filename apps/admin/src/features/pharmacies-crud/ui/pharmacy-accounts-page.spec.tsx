import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { PharmacyAccountAdminSummaryDto } from '@dorutj/contracts'
import { PharmacyAccountsPage } from './pharmacy-accounts-page'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/pharmacies']}>
        <PharmacyAccountsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const ACTIVE_ACCOUNT: PharmacyAccountAdminSummaryDto = {
  id: 'pharmacy-1',
  chainId: 'chain-1',
  chainName: 'Salom Network',
  name: 'Salom Pharmacy #1',
  status: 'active',
  licenseExpiryDate: '2027-01-01',
}

const TERMINATED_ACCOUNT: PharmacyAccountAdminSummaryDto = {
  id: 'pharmacy-2',
  chainId: null,
  chainName: null,
  name: 'Closed Pharmacy',
  status: 'terminated',
  licenseExpiryDate: null,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PharmacyAccountsPage', () => {
  it('рендерит строки для ВСЕХ статусов сразу, включая terminated (АС1 DTJ-353)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [ACTIVE_ACCOUNT, TERMINATED_ACCOUNT] })))
    renderPage()

    await waitFor(() => { expect(screen.getAllByTestId('pharmacy-account-row')).toHaveLength(2) })
    expect(screen.getByText('Salom Pharmacy #1')).toBeInTheDocument()
    expect(screen.getByText('Closed Pharmacy')).toBeInTheDocument()
  })

  it('строка без сети — колонка сети показывает прочерк, не падает', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [TERMINATED_ACCOUNT] })))
    renderPage()

    await waitFor(() => { expect(screen.getAllByTestId('pharmacy-account-row')).toHaveLength(1) })
    // Прочерк и в колонке "сеть", и в колонке "срок лицензии" (обе null у TERMINATED_ACCOUNT).
    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('пустой список — без падения, показывает "не найдено"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [] })))
    renderPage()

    await waitFor(() => { expect(screen.queryByRole('status')).not.toBeInTheDocument() })
    expect(screen.queryAllByTestId('pharmacy-account-row')).toHaveLength(0)
  })

  it('ошибка загрузки — показывает alert', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'INTERNAL_ERROR' } }, 500)))
    renderPage()

    await waitFor(() => { expect(screen.getByRole('alert')).toBeInTheDocument() })
  })

  it('строка ведёт на карточку заявки onboarding-queue', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [ACTIVE_ACCOUNT] })))
    renderPage()

    await waitFor(() => { expect(screen.getAllByTestId('pharmacy-account-row')).toHaveLength(1) })
    const link = screen.getByText('Salom Pharmacy #1').closest('a')
    expect(link).toHaveAttribute('href', '/admin/onboarding-queue/pharmacy-accounts/pharmacy-1')
  })
})
