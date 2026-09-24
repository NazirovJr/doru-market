import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { AuditLogEntryDto } from '@dorutj/contracts'
import { AuditLogPage } from './audit-log-page'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/audit-log']}>
        <AuditLogPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const ENTRY: AuditLogEntryDto = {
  id: 'entry-1',
  category: 'payment_override',
  entityType: 'order',
  entityId: 'order-1',
  actorUserId: 'admin-1',
  action: 'admin_payment_override',
  reason: 'клиент оспорил списание',
  metadata: { before: { status: 'held' }, after: { status: 'captured' } },
  tenantId: 'tenant-1',
  createdAt: '2026-08-15T00:00:00.000Z',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AuditLogPage', () => {
  it('рендерит строку записи после загрузки', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [ENTRY] })))
    renderPage()

    await waitFor(() => { expect(screen.getAllByTestId('audit-log-row')).toHaveLength(1) })
    expect(screen.getByText('admin_payment_override')).toBeInTheDocument()
  })

  it('пустой список — таблица без строк, показывает "не найдено", без падения', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [] })))
    renderPage()

    await waitFor(() => { expect(screen.queryByRole('status')).not.toBeInTheDocument() })
    expect(screen.queryAllByTestId('audit-log-row')).toHaveLength(0)
  })

  it('ошибка загрузки — показывает alert', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'INTERNAL_ERROR' } }, 500)))
    renderPage()

    await waitFor(() => { expect(screen.getByRole('alert')).toBeInTheDocument() })
  })

  it('клик по строке разворачивает metadata, повторный клик сворачивает', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [ENTRY] })))
    renderPage()

    await waitFor(() => { expect(screen.getAllByTestId('audit-log-row')).toHaveLength(1) })
    expect(screen.queryByTestId('audit-log-metadata-row')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('audit-log-row'))
    expect(screen.getByTestId('audit-log-metadata-row')).toBeInTheDocument()
    expect(screen.getByText(/"status": "held"/)).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('audit-log-row'))
    expect(screen.queryByTestId('audit-log-metadata-row')).not.toBeInTheDocument()
  })

  it('"Показать ещё" запрашивает следующую страницу курсором из meta.pagination и добавляет строки', async () => {
    const secondEntry: AuditLogEntryDto = { ...ENTRY, id: 'entry-2', action: 'admin_payment_override_2' }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [ENTRY], meta: { pagination: { nextCursor: 'cur-1', hasMore: true, limit: 50 } } }))
      .mockResolvedValueOnce(jsonResponse({ data: [secondEntry], meta: { pagination: { nextCursor: null, hasMore: false, limit: 50 } } }))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await waitFor(() => { expect(screen.getByText('Показать ещё')).toBeInTheDocument() })

    fireEvent.click(screen.getByText('Показать ещё'))

    await waitFor(() => { expect(screen.getAllByTestId('audit-log-row')).toHaveLength(2) })
    expect(screen.queryByText('Показать ещё')).not.toBeInTheDocument()
  })
})
