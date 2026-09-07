import { render, screen } from '@testing-library/react'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { assertHitArea, renderWithA11yCheck } from '../shared/a11y-testing.js'
import { IconButton, type IconButtonProps } from './icon-button.js'

const PHONE_ICON = <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" />

describe('IconButton — типовой контракт AC2 (aria-label обязателен)', () => {
  it('тип IconButtonProps требует aria-label как обязательное string-свойство', () => {
    expectTypeOf<IconButtonProps>().toHaveProperty('aria-label').toEqualTypeOf<string>()
    // required-проп НЕ ассимилируется в тип с тем же полем как optional (`{ 'aria-label'?: string }`
    // шире `{ 'aria-label': string }`) — если `aria-label` в `IconButtonProps` случайно станет
    // optional, эта проверка перестанет ловить регресс молча, поэтому дублируем её `@ts-expect-error`
    // ниже, который проверяет то же самое конкретным примером использования, не только типом поля.
  })

  it('рендер БЕЗ aria-label — ошибка компиляции TypeScript, не рантайм-warning (AC2)', () => {
    // @ts-expect-error AC2 DTJ-404: IconButtonProps.'aria-label' обязателен, JSX без него обязан не компилироваться — эта строка ловит регресс, если проп станет optional
    render(<IconButton icon={PHONE_ICON} />)
  })
})

describe('IconButton — эффективная область попадания (SRS-UX-002)', () => {
  it('size="md" (визуал 48px) — эффективная область ≥48×48px без hit-slop', () => {
    render(<IconButton icon={PHONE_ICON} aria-label="Позвонить курьеру" size="md" />)
    const button = screen.getByRole('button', { name: 'Позвонить курьеру' })
    button.getBoundingClientRect = () => createRect(48)

    assertHitArea(button, 48)
  })

  it('size="sm" (визуал 32px, минимальный по дизайну) — hit-slop добирает область до ≥48×48px', () => {
    render(<IconButton icon={PHONE_ICON} aria-label="Назад" size="sm" />)
    const button = screen.getByRole('button', { name: 'Назад' })
    button.getBoundingClientRect = () => createRect(32)

    expect(getComputedStyle(button).padding).toBe('8px')
    assertHitArea(button, 48)
  })
})

describe('IconButton — доступность', () => {
  it('ноль critical/serious a11y-нарушений', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <IconButton icon={PHONE_ICON} aria-label="Позвонить курьеру" />,
    )
    expect(axeResults).toHaveNoViolations()
  })
})

function createRect(sizePx: number): DOMRect {
  return {
    width: sizePx,
    height: sizePx,
    top: 0,
    left: 0,
    right: sizePx,
    bottom: sizePx,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }
}
