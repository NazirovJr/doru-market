/**
 * `CreateTicketForm.spec.tsx` (DTJ-284, тест-план: «валидация обязательного текста, корректная
 * передача orderId в зависимости от точки входа»).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { CreateTicketForm } from './CreateTicketForm'
import { renderWithProviders } from './test-utils'

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CreateTicketForm', () => {
  it('пустое описание → кнопка отправки задизейблена, fetch не вызывается', () => {
    const fetchMock = stubFetch(() => Promise.resolve(new Response(JSON.stringify({ data: {} }), { status: 201 })))
    renderWithProviders(<CreateTicketForm />)

    fireEvent.click(screen.getByTestId('create-ticket-submit'))

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('АС1 — форма открыта с orderId → тело запроса несёт этот orderId', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(new Response(JSON.stringify({ data: { id: 't1' } }), { status: 201 })))
    renderWithProviders(<CreateTicketForm orderId="order-42" />)

    fireEvent.change(screen.getByTestId('create-ticket-description'), { target: { value: 'проблема с заказом' } })
    fireEvent.click(screen.getByTestId('create-ticket-submit'))

    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })
    const [, init] = fetchMock.mock.calls[0] ?? []
    const body = JSON.parse(init?.body as string) as Record<string, unknown>
    expect(body.orderId).toBe('order-42')
  })

  it('АС2 — форма открыта БЕЗ orderId → тело запроса не содержит ключ orderId', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(new Response(JSON.stringify({ data: { id: 't2' } }), { status: 201 })))
    renderWithProviders(<CreateTicketForm />)

    fireEvent.change(screen.getByTestId('create-ticket-description'), { target: { value: 'общая проблема' } })
    fireEvent.click(screen.getByTestId('create-ticket-submit'))

    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })
    const [, init] = fetchMock.mock.calls[0] ?? []
    const body = JSON.parse(init?.body as string) as Record<string, unknown>
    expect('orderId' in body).toBe(false)
  })

  it('успешная отправка → onCreated вызван с id тикета, поле описания очищено', async () => {
    stubFetch(() => Promise.resolve(new Response(JSON.stringify({ data: { id: 'ticket-99' } }), { status: 201 })))
    const onCreated = vi.fn()
    renderWithProviders(<CreateTicketForm onCreated={onCreated} />)

    fireEvent.change(screen.getByTestId('create-ticket-description'), { target: { value: 'что-то пошло не так' } })
    fireEvent.click(screen.getByTestId('create-ticket-submit'))

    await waitFor(() => { expect(onCreated).toHaveBeenCalledWith('ticket-99') })
    expect(screen.getByTestId('create-ticket-description')).toHaveValue('')
  })
})
