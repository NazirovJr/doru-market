import { render, screen } from '@testing-library/react'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { renderWithA11yCheck } from '../shared/a11y-testing.js'
import { Badge, type BadgeProps, type BadgeTone } from './badge.js'

const TONES: readonly BadgeTone[] = ['success', 'danger', 'warning', 'neutral']

describe('Badge — текст обязателен', () => {
  it('тип BadgeProps требует children (не optional)', () => {
    expectTypeOf<BadgeProps['children']>().not.toBeUndefined()
  })

  it('рендер БЕЗ children — ошибка компиляции (children обязателен пропсом, не только tone)', () => {
    // @ts-expect-error BadgeProps.children обязателен — статус не передаётся только цветом (SRS-UX-019/034), эта строка ловит регресс, если text/children станет optional
    render(<Badge tone="success" />)
  })

  it.each(TONES)('рендерит переданный текст для tone=%s', (tone) => {
    render(<Badge tone={tone}>Доставлено</Badge>)
    expect(screen.getByText('Доставлено')).toBeInTheDocument()
  })
})

describe('Badge — доступность', () => {
  it('ноль critical/serious a11y-нарушений', async () => {
    const { axeResults } = await renderWithA11yCheck(<Badge tone="danger">Отменён</Badge>)
    expect(axeResults).toHaveNoViolations()
  })
})
