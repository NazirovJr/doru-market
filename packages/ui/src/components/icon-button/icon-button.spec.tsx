/**
 * `icon-button.spec.tsx` (DTJ-404, критерий приёмки 2, тест-план тикета).
 *
 * Тип-тест ниже (`_typeOnlyAriaLabelIsRequired`) НИКОГДА не вызывается в рантайме — функция
 * существует только для того, чтобы `tsc --noEmit` (`pnpm --filter @dorutj/ui typecheck`)
 * проверил её тело. `// @ts-expect-error` требует, чтобы следующая строка была ошибкой
 * компиляции — это и есть проверяемый критерий AC2 («ошибка компиляции, не рантайм-warning»):
 * если кто-то случайно сделает `aria-label` опциональным, `tsc` перестанет падать на этой строке,
 * и сам `@ts-expect-error` станет «неиспользуемым подавлением» — тоже ошибкой компиляции.
 */
import { type ReactElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MIN_HIT_AREA_PX, assertHitArea } from '@/a11y/assert-hit-area'
import { assertNoBlockingViolations, renderWithA11yCheck } from '@/a11y/test-utils'
import { IconButton } from './icon-button'

afterEach(() => {
  cleanup()
})

const CallIcon = (): ReactElement => <svg width={20} height={20} aria-hidden="true" />

function _typeOnlyAriaLabelIsRequired(): ReactElement {
  // @ts-expect-error -- aria-label обязателен на уровне типов (AC2 DTJ-404): без него — ошибка компиляции.
  return <IconButton icon={<CallIcon />} />
}
// Ссылка на функцию (без вызова) — только чтобы `tsc --noEmit` не считал её "unused" (noUnusedLocals).
void _typeOnlyAriaLabelIsRequired

describe('IconButton — эффективная тап-зона (SRS-UX-002, AC2 покрыт типом выше)', () => {
  it('48×48px эффективной области при дефолтном визуальном размере иконки', () => {
    render(<IconButton icon={<CallIcon />} aria-label="Позвонить" />)
    assertHitArea(screen.getByRole('button', { name: 'Позвонить' }), MIN_HIT_AREA_PX)
  })

  it('48×48px эффективной области даже при минимальном визуальном размере иконки (2px)', () => {
    render(<IconButton icon={<svg width={2} height={2} aria-hidden="true" />} aria-label="Свернуть" />)
    assertHitArea(screen.getByRole('button', { name: 'Свернуть' }), MIN_HIT_AREA_PX)
  })

  it('нулевые critical/serious нарушения доступности', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <IconButton icon={<CallIcon />} aria-label="Позвонить" />,
    )
    assertNoBlockingViolations(axeResults)
  })
})

describe('IconButton — hover/active/focus', () => {
  it('меняет фон на hover/active и box-shadow на focus', () => {
    render(<IconButton icon={<CallIcon />} aria-label="Позвонить" />)
    const button = screen.getByRole('button', { name: 'Позвонить' })

    fireEvent.mouseEnter(button)
    expect(getComputedStyle(button).background).toBe('var(--brand-bg)')
    fireEvent.mouseDown(button)
    expect(getComputedStyle(button).transform).toContain('scale(0.97)')
    fireEvent.mouseUp(button)
    fireEvent.mouseLeave(button)
    expect(getComputedStyle(button).background).toBe('rgba(0, 0, 0, 0)')

    fireEvent.focus(button)
    expect(getComputedStyle(button).boxShadow).toContain('var(--focus-ring)')
    fireEvent.blur(button)
    expect(getComputedStyle(button).boxShadow).toBe('none')
  })
})
