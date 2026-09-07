import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithA11yCheck } from '../shared/a11y-testing.js'
import { CountdownTimer } from './countdown-timer.js'

const NOW = new Date('2026-09-07T10:00:00.000Z').getTime()

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

function getSrRegion(container: HTMLElement): HTMLElement {
  const region = container.querySelector('.ui-countdown-timer__sr-only')
  if (region === null) {
    throw new Error('aria-live region not found')
  }
  return region as HTMLElement
}

/** Видимые цифры и `aria-live`-регион нередко совпадают по тексту (одно и то же время) —
 * `screen.getByText` в этом случае находит ДВА узла. Проверяем видимое значение адресно, по
 * классу `.ui-countdown-timer__value`, не полагаясь на уникальность текста во всём документе. */
function getVisibleValue(container: HTMLElement): string | null {
  return container.querySelector('.ui-countdown-timer__value')?.textContent ?? null
}

describe('CountdownTimer — AC1: цветовая эскалация на пороге, aria-live — ОДНО обновление', () => {
  it('normal → warning РОВНО на границе warningThresholdSeconds (400с → порог 300с), НЕ раньше и НЕ на каждую секунду', () => {
    const { container } = render(
      <CountdownTimer targetTimestamp={NOW + 400_000} warningThresholdSeconds={300} dangerThresholdSeconds={0} />,
    )

    expect(container.querySelector('.ui-countdown-timer--normal')).toBeInTheDocument()
    const srRegion = getSrRegion(container)
    expect(srRegion.textContent).toBe('06:40')

    // Тикаем 99 раз (до 301с осталось) — фаза ещё normal, aria-live НЕ должен измениться ни разу
    // за все эти тики (проверяем на КАЖДОМ шаге, не только в конце, чтобы поймать промежуточное
    // ложное срабатывание).
    for (let elapsedSeconds = 1; elapsedSeconds <= 99; elapsedSeconds += 1) {
      act(() => {
        vi.advanceTimersByTime(1_000)
      })
      expect(srRegion.textContent).toBe('06:40')
    }
    expect(container.querySelector('.ui-countdown-timer--normal')).toBeInTheDocument()

    // 100-й тик: остаётся ровно 300с — граница порога, переход в warning. РОВНО ОДНО изменение.
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(container.querySelector('.ui-countdown-timer--warning')).toBeInTheDocument()
    expect(srRegion.textContent).toBe('05:00')

    // Ещё 10 тиков внутри warning-зоны — фаза не меняется, aria-live НЕ обновляется повторно.
    for (let tick = 0; tick < 10; tick += 1) {
      act(() => {
        vi.advanceTimersByTime(1_000)
      })
      expect(srRegion.textContent).toBe('05:00')
    }
  })
})

describe('CountdownTimer — AC2: отрицательное время отображается явно, не клэмпится к 00:00', () => {
  it('remainingSeconds < 0 — видимый текст с явным минусом, цвет --brand-danger', () => {
    const { container } = render(
      <CountdownTimer targetTimestamp={NOW + 5_000} warningThresholdSeconds={300} dangerThresholdSeconds={0} />,
    )

    act(() => {
      vi.advanceTimersByTime(6_000)
    })

    expect(getVisibleValue(container)).toBe('-00:01')
    expect(container.querySelector('.ui-countdown-timer--danger')).toBeInTheDocument()
    expect(getVisibleValue(container)).not.toBe('00:00')
  })

  it('просрочка на несколько минут — минус не отбрасывается на большем времени', () => {
    const { container } = render(
      <CountdownTimer targetTimestamp={NOW - 65_000} warningThresholdSeconds={300} dangerThresholdSeconds={0} />,
    )
    expect(getVisibleValue(container)).toBe('-01:05')
  })
})

describe('CountdownTimer — пороговая эскалация: danger может наступить ДО просрочки (dangerThresholdSeconds > 0)', () => {
  it('remainingSeconds внутри [0, dangerThresholdSeconds) — уже danger, но ещё НЕ overdue (время положительное)', () => {
    const { container } = render(
      <CountdownTimer targetTimestamp={NOW + 59_000} warningThresholdSeconds={300} dangerThresholdSeconds={60} />,
    )
    expect(getVisibleValue(container)).toBe('00:59')
    expect(container.querySelector('.ui-countdown-timer--danger')).toBeInTheDocument()
  })

  it('remainingSeconds === dangerThresholdSeconds — граница ещё НЕ danger (строгое <)', () => {
    render(<CountdownTimer targetTimestamp={NOW + 60_000} warningThresholdSeconds={300} dangerThresholdSeconds={60} />)
    expect(document.querySelector('.ui-countdown-timer--warning')).toBeInTheDocument()
    expect(document.querySelector('.ui-countdown-timer--danger')).not.toBeInTheDocument()
  })
})

describe('CountdownTimer — пороги НЕ хардкодятся (риск тикета DTJ-407 п.6)', () => {
  it('разные экземпляры с разными порогами эскалируют независимо', () => {
    const { container: strict } = render(
      <CountdownTimer targetTimestamp={NOW + 10_000} warningThresholdSeconds={20} dangerThresholdSeconds={5} />,
    )
    const { container: lenient } = render(
      <CountdownTimer targetTimestamp={NOW + 10_000} warningThresholdSeconds={5} dangerThresholdSeconds={0} />,
    )

    // 10с осталось: strict (порог 20с) — уже warning; lenient (порог 5с) — ещё normal.
    expect(strict.querySelector('.ui-countdown-timer--warning')).toBeInTheDocument()
    expect(lenient.querySelector('.ui-countdown-timer--normal')).toBeInTheDocument()
  })
})

describe('CountdownTimer — стабильная ширина цифр (визуальный инвариант, НЕ пиксельное измерение в jsdom)', () => {
  it('использует моно-ширину чисел через CSS (font-variant-numeric), а не смену DOM-структуры между тиками', () => {
    // ОГРАНИЧЕНИЕ: jsdom не резолвит `getComputedStyle` для правил из внешнего CSS-файла и не
    // считает layout — здесь проверяется только структурный инвариант (один и тот же <span>,
    // без замены на другой набор DOM-узлов при каждом тике), а не фактическая пиксельная ширина.
    const { container } = render(
      <CountdownTimer targetTimestamp={NOW + 65_000} warningThresholdSeconds={300} dangerThresholdSeconds={0} />,
    )
    const valueBefore = container.querySelector('.ui-countdown-timer__value')
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    const valueAfter = container.querySelector('.ui-countdown-timer__value')
    expect(valueBefore).toBe(valueAfter)
    expect(valueAfter?.textContent).toBe('01:04')
  })
})

describe('CountdownTimer — доступность', () => {
  it('ноль critical/serious a11y-нарушений', async () => {
    // `axe.run` асинхронен и не совместим с fake timers этого файла — реальные таймеры только
    // на время этого теста, `afterEach` всё равно переустанавливает `vi.useRealTimers()`.
    vi.useRealTimers()
    const { axeResults } = await renderWithA11yCheck(
      <CountdownTimer targetTimestamp={Date.now() + 400_000} warningThresholdSeconds={300} dangerThresholdSeconds={0} />,
    )
    expect(axeResults).toHaveNoViolations()
  })
})
