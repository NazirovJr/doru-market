/**
 * `button.spec.tsx` (DTJ-404, критерий приёмки 1, тест-план тикета).
 *
 * `getBoundingClientRect()` под `jsdom` всегда возвращает нули (нет раскладки) — сравнение
 * до/после переключения `loading` из AC1 поэтому дополняется сравнением ФАКТИЧЕСКИХ inline-стилей
 * (`height`/`padding`), которые определяют реальную ширину/высоту кнопки в браузере и НЕ меняются
 * между `default` и `loading` (текст скрыт `visibility: hidden`, не удалён — layout сохраняется).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertNoBlockingViolations, renderWithA11yCheck } from '@/a11y/test-utils'
import { Button, type ButtonSize, type ButtonVariant } from './button'

afterEach(() => {
  cleanup()
})

const VARIANTS: readonly ButtonVariant[] = ['primary', 'secondary', 'danger', 'ghost']
const SIZES: readonly ButtonSize[] = ['md', 'lg']

describe('Button — варианты и размеры', () => {
  it.each(VARIANTS.flatMap((variant) => SIZES.map((size) => [variant, size] as const)))(
    'рендерит variant=%s size=%s без ошибок',
    (variant, size) => {
      render(
        <Button variant={variant} size={size}>
          Оформить
        </Button>,
      )
      expect(screen.getByRole('button', { name: 'Оформить' })).toBeInTheDocument()
    },
  )

  it.each(VARIANTS)('нулевые critical/serious нарушения доступности для variant=%s', async (variant) => {
    const { axeResults } = await renderWithA11yCheck(<Button variant={variant}>Оформить</Button>)
    assertNoBlockingViolations(axeResults)
  })
})

describe('Button — loading (AC1)', () => {
  it('сохраняет текст в DOM, визуально скрывает его и не меняет layout-стили ширины/высоты', () => {
    const { rerender } = render(<Button size="md">Оформить</Button>)
    const buttonBeforeStyle = getComputedStyle(screen.getByRole('button'))
    const heightBefore = buttonBeforeStyle.height
    const paddingBefore = buttonBeforeStyle.padding
    const rectBefore = screen.getByRole('button').getBoundingClientRect()

    rerender(
      <Button size="md" loading>
        Оформить
      </Button>,
    )
    const button = screen.getByRole('button')
    const rectAfter = button.getBoundingClientRect()
    const style = getComputedStyle(button)

    expect(screen.getByText('Оформить')).toBeInTheDocument()
    expect(screen.getByText('Оформить')).not.toBeVisible()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toBeDisabled()
    // Layout-критичные значения не меняются между default и loading — ширина/высота стабильны.
    expect(style.height).toBe(heightBefore)
    expect(style.padding).toBe(paddingBefore)
    expect(rectAfter.width).toBe(rectBefore.width)
    expect(rectAfter.height).toBe(rectBefore.height)
  })

  it('триггерит onClick в обычном состоянии', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Оформить</Button>)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('не триггерит onClick, пока идёт загрузка', () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        Оформить
      </Button>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('Button — disabled (персистентный, остаётся в tab-order)', () => {
  it('не триггерит onClick, помечает aria-disabled, НЕ ставит нативный disabled', () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Оформить
      </Button>,
    )
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('Button — focus/hover/active (SRS-UX-019)', () => {
  it('показывает --focus-ring через box-shadow при фокусе, не подавляя outline без замены', () => {
    render(<Button>Оформить</Button>)
    const button = screen.getByRole('button')
    fireEvent.focus(button)
    expect(getComputedStyle(button).boxShadow).toContain('var(--focus-ring)')
    fireEvent.blur(button)
    expect(getComputedStyle(button).boxShadow).toBe('none')
  })

  it('меняет фон/трансформацию на hover/active и возвращает исходные на mouseLeave', () => {
    render(<Button>Оформить</Button>)
    const button = screen.getByRole('button')
    const defaultBackground = getComputedStyle(button).background

    fireEvent.mouseEnter(button)
    expect(getComputedStyle(button).background).not.toBe(defaultBackground)

    fireEvent.mouseDown(button)
    expect(getComputedStyle(button).transform).toContain('scale(0.97)')

    fireEvent.mouseUp(button)
    expect(getComputedStyle(button).transform).toBe('scale(1)')

    fireEvent.mouseLeave(button)
    expect(getComputedStyle(button).background).toBe(defaultBackground)
  })
})
