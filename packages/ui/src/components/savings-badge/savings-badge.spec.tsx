import { render, screen } from '@testing-library/react'
import { useT } from '@dorutj/i18n'
import { describe, expect, it } from 'vitest'
import { renderWithA11yCheck } from '../shared/a11y-testing.js'
import { SavingsBadge } from './savings-badge.js'

const { t } = useT('ru')

describe('SavingsBadge — «Сэкономьте N сомони» через formatMoney + Badge tone=success', () => {
  it('рендерит сумму, отформатированную formatMoney, внутри Badge', () => {
    const { container } = render(
      <SavingsBadge savingsDiram={6500} locale="ru" t={t} explanation="Аналог с тем же МНН" />,
    )
    expect(screen.getByText('Сэкономьте 65,00 сомони')).toBeInTheDocument()
    // (без задвоения суффикса — «65,00 сомони» встречается ровно один раз, не «сомони сомони»)
    expect(container.querySelector('.ui-badge--success')).toBeInTheDocument()
  })

  it('локаль tj — тот же ключ, другой суффикс валюты', () => {
    const { t: tTj } = useT('tj')
    render(<SavingsBadge savingsDiram={6500} locale="tj" t={tTj} explanation="Шарҳ" />)
    expect(screen.getByText('65,00 сомонӣ сарфа кунед')).toBeInTheDocument()
  })
})

describe('SavingsBadge — пояснение ОБЯЗАТЕЛЬНО присутствует рядом с цифрой (REQ-UX-1)', () => {
  it('текст-объяснение всегда в DOM рядом с бейджем, не только цифра', () => {
    render(<SavingsBadge savingsDiram={100} locale="ru" t={t} explanation="Найден дешевле рядом" />)
    expect(screen.getByText('Найден дешевле рядом')).toBeInTheDocument()
  })

  it('даже небольшая экономия — пояснение всё равно рендерится (нет условной логики скрытия)', () => {
    render(<SavingsBadge savingsDiram={1} locale="ru" t={t} explanation="Контекст" />)
    expect(screen.getByText('Контекст')).toBeInTheDocument()
    expect(screen.getByText('Сэкономьте 0,01 сомони')).toBeInTheDocument()
  })
})

describe('SavingsBadge — доступность', () => {
  it('ноль critical/serious a11y-нарушений', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <SavingsBadge savingsDiram={6500} locale="ru" t={t} explanation="Пояснение" />,
    )
    expect(axeResults).toHaveNoViolations()
  })
})
