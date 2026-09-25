/**
 * `analog-banner.spec.tsx` (DTJ-407, тест-план тикета, критерий приёмки 3).
 */
import { cleanup, render, screen } from '@testing-library/react'
import { useT } from '@dorutj/i18n'
import { afterEach, describe, expect, it } from 'vitest'
import { AnalogBanner } from './analog-banner'

afterEach(() => {
  cleanup()
})

const { t } = useT('ru')

const BASE_PROPS = {
  substanceName: 'Парацетамол',
  dosage: '500 мг',
  analogPriceDiram: 3500,
  referencePriceDiram: 10000,
  locale: 'ru' as const,
  t,
}

describe('AnalogBanner — inline-разметка, не модальная (критерий приёмки 3, тест-план DTJ-407)', () => {
  it('НЕ рендерит role="dialog" и не является Modal (проверка структуры — inline)', () => {
    render(<AnalogBanner {...BASE_PROPS} savingsPercent={65} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('рендерит текст сравнения цены с подставленными параметрами', () => {
    render(<AnalogBanner {...BASE_PROPS} savingsPercent={65} />)
    const message = screen.getByTestId('analog-banner-message')
    expect(message).toHaveTextContent('Парацетамол')
    expect(message).toHaveTextContent('500 мг')
    expect(message).toHaveTextContent('35.00 сомони')
    expect(message).toHaveTextContent('100.00 сомони')
    expect(message).toHaveTextContent('65')
  })

  it('рендерит дисклеймер (catalog.analogs.disclaimer) при большой экономии', () => {
    render(<AnalogBanner {...BASE_PROPS} savingsPercent={65} />)
    expect(screen.getByTestId('analog-banner-disclaimer')).toHaveTextContent(t('catalog.analogs.disclaimer'))
  })

  it('рендерит дисклеймер ВСЕГДА — даже при небольшой экономии, он не пропадает (SRS-CAT-039)', () => {
    render(<AnalogBanner {...BASE_PROPS} savingsPercent={1} />)
    expect(screen.getByTestId('analog-banner-disclaimer')).toHaveTextContent(t('catalog.analogs.disclaimer'))
    expect(screen.getByTestId('analog-banner-message')).toBeInTheDocument()
  })
})
