import { render, screen } from '@testing-library/react'
import { useT } from '@dorutj/i18n'
import { describe, expect, it } from 'vitest'
import { renderWithA11yCheck } from '../shared/a11y-testing.js'
import { OfflineBanner } from './offline-banner.js'

const { t } = useT('ru')

describe('OfflineBanner — видимость управляется ТОЛЬКО isOnline (AC1)', () => {
  it('isOnline=false — показывает канонический текст ux.error.network_offline дословно', () => {
    render(<OfflineBanner t={t} isOnline={false} />)
    expect(
      screen.getByText('Нет подключения к интернету. Показаны последние сохранённые данные.'),
    ).toBeInTheDocument()
  })

  it('isOnline=true — баннер полностью отсутствует в DOM', () => {
    const { container } = render(<OfflineBanner t={t} isOnline />)
    expect(container.querySelector('.ui-offline-banner')).not.toBeInTheDocument()
  })

  it('переключение isOnline false → true убирает баннер из DOM без участия пользователя', () => {
    const { rerender, container } = render(<OfflineBanner t={t} isOnline={false} />)
    expect(container.querySelector('.ui-offline-banner')).toBeInTheDocument()

    rerender(<OfflineBanner t={t} isOnline />)
    expect(container.querySelector('.ui-offline-banner')).not.toBeInTheDocument()
  })
})

describe('OfflineBanner — нет кнопки закрытия в DOM НИ ПРИ КАКОМ состоянии пропсов (структурный тест)', () => {
  it.each([
    { isOnline: false, compact: false },
    { isOnline: false, compact: true },
    { isOnline: true, compact: false },
    { isOnline: true, compact: true },
  ])('isOnline=%s compact=%s — нет ни одного <button>/[role=button] в DOM', ({ isOnline, compact }) => {
    const { container } = render(<OfflineBanner t={t} isOnline={isOnline} compact={compact} />)

    expect(container.querySelectorAll('button')).toHaveLength(0)
    expect(container.querySelectorAll('[role="button"]')).toHaveLength(0)
  })
})

describe('OfflineBanner — компактный/полноэкранный форм-фактор (п.5, ОДИН компонент)', () => {
  it('compact добавляет модификатор класса, не меняет текст', () => {
    const { container } = render(<OfflineBanner t={t} isOnline={false} compact />)
    expect(container.querySelector('.ui-offline-banner--compact')).toBeInTheDocument()
    expect(
      screen.getByText('Нет подключения к интернету. Показаны последние сохранённые данные.'),
    ).toBeInTheDocument()
  })
})

describe('OfflineBanner — доступность', () => {
  it('ноль critical/serious a11y-нарушений', async () => {
    const { axeResults } = await renderWithA11yCheck(<OfflineBanner t={t} isOnline={false} />)
    expect(axeResults).toHaveNoViolations()
  })
})
