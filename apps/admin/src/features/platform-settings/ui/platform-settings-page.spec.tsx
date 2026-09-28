import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PlatformSettingDto } from '@dorutj/contracts'
import { PlatformSettingsPage } from './platform-settings-page'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <PlatformSettingsPage />
    </QueryClientProvider>,
  )
}

const SETTINGS: readonly PlatformSettingDto[] = [
  { key: 'RATE_LIMIT_ANON_PER_MIN', currentValue: '100', descriptionKey: 'admin.platform_settings.key.rate_limit_anon_per_min', requiresRedeploy: true },
  { key: 'PAYMENT_PROVIDER_TIMEOUT_MS', currentValue: '8000', descriptionKey: 'admin.platform_settings.key.payment_provider_timeout_ms', requiresRedeploy: true },
]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PlatformSettingsPage', () => {
  it('рендерит по строке на каждый ключ — ключ/значение из ENV/описание', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: SETTINGS })))
    renderPage()

    await waitFor(() => { expect(screen.getAllByTestId('platform-settings-row')).toHaveLength(2) })
    expect(screen.getByText('RATE_LIMIT_ANON_PER_MIN')).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText('8000')).toBeInTheDocument()
  })

  it('АС2 — КАЖДАЯ строка несёт пометку «требует передеплоя», без исключений', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: SETTINGS })))
    renderPage()

    await waitFor(() => { expect(screen.getAllByTestId('platform-settings-row')).toHaveLength(2) })
    const badges = screen.getAllByTestId('platform-settings-redeploy-badge')
    expect(badges).toHaveLength(SETTINGS.length)
    expect(badges.every((badge) => Boolean(badge.textContent))).toBe(true)
  })

  it('экран строго READ-ONLY — ни одной кнопки/формы действия', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: SETTINGS })))
    renderPage()

    await waitFor(() => { expect(screen.getAllByTestId('platform-settings-row')).toHaveLength(2) })
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(document.querySelector('form')).toBeNull()
  })

  it('ошибка загрузки — показывает alert', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'INTERNAL_ERROR' } }, 500)))
    renderPage()

    await waitFor(() => { expect(screen.getByRole('alert')).toBeInTheDocument() })
  })
})
