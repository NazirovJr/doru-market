/**
 * `savings-badge.spec.tsx` (DTJ-407, тест-план тикета).
 */
import { cleanup, render, screen } from '@testing-library/react'
import { useT } from '@dorutj/i18n'
import { afterEach, describe, expect, it } from 'vitest'
import { SavingsBadge } from './savings-badge'

afterEach(() => {
  cleanup()
})

const { t } = useT('ru')

describe('SavingsBadge — сумма + обязательный текст-объяснение (REQ-UX-1, тест-план DTJ-407)', () => {
  it('рендерит отформатированную сумму экономии через formatMoney внутри Badge', () => {
    render(<SavingsBadge savingsDiram={6500} locale="ru" t={t} />)
    expect(screen.getByTestId('savings-badge')).toHaveTextContent('65.00 сомони')
  })

  it('ВСЕГДА рендерит текст-объяснение рядом с суммой — не изолированная цифра (REQ-UX-1)', () => {
    render(<SavingsBadge savingsDiram={6500} locale="ru" t={t} />)
    expect(screen.getByTestId('savings-badge-explanation')).toHaveTextContent(t('ux.savings.badge_explanation'))
  })

  it('объяснение присутствует и для малой суммы экономии (не убирается)', () => {
    render(<SavingsBadge savingsDiram={1} locale="ru" t={t} />)
    expect(screen.getByTestId('savings-badge')).toHaveTextContent('0.01 сомони')
    expect(screen.getByTestId('savings-badge-explanation')).toBeInTheDocument()
  })

  it('переключает суффикс валюты по локали (tj)', () => {
    render(<SavingsBadge savingsDiram={6500} locale="tj" t={t} />)
    expect(screen.getByTestId('savings-badge')).toHaveTextContent('65.00 сомонӣ')
  })
})
