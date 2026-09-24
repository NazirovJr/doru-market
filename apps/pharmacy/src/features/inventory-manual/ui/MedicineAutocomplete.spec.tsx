import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MedicineAutocomplete } from './MedicineAutocomplete'

type FetchImpl = (input: string) => Promise<Response>

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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function renderAutocomplete(onChange = vi.fn()): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MedicineAutocomplete value={null} onChange={onChange} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** DTJ-167 тест-план: «MedicineAutocomplete debounce не отправляет запрос на каждое нажатие клавиши». */
describe('<MedicineAutocomplete /> (DTJ-167)', () => {
  it('серия быстрых нажатий клавиш даёт РОВНО ОДИН сетевой запрос — с финальным значением', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(new Response(JSON.stringify({ data: [searchItem('Цитрамон')] }), { status: 200 })))
    renderAutocomplete()

    const input = screen.getByTestId('medicine-autocomplete-input')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'ц' } })
    fireEvent.change(input, { target: { value: 'ци' } })
    fireEvent.change(input, { target: { value: 'цит' } })
    fireEvent.change(input, { target: { value: 'цитра' } })

    await wait(400)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain(encodeURIComponent('цитра'))
  })

  it('критерий приёмки 1: список показывает tradeName + форму выпуска/дозировку', async () => {
    stubFetch(() => Promise.resolve(new Response(JSON.stringify({ data: [searchItem('Цитрамон')] }), { status: 200 })))
    renderAutocomplete()

    const input = screen.getByTestId('medicine-autocomplete-input')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'цитра' } })

    await waitFor(() => { expect(screen.getByTestId('medicine-autocomplete-option')).toBeInTheDocument() })
    expect(screen.getByText('Цитрамон')).toBeInTheDocument()
    expect(screen.getByText('tablets, 500 mg')).toBeInTheDocument()
  })

  it('выбор подсказки вызывает onChange с выбранным медикаментом и закрывает список', async () => {
    stubFetch(() => Promise.resolve(new Response(JSON.stringify({ data: [searchItem('Цитрамон')] }), { status: 200 })))
    const onChange = vi.fn()
    renderAutocomplete(onChange)

    const input = screen.getByTestId('medicine-autocomplete-input')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'цитра' } })

    await waitFor(() => { expect(screen.getByTestId('medicine-autocomplete-option')).toBeInTheDocument() })
    fireEvent.mouseDown(screen.getByTestId('medicine-autocomplete-option'))

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ medicineId: 'id-Цитрамон', tradeName: 'Цитрамон' }),
    )
    expect(screen.queryByTestId('medicine-autocomplete-list')).not.toBeInTheDocument()
  })

  it('запрос короче минимальной длины — дропдаун не открывается, сеть не вызывается', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 })))
    renderAutocomplete()

    const input = screen.getByTestId('medicine-autocomplete-input')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'ц' } })

    await wait(400)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByTestId('medicine-autocomplete-list')).not.toBeInTheDocument()
  })
})
