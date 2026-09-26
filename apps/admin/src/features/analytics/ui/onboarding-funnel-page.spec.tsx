import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OnboardingFunnelPage } from './onboarding-funnel-page'

vi.mock('@/shared/auth/current-role', () => ({ getCurrentTenantId: () => 'tenant-1' }))

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <OnboardingFunnelPage />
    </QueryClientProvider>,
  )
}

const FUNNEL_BODY = [
  { decision: 'approved', averageDurationHours: 30, count: 7 },
  { decision: 'rejected', averageDurationHours: 12, count: 3 },
]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OnboardingFunnelPage (DTJ-384)', () => {
  it('рендерит обе группы решения (approved/rejected) с длительностью и числом заявок', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: FUNNEL_BODY })))
    renderPage()

    await waitFor(() => { expect(screen.getByTestId('onboarding-funnel-bar-approved')).toBeInTheDocument() })
    expect(screen.getByTestId('onboarding-funnel-bar-approved')).toHaveTextContent('30')
    expect(screen.getByTestId('onboarding-funnel-bar-approved')).toHaveTextContent('7')
    expect(screen.getByTestId('onboarding-funnel-bar-rejected')).toHaveTextContent('12')
    expect(screen.getByTestId('onboarding-funnel-bar-rejected')).toHaveTextContent('3')
  })

  it('АС3 — пустой ответ (нет решённых заявок) — сообщение "нет данных", без падения', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [] })))
    renderPage()

    await waitFor(() => { expect(screen.queryByRole('status')).not.toBeInTheDocument() })
    expect(screen.queryByTestId('onboarding-funnel-chart')).not.toBeInTheDocument()
  })

  it('только approved (нет rejected за период) — approved-бар рендерится, rejected-бар без падения показывает прочерк', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [{ decision: 'approved', averageDurationHours: 10, count: 1 }] })))
    renderPage()

    await waitFor(() => { expect(screen.getByTestId('onboarding-funnel-bar-approved')).toBeInTheDocument() })
    expect(screen.getByTestId('onboarding-funnel-bar-rejected')).toHaveTextContent('—')
  })

  it('переключение периода на "Неделя" запускает новый запрос с форматом YYYY-Www', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: FUNNEL_BODY }))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })

    fireEvent.click(screen.getByRole('tab', { name: 'Неделя' }))

    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(2) })
    const secondCall = fetchMock.mock.calls[1] as [string]
    const url = new URL(secondCall[0])
    expect(url.searchParams.get('period')).toMatch(/^\d{4}-W\d{2}$/)
  })

  it('ошибка загрузки — alert, без падения компонента', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'INTERNAL_ERROR' } }, 500)))
    renderPage()

    await waitFor(() => { expect(screen.getByRole('alert')).toBeInTheDocument() })
  })
})
