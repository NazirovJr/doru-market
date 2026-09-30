import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { OnboardingQueuePage } from './onboarding-queue.page'

function page(ids: readonly string[], nextCursor: string | null): Response {
  const items = ids.map((id) => ({ id, status: 'pending_review', submittedAt: '2026-09-29T10:00:00.000Z', reviewReason: null, slaTargetAt: null }))
  return new Response(JSON.stringify({ data: { items, nextCursor, hasMore: nextCursor !== null } }))
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OnboardingQueuePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OnboardingQueuePage (DTJ-442)', () => {
  it('по умолчанию грузит аптеки и догружает следующую страницу по курсору', async () => {
    const fetchMock = vi.fn((input: string) => Promise.resolve(input.includes('cursor=c1') ? page(['p-3'], null) : page(['p-1', 'p-2'], 'c1')))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await waitFor(() => { expect(screen.getByRole('link', { name: /p-1/ })).toBeInTheDocument() })
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/admin/verifications/pharmacy-accounts?status=pending_review')

    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }))
    await waitFor(() => { expect(screen.getByRole('link', { name: /p-3/ })).toBeInTheDocument() })
    expect(screen.getAllByRole('link')).toHaveLength(3)
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).not.toBeInTheDocument()
  })

  it('пустая очередь и ошибка показываются сообщениями', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(page([], null)))
    renderPage()
    await waitFor(() => { expect(screen.getByText('Очередь пуста')).toBeInTheDocument() })
  })

  it('ошибка запроса — alert', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })))
    renderPage()
    await waitFor(() => { expect(screen.getByRole('alert')).toBeInTheDocument() })
  })
})
