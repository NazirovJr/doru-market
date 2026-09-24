import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ExcelImportDropzone } from './ExcelImportDropzone'

function renderDropzone(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ExcelImportDropzone />
    </QueryClientProvider>,
  )
}

function selectFile(): void {
  const file = new File(['a,b,c'], 'stock.csv', { type: 'text/csv' })
  const input = screen.getByTestId('excel-import-file-input')
  fireEvent.change(input, { target: { files: [file] } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('<ExcelImportDropzone /> (DTJ-168)', () => {
  it('файл выбран, режим НЕ выбран — кнопка «Загрузить» неактивна, показана ошибка', () => {
    renderDropzone()
    selectFile()

    expect(screen.getByTestId('excel-import-upload-button')).toBeDisabled()
    expect(screen.getByTestId('excel-import-mode-error')).toBeInTheDocument()
  })

  it('файл и режим выбраны — «Загрузить» активна, вызывает POST', async () => {
    const fetchMock = vi.fn((input: string) => {
      if (input.includes('/upload/')) {
        return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      }
      return Promise.resolve(
        new Response(JSON.stringify({ data: { sourceUploadId: 'up-1', totalBatches: 1, totalRows: 10, rejectedByParser: 0 } }), {
          status: 202,
        }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    renderDropzone()
    selectFile()
    fireEvent.click(screen.getByTestId('excel-import-mode-append_update'))

    expect(screen.getByTestId('excel-import-upload-button')).not.toBeDisabled()
    fireEvent.click(screen.getByTestId('excel-import-upload-button'))

    await waitFor(() => { expect(screen.getByTestId('excel-import-accepted-summary')).toBeInTheDocument() })
    expect(fetchMock).toHaveBeenCalled()
  })

  it('без выбранного файла — «Загрузить» неактивна, ошибки режима нет', () => {
    renderDropzone()
    expect(screen.getByTestId('excel-import-upload-button')).toBeDisabled()
    expect(screen.queryByTestId('excel-import-mode-error')).not.toBeInTheDocument()
  })
})
