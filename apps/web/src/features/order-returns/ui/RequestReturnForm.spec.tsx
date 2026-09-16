/**
 * `RequestReturnForm.spec.tsx` (DTJ-276) — АС1 (причины формы, кроме `undelivered`), АС2
 * (двойной клик → РОВНО один `POST /api/v1/order-returns`, тот же приём, что
 * `checkout-screen.spec.tsx` DTJ-235 «АС1/TC-UX-004»).
 */
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { RequestReturnForm } from './RequestReturnForm'
import { renderWithProviders } from './test-utils'

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('RequestReturnForm (DTJ-276)', () => {
  it('АС1: delivered — рендерит все причины, кроме undelivered; причину и комментарий можно менять', () => {
    renderWithProviders(<RequestReturnForm orderId="order-1" orderStatus="delivered" />)

    expect(screen.getByTestId('request-return-reason-defect')).toBeInTheDocument()
    expect(screen.getByTestId('request-return-reason-wrong_item')).toBeInTheDocument()
    expect(screen.getByTestId('request-return-reason-customer_dispute_post_delivery')).toBeInTheDocument()
    expect(screen.queryByTestId('request-return-reason-undelivered')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('request-return-reason-wrong_item'))
    expect(screen.getByTestId('request-return-reason-wrong_item')).toBeChecked()

    fireEvent.change(screen.getByTestId('request-return-comment'), { target: { value: 'Коробка была вскрыта' } })
    expect(screen.getByTestId('request-return-comment')).toHaveValue('Коробка была вскрыта')
  })

  it('заказ вне доступного статуса (например, picked_up) — форма недоступна, причины не рендерятся', () => {
    renderWithProviders(<RequestReturnForm orderId="order-1" orderStatus="picked_up" />)

    expect(screen.getByTestId('request-return-unavailable')).toBeInTheDocument()
    expect(screen.queryByTestId('request-return-form')).not.toBeInTheDocument()
  })

  it('АС2: двойной быстрый клик по «Отправить» → РОВНО ОДИН POST /api/v1/order-returns, ОДИН Idempotency-Key', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { kind: 'return_created', orderReturn: { id: 'r1' } } }), { status: 201 }),
      ),
    )
    renderWithProviders(<RequestReturnForm orderId="order-1" orderStatus="delivered" />)

    fireEvent.click(screen.getByTestId('request-return-reason-defect'))
    const submitButton = screen.getByTestId('request-return-submit')
    act(() => {
      fireEvent.submit(screen.getByTestId('request-return-form'))
      fireEvent.submit(screen.getByTestId('request-return-form'))
    })

    expect(submitButton).toBeDisabled()
    await waitFor(() => { expect(screen.getByTestId('request-return-success')).toBeInTheDocument() })

    const postCalls = fetchMock.mock.calls.filter(([url, init]) => url.includes('/api/v1/order-returns') && init?.method === 'POST')
    expect(postCalls).toHaveLength(1)
  })

  it('ошибка сервера (например, RETURN_WINDOW_EXPIRED) — показывает сообщение об ошибке, кнопка разблокируется', async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { code: 'RETURN_WINDOW_EXPIRED', message: 'expired' } }), { status: 422 }),
      ),
    )
    renderWithProviders(<RequestReturnForm orderId="order-1" orderStatus="delivered" />)

    fireEvent.click(screen.getByTestId('request-return-reason-defect'))
    fireEvent.submit(screen.getByTestId('request-return-form'))

    await waitFor(() => { expect(screen.getByTestId('request-return-error')).toBeInTheDocument() })
    expect(screen.getByTestId('request-return-submit')).not.toBeDisabled()
  })

  it('onSuccess вызывается с результатом мутации после успешной отправки', async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { kind: 'return_created', orderReturn: { id: 'r1' } } }), { status: 201 }),
      ),
    )
    const onSuccess = vi.fn()
    renderWithProviders(<RequestReturnForm orderId="order-1" orderStatus="delivered" onSuccess={onSuccess} />)

    fireEvent.click(screen.getByTestId('request-return-reason-defect'))
    fireEvent.submit(screen.getByTestId('request-return-form'))

    await waitFor(() => { expect(onSuccess).toHaveBeenCalledWith({ kind: 'return_created', orderReturn: { id: 'r1' } }) })
  })
})
