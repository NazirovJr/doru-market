import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { HandoverOtpDto } from '@dorutj/contracts'
import { useAuthStore } from '@/shared/api/auth-store'
import { HandoverOtpScreen } from './HandoverOtpScreen'

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function makeOtp(overrides: Partial<HandoverOtpDto> = {}): HandoverOtpDto {
  return { code: '4821', expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), purpose: 'delivery_handover', ...overrides }
}

function renderScreen(otp: HandoverOtpDto, onNextOrder = vi.fn()): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <HandoverOtpScreen orderId="order-1" initialOtp={otp} onNextOrder={onNextOrder} />
    </QueryClientProvider>,
  )
  return queryClient
}

beforeEach(() => {
  useAuthStore.setState({
    accessToken: 'token',
    refreshToken: 'refresh',
    user: { id: 'me', role: 'pharmacist', tenantId: 'tenant-1', phoneNumber: null, fullName: null },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  useAuthStore.setState({ accessToken: null, refreshToken: null, user: null })
})

describe('<HandoverOtpScreen /> (DTJ-312)', () => {
  it('показывает код крупно, кнопка «Обновить код» недоступна пока код не истёк', () => {
    renderScreen(makeOtp())
    expect(screen.getByTestId('handover-otp-code')).toHaveTextContent('4821')
    expect(screen.queryByTestId('handover-otp-regenerate-cta')).not.toBeInTheDocument()
  })

  it('код истёк — появляется «Обновить код», клик заменяет код целиком (старый не остаётся на экране)', async () => {
    const expiredOtp = makeOtp({ code: '1111', expiresAt: new Date(Date.now() - 1_000).toISOString() })
    stubFetch(() => Promise.resolve(jsonResponse({ data: { code: '9999', expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), purpose: 'delivery_handover' } })))
    renderScreen(expiredOtp)

    expect(screen.getByTestId('handover-otp-regenerate-cta')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('handover-otp-regenerate-cta'))

    await waitFor(() => { expect(screen.getByTestId('handover-otp-code')).toHaveTextContent('9999') })
    expect(screen.queryByTestId('handover-otp-code')).not.toHaveTextContent('1111')
    expect(screen.getAllByTestId('handover-otp-code')).toHaveLength(1)
  })

  it('429 RATE_LIMITED — сообщение с инструкцией обратиться в поддержку', async () => {
    const expiredOtp = makeOtp({ expiresAt: new Date(Date.now() - 1_000).toISOString() })
    stubFetch(() => Promise.resolve(jsonResponse({ error: { code: 'RATE_LIMITED' } }, 429)))
    renderScreen(expiredOtp)

    fireEvent.click(screen.getByTestId('handover-otp-regenerate-cta'))

    await waitFor(() => { expect(screen.getByTestId('handover-otp-regenerate-error')).toHaveTextContent('дастгирӣ') })
  })

  it('другой код ошибки (не RATE_LIMITED) — общее сообщение об ошибке обновления', async () => {
    const expiredOtp = makeOtp({ expiresAt: new Date(Date.now() - 1_000).toISOString() })
    stubFetch(() => Promise.resolve(jsonResponse({ error: { code: 'HANDOVER_OTP_NOT_FOUND' } }, 404)))
    renderScreen(expiredOtp)

    fireEvent.click(screen.getByTestId('handover-otp-regenerate-cta'))

    await waitFor(() => { expect(screen.getByTestId('handover-otp-regenerate-error')).toBeInTheDocument() })
    expect(screen.getByTestId('handover-otp-regenerate-error')).not.toHaveTextContent('дастгирӣ')
  })

  it('«К следующему заказу» — вызывает переданный колбэк', () => {
    const onNextOrder = vi.fn()
    renderScreen(makeOtp(), onNextOrder)
    fireEvent.click(screen.getByTestId('handover-otp-next-order-cta'))
    expect(onNextOrder).toHaveBeenCalledTimes(1)
  })

  it('без initialOtp (возврат на picked_up заказ) — подгружает код через GET', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ data: makeOtp({ code: '5555' }) })))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <HandoverOtpScreen orderId="order-1" onNextOrder={vi.fn()} />
      </QueryClientProvider>,
    )
    expect(screen.getByTestId('handover-otp-loading')).toBeInTheDocument()
    await waitFor(() => { expect(screen.getByTestId('handover-otp-code')).toHaveTextContent('5555') })
  })
})
