/**
 * `empty-state.spec.tsx` (DTJ-406, тест-план тикета).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useT } from '@dorutj/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertNoBlockingViolations, renderWithA11yCheck } from '@/a11y/test-utils'
import { EmptyState } from './empty-state'

afterEach(() => {
  cleanup()
})

const { t } = useT('ru')

describe('EmptyState — рендер через useT() (тест-план DTJ-406)', () => {
  it('рендерит titleKey через переданный t()', () => {
    render(<EmptyState t={t} titleKey="ux.empty.cart" />)
    expect(screen.getByText(t('ux.empty.cart'))).toBeInTheDocument()
  })

  it('рендерит descriptionKey, когда передан', () => {
    render(<EmptyState t={t} titleKey="ux.empty.orders" descriptionKey="ux.empty.search_no_results" />)
    expect(screen.getByText(t('ux.empty.search_no_results'))).toBeInTheDocument()
  })

  it('не рендерит описание, когда descriptionKey не передан', () => {
    const { container } = render(<EmptyState t={t} titleKey="ux.empty.orders" />)
    expect(container.querySelectorAll('p')).toHaveLength(0)
  })

  it('рендерит CTA только когда заданы И ctaLabelKey, И onCtaClick, и триггерит клик', () => {
    const onCtaClick = vi.fn()
    render(<EmptyState t={t} titleKey="ux.empty.cart" ctaLabelKey="ux.action.retry" onCtaClick={onCtaClick} />)
    fireEvent.click(screen.getByRole('button', { name: t('ux.action.retry') }))
    expect(onCtaClick).toHaveBeenCalledTimes(1)
  })

  it('не рендерит CTA без onCtaClick, даже если задан ctaLabelKey', () => {
    render(<EmptyState t={t} titleKey="ux.empty.cart" ctaLabelKey="ux.action.retry" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('интерполирует titleParams/descriptionParams', () => {
    render(
      <EmptyState
        t={t}
        titleKey="ux.error.otp_mismatch"
        titleParams={{ attemptsLeft: 2 }}
      />,
    )
    expect(screen.getByText(t('ux.error.otp_mismatch', { attemptsLeft: 2 }))).toBeInTheDocument()
  })

  it('рендерит переданную иконку вместо дефолтной', () => {
    render(<EmptyState t={t} titleKey="ux.empty.cart" icon={<span data-testid="custom-icon" />} />)
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument()
  })

  it('нулевые critical/serious нарушения доступности', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <EmptyState t={t} titleKey="ux.empty.cart" descriptionKey="ux.empty.search_no_results" ctaLabelKey="ux.action.retry" onCtaClick={() => undefined} />,
    )
    assertNoBlockingViolations(axeResults)
  })
})
