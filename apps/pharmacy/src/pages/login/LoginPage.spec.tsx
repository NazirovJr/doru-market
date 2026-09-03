import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import LoginPage from '@/pages/login/LoginPage'
import { useAuthStore } from '@/shared/api/auth-store'

/**
 * DTJ-166 критерий приёмки 4: роль `customer`/`courier` технически проходит OTP-verify
 * (эндпоинт роле-агностичен, `use-verify-otp.ts`), но `LoginPage` обязана отклонить доступ ДО
 * навигации на `/inventory` — очистить сессию, показать сообщение, вернуть на шаг «телефон».
 * Также покрывает критерий приёмки 2 (успешный вход персонала аптеки → редирект на /inventory).
 */

const OTP_REQUEST_URL = 'http://localhost:3000/api/v1/auth/otp/request'
const OTP_VERIFY_URL = 'http://localhost:3000/api/v1/auth/otp/verify'

afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.setState({ accessToken: null, refreshToken: null, user: null })
})

function renderLoginPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/inventory" element={<div>inventory-screen</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function stubOtpFlow(role: string): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: string) => {
    if (input === OTP_REQUEST_URL) {
      return Promise.resolve(
        new Response(JSON.stringify({ data: { otpRequestId: 'req-1', expiresInSeconds: 300 } }), { status: 202 }),
      )
    }
    if (input === OTP_VERIFY_URL) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              accessToken: 'access-1',
              refreshToken: 'refresh-1',
              user: { id: 'u1', role, tenantId: 't1', phoneNumber: '+992937001122', fullName: null },
            },
          }),
          { status: 200 },
        ),
      )
    }
    throw new Error(`unexpected fetch: ${input}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function submitPhoneAndCode(): Promise<void> {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '937001122' } })
  fireEvent.click(screen.getByRole('button'))

  await waitFor(() => {
    expect(screen.getByTestId('code-step')).toBeInTheDocument()
  })
  const cells = screen.getAllByRole('textbox')
  ;['1', '2', '3', '4', '5', '6'].forEach((digit, index) => {
    fireEvent.change(cells[index] as HTMLInputElement, { target: { value: digit } })
  })
}

describe('<LoginPage /> — критерий приёмки 4 (роль не персонала аптеки отклоняется)', () => {
  it('customer: OTP технически успешен, но доступ отклонён — сессия очищена, остаёмся на /login', async () => {
    renderLoginPage()
    stubOtpFlow('customer')

    await submitPhoneAndCode()

    await waitFor(() => {
      expect(screen.getByTestId('role-denied-error')).not.toHaveTextContent('')
    })
    expect(screen.queryByText('inventory-screen')).not.toBeInTheDocument()
    expect(screen.getByTestId('phone-step')).toBeInTheDocument()
    expect(useAuthStore.getState().accessToken).toBeNull()
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('courier: тот же отказ, что и customer', async () => {
    renderLoginPage()
    stubOtpFlow('courier')

    await submitPhoneAndCode()

    await waitFor(() => {
      expect(screen.getByTestId('role-denied-error')).toBeInTheDocument()
    })
    expect(useAuthStore.getState().accessToken).toBeNull()
  })

  it('критерий приёмки 2: pharmacist — успешный вход, редирект на /inventory', async () => {
    renderLoginPage()
    stubOtpFlow('pharmacist')

    await submitPhoneAndCode()

    await waitFor(() => {
      expect(screen.getByText('inventory-screen')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('role-denied-error')).not.toBeInTheDocument()
    expect(useAuthStore.getState().accessToken).toBe('access-1')
  })

  it('pharmacy_admin — успешный вход, редирект на /inventory', async () => {
    renderLoginPage()
    stubOtpFlow('pharmacy_admin')

    await submitPhoneAndCode()

    await waitFor(() => {
      expect(screen.getByText('inventory-screen')).toBeInTheDocument()
    })
  })
})
