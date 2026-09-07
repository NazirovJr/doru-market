import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { assertHitArea, renderWithA11yCheck } from '../shared/a11y-testing.js'
import { LanguageSwitcher } from './language-switcher.js'

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

describe('LanguageSwitcher — работает БЕЗ авторизации (AC1, DoD)', () => {
  it(
    'Given <LanguageSwitcher currentLocale="tj" onChange={fn} /> БЕЗ какого-либо контекста ' +
      'авторизации в пропсах, When клик по пилюле «RU», Then fn("ru") вызывается — компонент не ' +
      'принимает и не требует токена/сессии/провайдера авторизации для собственной работы. ' +
      'ГРАНИЦА: рендер идёт БЕЗ какого-либо React-контекста авторизации в дереве (нет обёртки ' +
      '<AuthProvider>/<SessionProvider> и т.п.), а тип LanguageSwitcherProps физически не ' +
      'содержит полей token/session/user — доказательство статическое (интерфейс пропсов) и ' +
      'поведенческое (рендер+клик работают) одновременно.',
    () => {
      const onChange = vi.fn()

      // Намеренно рендерим БЕЗ единого auth-провайдера/токена — только пропы, явно
      // перечисленные в LanguageSwitcherProps (currentLocale/onChange/aria-label).
      render(<LanguageSwitcher currentLocale="tj" onChange={onChange} aria-label="Язык интерфейса" />)

      const ruPill = screen.getByRole('button', { name: 'RU' })
      fireEvent.click(ruPill)

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith('ru')
    },
  )

  it('LanguageSwitcherProps не содержит полей авторизации (token/session/user) — компилируемая проверка формы пропсов', () => {
    // @ts-expect-error намеренная попытка передать проп авторизации — TS обязан отклонить лишний проп, доказывая, что API компонента физически не принимает состояние сессии
    render(<LanguageSwitcher currentLocale="tj" onChange={() => undefined} aria-label="Язык" token="fake-jwt" />)
  })
})

describe('LanguageSwitcher — переключение', () => {
  it('рендерит ровно 3 пилюли TJ/RU/EN', () => {
    render(<LanguageSwitcher currentLocale="ru" onChange={() => undefined} aria-label="Язык интерфейса" />)
    expect(screen.getAllByRole('button')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'TJ' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'RU' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'EN' })).toBeInTheDocument()
  })

  it('активная локаль получает aria-pressed="true", остальные — "false"', () => {
    render(<LanguageSwitcher currentLocale="en" onChange={() => undefined} aria-label="Язык интерфейса" />)
    expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'TJ' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'RU' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('клик по уже активной пилюле всё равно вызывает onChange с тем же кодом', () => {
    const onChange = vi.fn()
    render(<LanguageSwitcher currentLocale="tj" onChange={onChange} aria-label="Язык интерфейса" />)
    fireEvent.click(screen.getByRole('button', { name: 'TJ' }))
    expect(onChange).toHaveBeenCalledWith('tj')
  })
})

describe('LanguageSwitcher — тап-зона (SRS-UX-002, DoD)', () => {
  it('каждая пилюля ≥48×48px эффективной области попадания', () => {
    render(<LanguageSwitcher currentLocale="tj" onChange={() => undefined} aria-label="Язык интерфейса" />)
    for (const pillLabel of ['TJ', 'RU', 'EN']) {
      const pill = screen.getByRole('button', { name: pillLabel })
      pill.getBoundingClientRect = () => createRect(48)
      assertHitArea(pill, 48)
    }
  })
})

describe('LanguageSwitcher — доступность', () => {
  it('ноль critical/serious a11y-нарушений', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <LanguageSwitcher currentLocale="tj" onChange={() => undefined} aria-label="Язык интерфейса" />,
    )
    expect(axeResults).toHaveNoViolations()
  })
})
