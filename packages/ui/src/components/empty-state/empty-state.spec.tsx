import { fireEvent, render, screen } from '@testing-library/react'
import { useT } from '@dorutj/i18n'
import { describe, expect, it, vi } from 'vitest'
import { renderWithA11yCheck } from '../shared/a11y-testing.js'
import { EmptyState, type EmptyStateProps } from './empty-state.js'

const { t } = useT('ru')

describe('EmptyState — рендер через useT()-ключи', () => {
  it('рендерит titleKey и descriptionKey дословно по словарю', () => {
    render(<EmptyState t={t} titleKey="ux.empty.cart" descriptionKey="ux.empty.orders" />)

    expect(screen.getByText('Корзина пуста. Найдите лекарство дешевле рядом с вами.')).toBeInTheDocument()
    expect(screen.getByText('У вас пока нет заказов.')).toBeInTheDocument()
  })

  it('без descriptionKey не рендерит второй параграф', () => {
    render(<EmptyState t={t} titleKey="ux.empty.order_queue" />)
    expect(screen.getByText('Новых заказов нет.')).toBeInTheDocument()
    expect(document.querySelector('.ui-empty-state__description')).not.toBeInTheDocument()
  })

  it('titleKey ОБЯЗАН быть ключом словаря — произвольный string не компилируется (DoD)', () => {
    // @ts-expect-error DTJ-406 DoD: EmptyState принимает только i18n-ключи как основной API, "Ничего нет" — свободный текст, не ключ словаря
    const props: EmptyStateProps = { t, titleKey: 'Ничего нет' }
    expect(props.titleKey).toBe('Ничего нет')
  })
})

describe('EmptyState — CTA', () => {
  it('рендерит CTA только когда переданы ctaLabelKey И onCtaClick, клик вызывает обработчик', () => {
    const onCtaClick = vi.fn()
    const { rerender } = render(<EmptyState t={t} titleKey="ux.empty.cart" ctaLabelKey="cart.empty_cta" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()

    rerender(
      <EmptyState t={t} titleKey="ux.empty.cart" ctaLabelKey="cart.empty_cta" onCtaClick={onCtaClick} />,
    )
    const cta = screen.getByRole('button', { name: 'Найти лекарство' })
    fireEvent.click(cta)
    expect(onCtaClick).toHaveBeenCalledTimes(1)
  })
})

describe('EmptyState — доступность', () => {
  it('ноль critical/serious a11y-нарушений', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <EmptyState t={t} titleKey="ux.empty.search_no_results" ctaLabelKey="cart.empty_cta" onCtaClick={vi.fn()} />,
    )
    expect(axeResults).toHaveNoViolations()
  })
})
