import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { TenantSummaryDto } from '@dorutj/contracts'
import { TenantsListPage } from './tenants-list-page'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TenantsListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const TENANT: TenantSummaryDto = {
  id: 'tenant-1',
  slug: 'apteka-vasco',
  isNeutral: false,
  customDomain: 'vasco.example',
  brandName: 'Vasco',
  createdAt: '2026-09-01T00:00:00.000Z',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TenantsListPage', () => {
  it('рендерит строку тенанта после загрузки', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [TENANT] })))
    renderPage()

    await waitFor(() => { expect(screen.getAllByTestId('tenant-row')).toHaveLength(1) })
    expect(screen.getByText('Vasco')).toBeInTheDocument()
  })

  it('пустой список — таблица без строк, без падения', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [] })))
    renderPage()

    await waitFor(() => { expect(screen.queryByRole('status')).not.toBeInTheDocument() })
    expect(screen.queryAllByTestId('tenant-row')).toHaveLength(0)
  })

  it('ошибка загрузки — показывает alert', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'INTERNAL_ERROR' } }, 500)))
    renderPage()

    await waitFor(() => { expect(screen.getByRole('alert')).toBeInTheDocument() })
  })
})
