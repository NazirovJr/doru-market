import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { ToastProvider } from '@dorutj/ui'
import { ReportExportButton } from './report-export-button'

function renderButton(props: Partial<ComponentProps<typeof ReportExportButton>> = {}): void {
  render(
    <ToastProvider closeButtonLabel="close">
      <ReportExportButton
        reportType="top-analogs"
        periodDays={20}
        rows={[{ name: 'Панадол' }]}
        columns={[{ key: 'name', header: 'Название' }]}
        fileBaseName="top-analogs"
        {...props}
      />
    </ToastProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ReportExportButton (DTJ-361)', () => {
  it('синхронный экспорт CSV — POST с rows/columns, скачивание триггерится', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(['a,b']), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    URL.createObjectURL = vi.fn().mockReturnValue('blob:x')
    URL.revokeObjectURL = vi.fn()
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    renderButton()

    fireEvent.click(screen.getByText('Скачать CSV'))

    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/reports/top-analogs/export?format=csv')
    expect(JSON.parse(init.body as string)).toMatchObject({ periodDays: 20, rows: [{ name: 'Панадол' }] })
    expect(clickSpy).toHaveBeenCalled()
  })

  it('ошибка запроса — показывает toast, не падает', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })))
    renderButton()

    fireEvent.click(screen.getByText('Скачать CSV'))

    await waitFor(() => { expect(screen.getByRole('alert')).toBeInTheDocument() })
  })

  it('period > 31 день — 202 переключает на режим ожидания (progress)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { exportJobId: 'job-1' } }), { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)
    renderButton({ periodDays: 45, rows: [], columns: [] })

    fireEvent.click(screen.getByText('Скачать CSV'))

    await waitFor(() => { expect(screen.getByTestId('report-export-progress')).toBeInTheDocument() })
  })

  it('rows пустые при синхронном периоде — кнопки отключены', () => {
    renderButton({ rows: [] })

    expect(screen.getByText('Скачать CSV').closest('button')).toHaveAttribute('aria-disabled', 'true')
  })
})
