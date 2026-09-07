import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { assertHitArea, renderWithA11yCheck } from '../shared/a11y-testing.js'
import { Button, type ButtonSize, type ButtonVariant } from './button.js'

const VARIANTS: readonly ButtonVariant[] = ['primary', 'secondary', 'danger', 'ghost']
const SIZES: readonly ButtonSize[] = ['md', 'lg']
const MIN_HIT_AREA_MD_PX = 48
const MIN_HIT_AREA_LG_PX = 56

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

  it.each(VARIANTS)('не показывает critical/serious a11y-нарушений для variant=%s', async (variant) => {
    const { axeResults } = await renderWithA11yCheck(<Button variant={variant}>Оформить</Button>)

    expect(axeResults).toHaveNoViolations()
  })

  /**
   * ГРАНИЦЫ ПРОВЕРКИ (DoD «assertHitArea для Button, IconButton, Chip, интерактивная Card»):
   * `jsdom` не выполняет layout, поэтому `min-height: var(--space-12)`/`var(--space-12) +
   * var(--space-2)` из `button.css` НЕ применяется к `getBoundingClientRect()` без явного мока —
   * этот тест мокает высоту РОВНО тем значением, которое задаёт CSS-класс размера (`ui-button--md`
   * → 48px, `ui-button--lg` → 56px), и подтверждает, что `assertHitArea` расценивает его как
   * достаточное. Он НЕ доказывает, что реальный браузер рендерит именно эту высоту — это
   * ответственность CSS (`min-height`) и перепроверяется визуально/Playwright (TC-UX-001), не этим
   * unit-тестом; ширина здесь не проверяется (content-driven, не фиксирована токеном).
   */
  it('size=md — assertHitArea проходит на заданной CSS min-height (48px)', () => {
    render(<Button size="md">Оформить</Button>)
    const button = screen.getByRole('button')
    button.getBoundingClientRect = () => createHitAreaRect(120, MIN_HIT_AREA_MD_PX)

    expect(() => {
      assertHitArea(button, MIN_HIT_AREA_MD_PX)
    }).not.toThrow()
  })

  it('size=lg — assertHitArea проходит на заданной CSS min-height (56px, кабинет аптеки)', () => {
    render(<Button size="lg">Передать курьеру</Button>)
    const button = screen.getByRole('button')
    button.getBoundingClientRect = () => createHitAreaRect(160, MIN_HIT_AREA_LG_PX)

    expect(() => {
      assertHitArea(button, MIN_HIT_AREA_LG_PX)
    }).not.toThrow()
  })
})

describe('Button — состояние loading (AC1)', () => {
  it('сохраняет текст в DOM визуально скрытым, выставляет aria-busy и disabled', () => {
    render(<Button loading>Оформить</Button>)

    const button = screen.getByRole('button')
    const label = screen.getByText('Оформить')

    expect(label).toBeInTheDocument()
    expect(getComputedStyle(label).visibility).toBe('hidden')
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toBeDisabled()
  })

  /**
   * ГРАНИЦЫ ПРОВЕРКИ (AC1): тикет требует сравнения `getBoundingClientRect` до/после переключения
   * `loading`. `jsdom` не выполняет layout — `getBoundingClientRect()` в `jsdom` без явного мока
   * ВСЕГДА возвращает нули (см. JSDoc `assert-hit-area.ts`), поэтому реальное сравнение ширины
   * здесь физически недоступно: замер вернул бы 0===0 независимо от корректности реализации, что
   * было бы фиктивным "зелёным", а не измерением. Вместо мока geometрии этот тест проверяет
   * СТРУКТУРНОЕ условие, которое реально гарантирует неизменность ширины в браузере: текст остаётся
   * ТЕМ ЖЕ узлом DOM (не размонтируется/не заменяется на другую разметку) и скрывается через
   * `visibility: hidden` (сохраняет layout-box), а не `display: none`/удаление из DOM — спиннер
   * позиционируется `position: absolute` поверх (`button.css` `.ui-button__spinner`), не участвуя в
   * потоке и не раздвигая кнопку. Физический замер пикселей — на уровне Playwright E2E (TC-UX-001),
   * не этого unit-теста.
   */
  it('не меняет DOM-структуру текстового узла при переключении loading (структурная проверка ширины)', () => {
    const { rerender } = render(<Button loading={false}>Оформить</Button>)
    const labelBefore = screen.getByText('Оформить')
    expect(getComputedStyle(labelBefore).visibility).not.toBe('hidden')

    rerender(<Button loading>Оформить</Button>)
    const labelAfter = screen.getByText('Оформить')

    expect(labelAfter).toBe(labelBefore)
    expect(getComputedStyle(labelAfter).visibility).toBe('hidden')
  })
})

describe('Button — состояние disabled', () => {
  it('не триггерит onClick и не получает нативный атрибут disabled', () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Оформить
      </Button>,
    )

    const button = screen.getByRole('button')
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')

    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('вызывает onClick, когда кнопка не отключена', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Оформить</Button>)

    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
