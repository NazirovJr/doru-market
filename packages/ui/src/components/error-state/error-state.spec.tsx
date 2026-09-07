import { fireEvent, render, screen } from '@testing-library/react'
import { useT } from '@dorutj/i18n'
import { describe, expect, it, vi } from 'vitest'
import { renderWithA11yCheck } from '../shared/a11y-testing.js'
import { ErrorState, type ErrorStateProps } from './error-state.js'

const { t } = useT('ru')

describe('ErrorState — текст по умолчанию', () => {
  it('без titleKey показывает дружелюбный ux.error.generic_500, без кода ошибки в видимом тексте', () => {
    render(<ErrorState t={t} variant="fullscreen" errorCode="ORDER_ITEM_NOT_FOUND" />)

    expect(screen.getByText('Что-то пошло не так. Попробуйте ещё раз через минуту.')).toBeInTheDocument()
    // Код ошибки присутствует в DOM (details), но НЕ виден пользователю без раскрытия (jsdom не
    // считает layout/CSS `display`, поэтому это проверяется через нативный `open`-атрибут details).
    const details = document.querySelector('.ui-error-state__details')
    expect(details).not.toBeNull()
    expect((details as HTMLDetailsElement).open).toBe(false)
  })

  it('descriptionKey рендерится, когда передан', () => {
    render(<ErrorState t={t} variant="inline" descriptionKey="ux.error.pharmacy_unavailable" />)
    expect(
      screen.getByText('Эта аптека временно недоступна. Товар остался в корзине для другой аптеки.'),
    ).toBeInTheDocument()
  })
})

describe('ErrorState — техническая деталь в details (DoD)', () => {
  /**
   * ГРАНИЦЫ ПРОВЕРКИ: нативный `<details>` без атрибута `open` скрывает содержимое ТОЛЬКО через
   * рендеринг браузера (UA-стили) — `jsdom` не выполняет layout/рендеринг и держит содержимое
   * `<summary>` в дереве запросов `@testing-library` независимо от `open` (см. аналогичную границу
   * в `button.spec.tsx`). Единственный реально измеримый в `jsdom` сигнал — САМ атрибут `open`
   * элемента `<details>`: он и проверяется здесь как структурная гарантия того, что раскрытие
   * происходит ИМЕННО по явному клику на `<summary>`, а не по умолчанию при рендере.
   */
  it('errorCode/requestId скрыты по умолчанию (details закрыт), раскрываются кликом по <summary>', () => {
    render(<ErrorState t={t} variant="fullscreen" errorCode="503" requestId="req-42" />)

    const details = document.querySelector<HTMLDetailsElement>('.ui-error-state__details')!
    expect(details.open).toBe(false)

    const summary = screen.getByText('Технические детали')
    fireEvent.click(summary)

    expect(details.open).toBe(true)
    expect(screen.getByText('Код ошибки: 503')).toBeInTheDocument()
    expect(screen.getByText('ID запроса: req-42')).toBeInTheDocument()
  })

  it('только requestId (без errorCode) — рендерит details с одной строкой', () => {
    render(<ErrorState t={t} variant="fullscreen" requestId="req-only" />)

    fireEvent.click(screen.getByText('Технические детали'))
    expect(screen.queryByText(/Код ошибки/)).not.toBeInTheDocument()
    expect(screen.getByText('ID запроса: req-only')).toBeInTheDocument()
  })

  it('без errorCode/requestId <details> не рендерится вовсе', () => {
    render(<ErrorState t={t} variant="fullscreen" />)
    expect(document.querySelector('.ui-error-state__details')).not.toBeInTheDocument()
  })
})

describe('ErrorState — retry', () => {
  it('кнопка повтора рендерится только с onRetry, клик вызывает обработчик', () => {
    const onRetry = vi.fn()
    const { rerender } = render(<ErrorState t={t} variant="fullscreen" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()

    rerender(<ErrorState t={t} variant="fullscreen" onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

describe('ErrorState — типовой контракт (DoD)', () => {
  it('titleKey ОБЯЗАН быть ключом словаря — произвольный string не компилируется', () => {
    // @ts-expect-error DTJ-406 DoD: ErrorState принимает только i18n-ключи, "Упс" — свободный текст
    const props: ErrorStateProps = { t, variant: 'inline', titleKey: 'Упс' }
    expect(props.titleKey).toBe('Упс')
  })
})

describe('ErrorState — доступность', () => {
  it('ноль critical/serious a11y-нарушений для fullscreen и inline', async () => {
    const fullscreen = await renderWithA11yCheck(
      <ErrorState t={t} variant="fullscreen" onRetry={vi.fn()} errorCode="500" />,
    )
    expect(fullscreen.axeResults).toHaveNoViolations()

    const inline = await renderWithA11yCheck(<ErrorState t={t} variant="inline" />)
    expect(inline.axeResults).toHaveNoViolations()
  })
})
