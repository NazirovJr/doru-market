import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { assertHitArea, renderWithA11yCheck } from '../shared/a11y-testing.js'
import { Card } from './card.js'

const MIN_HIT_AREA_PX = 48

function createHitAreaRect(widthPx: number, heightPx: number): DOMRect {
  return {
    width: widthPx,
    height: heightPx,
    top: 0,
    left: 0,
    right: widthPx,
    bottom: heightPx,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }
}

describe('Card — static', () => {
  it('рендерит обычный <div>, не попадает в tab-order (нет href/type/tabIndex)', () => {
    render(<Card>Содержимое карточки</Card>)
    const card = screen.getByText('Содержимое карточки')
    expect(card.tagName).toBe('DIV')
    expect(card).not.toHaveAttribute('tabindex')
    expect(card).not.toHaveAttribute('href')
  })

  it('ноль critical/serious a11y-нарушений', async () => {
    const { axeResults } = await renderWithA11yCheck(<Card>Содержимое карточки</Card>)
    expect(axeResults).toHaveNoViolations()
  })
})

describe('Card — interactive', () => {
  it('interactive + href рендерит фокусируемую ссылку', () => {
    render(
      <Card interactive href="/orders/1">
        Заказ №1
      </Card>,
    )
    const link = screen.getByRole('link', { name: 'Заказ №1' })
    expect(link).toHaveAttribute('href', '/orders/1')
  })

  it('interactive без href рендерит фокусируемую кнопку', () => {
    render(<Card interactive>Открыть фильтры</Card>)
    const button = screen.getByRole('button', { name: 'Открыть фильтры' })
    expect(button).toHaveAttribute('type', 'button')
  })

  it('ноль critical/serious a11y-нарушений для interactive-варианта', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <Card interactive href="/orders/1">
        Заказ №1
      </Card>,
    )
    expect(axeResults).toHaveNoViolations()
  })

  /**
   * ГРАНИЦЫ ПРОВЕРКИ (DoD «assertHitArea для... интерактивная Card»): `card.css`
   * `.ui-card--interactive` задаёт `min-height: var(--space-12)` (48px), но `jsdom` не считает
   * layout — тест мокает высоту РОВНО этим CSS-значением и подтверждает, что `assertHitArea`
   * расценивает её как достаточную. Реальная отрисовка — на уровне Playwright/Storybook, не
   * этого unit-теста (см. аналогичное ограничение в `button.spec.tsx`).
   */
  it('assertHitArea проходит на заданной CSS min-height интерактивной карточки (48px)', () => {
    render(
      <Card interactive href="/orders/1">
        Заказ №1
      </Card>,
    )
    const link = screen.getByRole('link', { name: 'Заказ №1' })
    link.getBoundingClientRect = () => createHitAreaRect(280, MIN_HIT_AREA_PX)

    expect(() => {
      assertHitArea(link, MIN_HIT_AREA_PX)
    }).not.toThrow()
  })
})
