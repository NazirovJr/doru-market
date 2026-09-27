/**
 * `toast.spec.tsx` (DTJ-406, критерий приёмки 3, тест-план тикета).
 */
import { type ReactElement } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertNoBlockingViolations, runA11yAudit } from '@/a11y/test-utils'
import { ToastProvider } from './toast'
import { DEFAULT_TOAST_DURATION_MS, useToast } from './use-toast'

afterEach(() => {
  cleanup()
})

const Harness = (): ReactElement => {
  const toast = useToast()
  return (
    <div>
      <button type="button" onClick={() => { toast.success('Готово') }}>
        show-success
      </button>
      <button type="button" onClick={() => { toast.error('Ошибка', { persistent: true }) }}>
        show-persistent-error
      </button>
    </div>
  )
}

const renderHarness = (): ReturnType<typeof render> =>
  render(
    <ToastProvider closeButtonLabel="Закрыть">
      <Harness />
    </ToastProvider>,
  )

describe('useToast — вне провайдера', () => {
  it('бросает описательную ошибку', () => {
    const Bare = (): ReactElement => {
      useToast()
      return <div />
    }
    expect(() => render(<Bare />)).toThrow(/ToastProvider/)
  })
})

describe('ToastProvider/useToast — автозакрытие (критерий приёмки 3, тест-план)', () => {
  it('закрывает обычный тост ровно через 4000мс', () => {
    vi.useFakeTimers()
    renderHarness()
    fireEvent.click(screen.getByText('show-success'))
    expect(screen.getByText('Готово')).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(DEFAULT_TOAST_DURATION_MS - 1) })
    expect(screen.getByText('Готово')).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.queryByText('Готово')).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('НЕ закрывает persistent-тост через 10 секунд без действия пользователя (AC3)', () => {
    vi.useFakeTimers()
    renderHarness()
    fireEvent.click(screen.getByText('show-persistent-error'))
    expect(screen.getByText('Ошибка')).toBeInTheDocument()

    const TEN_SECONDS_MS = 10_000
    act(() => { vi.advanceTimersByTime(TEN_SECONDS_MS) })
    expect(screen.getByText('Ошибка')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('закрывает persistent-тост по клику на кнопку закрытия', () => {
    renderHarness()
    fireEvent.click(screen.getByText('show-persistent-error'))
    const toastRow = screen.getByText('Ошибка').closest<HTMLElement>('[data-testid="dorutj-toast"]')!
    fireEvent.click(within(toastRow).getByRole('button', { name: 'Закрыть' }))
    expect(screen.queryByText('Ошибка')).not.toBeInTheDocument()
  })
})

describe('ToastProvider — несколько тостов складываются в стек, не перекрывают друг друга', () => {
  it('рендерит оба тоста одновременно как отдельные элементы', () => {
    renderHarness()
    fireEvent.click(screen.getByText('show-success'))
    fireEvent.click(screen.getByText('show-persistent-error'))
    expect(screen.getAllByTestId('dorutj-toast')).toHaveLength(2)
    expect(screen.getByText('Готово')).toBeInTheDocument()
    expect(screen.getByText('Ошибка')).toBeInTheDocument()
  })
})

describe('ToastProvider — доступность', () => {
  it('нулевые critical/serious нарушения доступности с показанным тостом', async () => {
    const { container } = renderHarness()
    fireEvent.click(screen.getByText('show-success'))
    const axeResults = await runA11yAudit(container)
    assertNoBlockingViolations(axeResults)
  })

  it('error-тост объявляется через role=alert/aria-live=assertive, обычный — role=status/polite', () => {
    renderHarness()
    fireEvent.click(screen.getByText('show-success'))
    fireEvent.click(screen.getByText('show-persistent-error'))
    expect(screen.getByText('Готово').closest('[role="status"]')).toBeInTheDocument()
    expect(screen.getByText('Ошибка').closest('[role="alert"]')).toBeInTheDocument()
  })
})
