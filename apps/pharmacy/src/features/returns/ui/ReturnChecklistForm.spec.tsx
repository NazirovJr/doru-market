import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReturnChecklistForm } from './ReturnChecklistForm'

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderForm(props: { readonly controlCategory?: 'none' | 'psychotropic'; readonly onClose?: () => void } = {}): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ReturnChecklistForm returnId="ret-1" onClose={props.onClose ?? vi.fn()} {...(props.controlCategory !== undefined && { controlCategory: props.controlCategory })} />
    </QueryClientProvider>,
  )
}

/** DTJ-277 критерий приёмки 1/2. */
describe('<ReturnChecklistForm />', () => {
  it('controlCategory=none (или отсутствует) — переключатель packagingIntact активен', () => {
    renderForm()
    expect(screen.getByTestId('checklist-packaging-toggle')).toBeEnabled()
    expect(screen.queryByTestId('checklist-packaging-locked-hint')).not.toBeInTheDocument()
  })

  it('controlCategory=psychotropic — переключатель заблокирован в положении "restock невозможен", виден поясняющий текст', () => {
    renderForm({ controlCategory: 'psychotropic' })
    const toggle = screen.getByTestId('checklist-packaging-toggle')
    expect(toggle).toBeDisabled()
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByTestId('checklist-packaging-locked-hint')).toBeInTheDocument()
  })

  it('happy path: подтверждение отправляет чек-лист и показывает disposition сервера (restock)', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { id: 'ret-1', status: 'return_confirmed', disposition: 'restock' } }), {
          status: 200,
        }),
      ),
    )
    renderForm()

    fireEvent.click(screen.getByTestId('checklist-submit'))

    await waitFor(() => { expect(screen.getByTestId('checklist-result')).toBeInTheDocument() })
    expect(screen.getByTestId('checklist-result-disposition')).toHaveTextContent('Мол ба анбор баргардонида шуд')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ checklist: { packagingIntact: true } })
  })

  it('controlCategory=psychotropic: подтверждение отправляет packagingIntact=false и показывает disposition=destroy', async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { id: 'ret-1', status: 'return_confirmed', disposition: 'destroy' } }), {
          status: 200,
        }),
      ),
    )
    renderForm({ controlCategory: 'psychotropic' })

    fireEvent.click(screen.getByTestId('checklist-submit'))

    await waitFor(() => { expect(screen.getByTestId('checklist-result-disposition')).toHaveTextContent('Мол бояд нест карда шавад') })
  })

  it('ошибка сервера — показывает сообщение об ошибке, не результат', async () => {
    stubFetch(() => Promise.resolve(new Response(JSON.stringify({ error: { code: 'RETURN_NOT_FOUND' } }), { status: 404 })))
    renderForm()

    fireEvent.click(screen.getByTestId('checklist-submit'))

    await waitFor(() => { expect(screen.getByTestId('checklist-error')).toBeInTheDocument() })
    expect(screen.queryByTestId('checklist-result')).not.toBeInTheDocument()
  })

  it('кнопка «Отмена» вызывает onClose', () => {
    const onClose = vi.fn()
    renderForm({ onClose })
    fireEvent.click(screen.getByTestId('checklist-cancel'))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
