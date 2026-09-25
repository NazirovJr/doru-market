import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { UndeliveredNotificationDto } from '../api/use-undelivered-notifications'
import { UndeliveredNotificationsPage } from './undelivered-notifications-page'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <UndeliveredNotificationsPage />
    </QueryClientProvider>,
  )
}

const GROUP: UndeliveredNotificationDto = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  eventType: 'order.paid',
  sourceEventId: 'event-1',
  attempts: [
    { channel: 'telegram', status: 'failed', failedReason: 'нет telegram_chat_id', attemptedAt: '2026-09-01T00:00:00.000Z' },
    { channel: 'sms', status: 'failed', failedReason: 'провайдер не реализован', attemptedAt: '2026-09-01T00:00:05.000Z' },
  ],
  lastAttemptAt: '2026-09-01T00:00:05.000Z',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('UndeliveredNotificationsPage', () => {
  it('рендерит строку группы после загрузки — получатель, событие, все каналы', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [GROUP] })))
    renderPage()

    await waitFor(() => { expect(screen.getAllByTestId('undelivered-notifications-row')).toHaveLength(1) })
    expect(screen.getByText('user-1')).toBeInTheDocument()
    expect(screen.getByText('order.paid')).toBeInTheDocument()
    expect(screen.getByText(/нет telegram_chat_id/)).toBeInTheDocument()
    expect(screen.getByText(/провайдер не реализован/)).toBeInTheDocument()
  })

  it('пустой список — без строк, показывает "не найдено", без падения', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [] })))
    renderPage()

    await waitFor(() => { expect(screen.queryByRole('status')).not.toBeInTheDocument() })
    expect(screen.queryAllByTestId('undelivered-notifications-row')).toHaveLength(0)
  })

  it('ошибка загрузки — показывает alert', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'INTERNAL_ERROR' } }, 500)))
    renderPage()

    await waitFor(() => { expect(screen.getByRole('alert')).toBeInTheDocument() })
  })

  it('"Показать ещё" запрашивает следующую страницу курсором из meta.pagination и добавляет строки', async () => {
    const secondGroup: UndeliveredNotificationDto = { ...GROUP, userId: 'user-2', sourceEventId: 'event-2' }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [GROUP], meta: { pagination: { nextCursor: 'cur-1', hasMore: true, limit: 50 } } }))
      .mockResolvedValueOnce(jsonResponse({ data: [secondGroup], meta: { pagination: { nextCursor: null, hasMore: false, limit: 50 } } }))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await waitFor(() => { expect(screen.getByRole('button')).toBeInTheDocument() })

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => { expect(screen.getAllByTestId('undelivered-notifications-row')).toHaveLength(2) })
  })

  it('нет ни одной кнопки-действия — экран строго READ-ONLY', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [GROUP] })))
    renderPage()

    await waitFor(() => { expect(screen.getAllByTestId('undelivered-notifications-row')).toHaveLength(1) })
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
