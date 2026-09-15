/**
 * `MyTicketsList.spec.tsx` (DTJ-284, АС3: «у клиента есть 2 обращения в разных статусах —
 * отображаются оба, каждое с корректной локализованной подписью статуса»; гейт аутентификации).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { useAuthStore } from '@/shared/api/auth-store'
import { MyTicketsList } from './MyTicketsList'
import { renderWithProviders } from './test-utils'

const AUTHENTICATED_USER = { id: 'customer-1', role: 'customer', tenantId: 'tenant-1', phoneNumber: null, fullName: null }

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): void {
  vi.stubGlobal('fetch', vi.fn<FetchImpl>(impl))
}

function signIn(): void {
  useAuthStore.setState({ accessToken: 'test-token', refreshToken: 'test-refresh', user: AUTHENTICATED_USER })
}

beforeEach(() => {
  useAuthStore.setState({ accessToken: null, refreshToken: null, user: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MyTicketsList', () => {
  it('гость (без accessToken) → сообщение «войдите», fetch НЕ вызывается', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    renderWithProviders(<MyTicketsList />)

    expect(screen.getByTestId('my-tickets-unauthenticated')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('АС3 — 2 тикета в разных статусах → оба отображены с корректной локализованной подписью статуса', async () => {
    signIn()
    stubFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: [
              { id: 'ticket-1', category: 'other', status: 'open' },
              { id: 'ticket-2', category: 'payment_issue', status: 'resolved' },
            ],
          }),
          { status: 200 },
        ),
      ),
    )

    renderWithProviders(<MyTicketsList />)

    await waitFor(() => { expect(screen.getAllByTestId('my-ticket-row')).toHaveLength(2) })
    // `LocaleProvider` дефолтит на 'tj' (платформенный дефолт, `readStoredLocale()`) без явно
    // сохранённой локали в localStorage — тестовое окружение её не устанавливает.
    const statuses = screen.getAllByTestId('my-ticket-status').map((el) => el.textContent)
    expect(statuses).toEqual(['Кушода', 'Ҳал шуд'])
  })

  it('пустой список → сообщение "нет обращений"', async () => {
    signIn()
    stubFetch(() => Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 })))

    renderWithProviders(<MyTicketsList />)

    await waitFor(() => { expect(screen.getByTestId('my-tickets-empty')).toBeInTheDocument() })
  })
})
