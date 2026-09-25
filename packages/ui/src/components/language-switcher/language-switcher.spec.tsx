/**
 * `language-switcher.spec.tsx` (DTJ-408, критерий приёмки 1, тест-план тикета).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MIN_HIT_AREA_PX, assertHitArea } from '@/a11y/assert-hit-area'
import { assertNoBlockingViolations, renderWithA11yCheck } from '@/a11y/test-utils'
import { LanguageSwitcher } from './language-switcher'

afterEach(() => {
  cleanup()
})

describe('LanguageSwitcher — работает без контекста авторизации (AC1, DoD)', () => {
  it('клик по пилюле «RU» вызывает onChange(\'ru\') без токена/сессии в пропсах', () => {
    const onChange = vi.fn()
    // Единственные пропы — currentLocale/onChange/aria-label, никакого auth-контекста
    // не передано и не требуется (DoD: «доказуемо не зависит от состояния авторизации»).
    render(<LanguageSwitcher currentLocale="tj" onChange={onChange} aria-label="Выбор языка" />)

    fireEvent.click(screen.getByRole('button', { name: 'RU' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('ru')
  })

  it('рендерит ровно 3 пилюли TJ/RU/EN', () => {
    render(<LanguageSwitcher currentLocale="tj" onChange={vi.fn()} aria-label="Выбор языка" />)
    expect(screen.getByRole('button', { name: 'TJ' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'RU' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'EN' })).toBeInTheDocument()
  })

  it('aria-pressed отмечает текущую локаль', () => {
    render(<LanguageSwitcher currentLocale="en" onChange={vi.fn()} aria-label="Выбор языка" />)
    expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'TJ' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('LanguageSwitcher — тап-зона (assertHitArea ≥48px)', () => {
  it('каждая пилюля ≥48×48px, несмотря на компактный визуал 32×32px', () => {
    render(<LanguageSwitcher currentLocale="tj" onChange={vi.fn()} aria-label="Выбор языка" />)
    for (const label of ['TJ', 'RU', 'EN']) {
      assertHitArea(screen.getByRole('button', { name: label }), MIN_HIT_AREA_PX)
    }
  })
})

describe('LanguageSwitcher — focus (SRS-UX-019)', () => {
  it('показывает --focus-ring через box-shadow при фокусе, не подавляя outline без замены', () => {
    render(<LanguageSwitcher currentLocale="tj" onChange={vi.fn()} aria-label="Выбор языка" />)
    const pill = screen.getByRole('button', { name: 'RU' })
    fireEvent.focus(pill)
    expect(getComputedStyle(pill).boxShadow).toContain('var(--focus-ring)')
    fireEvent.blur(pill)
    expect(getComputedStyle(pill).boxShadow).toBe('none')
  })
})

describe('LanguageSwitcher — доступность', () => {
  it('нулевые critical/serious нарушения', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <LanguageSwitcher currentLocale="tj" onChange={vi.fn()} aria-label="Выбор языка" />,
    )
    assertNoBlockingViolations(axeResults)
  })
})
