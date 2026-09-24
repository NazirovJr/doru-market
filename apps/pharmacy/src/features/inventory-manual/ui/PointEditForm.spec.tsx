import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PointEditForm } from './PointEditForm'

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function searchItem(tradeName: string): unknown {
  return {
    medicineId: `id-${tradeName}`,
    tradeName,
    innName: tradeName,
    dosageForm: 'tablets',
    dosageStrength: '500 mg',
    imageUrl: null,
    isPrescriptionRequired: false,
    cheapestOffer: null,
    offersCountInRadius: 0,
    relevanceScore: 1,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function routeFetch(manualEntryResponse: () => Response): FetchImpl {
  return (input: string) => {
    if (input.includes('/medicines/search')) {
      return Promise.resolve(jsonResponse({ data: [searchItem('Цитрамон')] }))
    }
    if (input.includes('/inventory-manual-entry')) {
      return Promise.resolve(manualEntryResponse())
    }
    throw new Error(`unexpected request: ${input}`)
  }
}

function renderForm(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <PointEditForm />
    </QueryClientProvider>,
  )
}

async function selectMedicine(): Promise<void> {
  const input = screen.getByTestId('medicine-autocomplete-input')
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: 'цитра' } })
  await waitFor(() => { expect(screen.getByTestId('medicine-autocomplete-option')).toBeInTheDocument() })
  fireEvent.mouseDown(screen.getByTestId('medicine-autocomplete-option'))
}

function fillValidRow(): void {
  fireEvent.change(screen.getByTestId('point-edit-price'), { target: { value: '15.5' } })
  fireEvent.change(screen.getByTestId('point-edit-quantity'), { target: { value: '10' } })
  fireEvent.change(screen.getByTestId('point-edit-expiry'), { target: { value: '2030-01-01' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** DTJ-167 тест-план: «PointEditForm блокирует отправку при невалидной форме» (критерий приёмки 3). */
describe('<PointEditForm /> (DTJ-167)', () => {
  it('кнопка «Сохранить» неактивна, пока медикамент не выбран', () => {
    renderForm()
    expect(screen.getByTestId('point-edit-submit')).toBeDisabled()
  })

  it('цена <= 0 — кнопка остаётся неактивной, запрос к API не отправляется (критерий приёмки 3)', async () => {
    const fetchMock = stubFetch(routeFetch(() => jsonResponse({ data: {} })))
    renderForm()
    await selectMedicine()

    fireEvent.change(screen.getByTestId('point-edit-price'), { target: { value: '0' } })
    fireEvent.change(screen.getByTestId('point-edit-quantity'), { target: { value: '10' } })
    fireEvent.change(screen.getByTestId('point-edit-expiry'), { target: { value: '2030-01-01' } })

    expect(screen.getByTestId('point-edit-price-error')).toBeInTheDocument()
    expect(screen.getByTestId('point-edit-submit')).toBeDisabled()

    fireEvent.click(screen.getByTestId('point-edit-submit'))
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/inventory-manual-entry'))).toBe(false)
  })

  it('happy path: выбор медикамента + валидные поля → POST resolved:true-строкой, Toast успеха, форма очищается (критерий приёмки 2)', async () => {
    const fetchMock = stubFetch(
      routeFetch(() => jsonResponse({ data: { batchId: 'b-1', status: 'completed', acceptedRows: 1, rejectedRows: 0, errors: [] } })),
    )
    renderForm()
    await selectMedicine()
    fillValidRow()

    expect(screen.getByTestId('point-edit-submit')).toBeEnabled()
    fireEvent.click(screen.getByTestId('point-edit-submit'))

    await waitFor(() => { expect(screen.getByTestId('manual-entry-toast-success')).toBeInTheDocument() })

    const submitCall = fetchMock.mock.calls.find(([url]) => url.includes('/inventory-manual-entry'))
    const [, init] = submitCall as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { rows: [{ medicineId: string }] }
    expect(body.rows).toHaveLength(1)
    expect(body.rows[0].medicineId).toBe('id-Цитрамон')

    // Форма очищена для следующего ввода.
    expect(screen.getByTestId('medicine-autocomplete-input')).toHaveValue('')
    expect(screen.getByTestId('point-edit-price')).toHaveValue(null)
  })

  it('403 INSUFFICIENT_ROLE — понятное сообщение, не сырой JSON (критерий приёмки 4)', async () => {
    stubFetch(routeFetch(() => jsonResponse({ error: { code: 'INSUFFICIENT_ROLE', message: 'role pharmacist is not in [...]' } }, 403)))
    renderForm()
    await selectMedicine()
    fillValidRow()

    fireEvent.click(screen.getByTestId('point-edit-submit'))

    await waitFor(() => { expect(screen.getByTestId('manual-entry-toast-error')).toBeInTheDocument() })
    expect(screen.getByTestId('manual-entry-toast-error')).not.toHaveTextContent('INSUFFICIENT_ROLE')
    expect(screen.getByTestId('manual-entry-toast-error')).not.toHaveTextContent('{')
  })

  it('«Товара нет в списке» показывает заглушку «Функция появится позже»', () => {
    renderForm()
    fireEvent.click(screen.getByTestId('missing-medicine-link'))
    expect(screen.getByTestId('missing-medicine-stub')).toBeInTheDocument()
  })
})
