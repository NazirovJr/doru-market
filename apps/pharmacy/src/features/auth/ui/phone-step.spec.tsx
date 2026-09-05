import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PhoneStep, formatPhone, toE164 } from '@/features/auth/ui/phone-step'

/**
 * DTJ-166 тест-план: «LoginPage валидирует формат телефона перед отправкой OTP-запроса».
 * Валидация физически живёт в `PhoneStep` (переиспользуется `LoginPage.tsx` без изменений
 * логики) — тестируем здесь: и чистые функции маски (`formatPhone`/`toE164`), и поведение формы
 * (кнопка задизейблена, пока не введено ровно 9 цифр; невалидный ввод НЕ уходит в OTP-запрос).
 * `fireEvent` — тот же приём взаимодействия, что `apps/web/src/features/search/ui/search-bar.spec.tsx`.
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderPhoneStep(onSuccess = vi.fn()): { onSuccess: typeof onSuccess } {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <PhoneStep onSuccess={onSuccess} />
    </QueryClientProvider>,
  )
  return { onSuccess }
}

describe('formatPhone / toE164 (чистые функции маски)', () => {
  it('форматирует 9 цифр в группы XX XXX XX XX', () => {
    expect(formatPhone('937001122')).toBe('93 700 11 22')
  })

  it('обрезает лишние цифры сверх 9', () => {
    expect(formatPhone('9370011229999')).toBe('93 700 11 22')
  })

  it('отбрасывает нецифровые символы', () => {
    expect(formatPhone('93-700-11-22')).toBe('93 700 11 22')
  })

  it('toE164 добавляет префикс +992 к очищенным цифрам', () => {
    expect(toE164('937001122')).toBe('+992937001122')
  })
})

describe('<PhoneStep /> — валидация перед отправкой OTP-запроса', () => {
  it('кнопка "Отправить код" задизейблена, пока введено меньше 9 цифр', () => {
    renderPhoneStep()

    const input = screen.getByRole('textbox')
    const button = screen.getByRole('button')
    expect(button).toBeDisabled()

    fireEvent.change(input, { target: { value: '93700' } })
    expect(button).toBeDisabled()
  })

  it('кнопка активна ровно при 9 введённых цифрах, невалидный ввод не отправляет запрос', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderPhoneStep()

    const input = screen.getByRole('textbox')
    const button = screen.getByRole('button')

    fireEvent.change(input, { target: { value: '93700112' } })
    expect(button).toBeDisabled()
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '937001122' } })
    expect(button).toBeEnabled()
  })

  it('успешный ввод 9 цифр и submit вызывают OTP-запрос с E.164-номером', async () => {
    const onSuccess = vi.fn()
    const fetchMock = vi.fn((_input: string, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { otpRequestId: 'req-1', expiresInSeconds: 300 } }), { status: 202 }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderPhoneStep(onSuccess)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '937001122' } })
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith('+992937001122', 'req-1')
    })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ phone: '+992937001122' })
  })

  it('INVALID_PHONE_FORMAT от сервера показывает подсказку по формату, форма не сбрасывается', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ error: { code: 'INVALID_PHONE_FORMAT' } }), { status: 400 })),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderPhoneStep()

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '937001122' } })
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(screen.getByTestId('phone-step-error')).toBeInTheDocument()
    })
    expect(input).toHaveValue('93 700 11 22')
  })
})
