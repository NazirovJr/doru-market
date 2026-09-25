/**
 * `error-state.spec.tsx` (DTJ-406, тест-план тикета).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useT } from '@dorutj/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertNoBlockingViolations, renderWithA11yCheck } from '@/a11y/test-utils'
import { ErrorState } from './error-state'

afterEach(() => {
  cleanup()
})

const { t } = useT('ru')

describe('ErrorState — рендер через useT() (тест-план DTJ-406)', () => {
  it('рендерит titleKey через переданный t()', () => {
    render(<ErrorState t={t} titleKey="ux.error.generic_500" />)
    expect(screen.getByText(t('ux.error.generic_500'))).toBeInTheDocument()
  })

  it('рендерит descriptionKey, когда передан', () => {
    render(<ErrorState t={t} titleKey="ux.error.generic_500" descriptionKey="ux.error.search_timeout" />)
    expect(screen.getByText(t('ux.error.search_timeout'))).toBeInTheDocument()
  })

  it('variant=inline/fullscreen рендерятся без ошибок', () => {
    const { rerender } = render(<ErrorState t={t} titleKey="ux.error.generic_500" variant="inline" />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    rerender(<ErrorState t={t} titleKey="ux.error.generic_500" variant="fullscreen" />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})

describe('ErrorState — повтор (retry)', () => {
  it('рендерит кнопку "Повторить" (ux.action.retry по умолчанию) и триггерит onRetry', () => {
    const onRetry = vi.fn()
    render(<ErrorState t={t} titleKey="ux.error.generic_500" onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: t('ux.action.retry') }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('не рендерит кнопку повтора без onRetry', () => {
    render(<ErrorState t={t} titleKey="ux.error.generic_500" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('ErrorState — технические детали в <details>, скрыты по умолчанию', () => {
  it('не рендерит <details>, когда ни errorCode, ни requestId не заданы', () => {
    const { container } = render(<ErrorState t={t} titleKey="ux.error.generic_500" />)
    expect(container.querySelector('details')).not.toBeInTheDocument()
  })

  it('рендерит <details> закрытым по умолчанию, показывает errorCode/requestId после раскрытия', () => {
    render(<ErrorState t={t} titleKey="ux.error.generic_500" errorCode="ERR_502" requestId="req-123" />)
    const details = document.querySelector('details')!
    expect(details.open).toBe(false)
    expect(screen.getByText(t('ux.error.details_error_code', { code: 'ERR_502' }))).toBeInTheDocument()
    expect(screen.getByText(t('ux.error.details_request_id', { requestId: 'req-123' }))).toBeInTheDocument()
  })

  it('рендерит только errorCode, когда requestId не задан', () => {
    render(<ErrorState t={t} titleKey="ux.error.generic_500" errorCode="ERR_502" />)
    expect(screen.getByText(t('ux.error.details_error_code', { code: 'ERR_502' }))).toBeInTheDocument()
    expect(screen.queryByText(/ID запроса/)).not.toBeInTheDocument()
  })
})

describe('ErrorState — доступность', () => {
  it('нулевые critical/serious нарушения доступности', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <ErrorState
        t={t}
        titleKey="ux.error.generic_500"
        descriptionKey="ux.error.search_timeout"
        onRetry={() => undefined}
        errorCode="ERR_502"
        requestId="req-123"
      />,
    )
    assertNoBlockingViolations(axeResults)
  })
})
