import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { TranslateFunction } from '@dorutj/i18n'
import { AnalogCard } from './analog-card'
import type { AnalogItemDto } from '../api/use-analogs-query'

/**
 * `analog-card.spec.tsx` (DTJ-104, `SRS-CAT-040`, `TC-CAT-016`).
 *
 * `t` — простой стаб (интерполяция `{param}`, тот же плейсхолдер-синтаксис, что
 * `packages/i18n/src/use-t.ts`), НЕ реальный словарь — структурные проверки через `data-testid`,
 * не завязаны на конкретный переведённый текст (тот же приём, что `pharmacy-pin-popup.spec.tsx`).
 */
const stubT: TranslateFunction = (key, params) => {
  if (params === undefined) return key
  return `${key}:${Object.entries(params)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(',')}`
}

function buildItem(overrides: Partial<AnalogItemDto> = {}): AnalogItemDto {
  return {
    medicineId: '22222222-2222-2222-2222-222222222222',
    tradeName: 'Парацетамол-OTC',
    manufacturerName: 'Завод №1',
    cheapestOffer: {
      pharmacyId: '33333333-3333-3333-3333-333333333333',
      priceDiram: 1800,
      distanceMeters: 500,
      isStale: false,
      lastSyncedAt: '2026-09-01T00:00:00Z',
    },
    isPrescriptionRequired: false,
    ...overrides,
  }
}

describe('AnalogCard (DTJ-104)', () => {
  it('1. OTC-элемент (isPrescriptionRequired=false) — Rx-бейдж отсутствует', () => {
    render(<AnalogCard item={buildItem({ isPrescriptionRequired: false })} locale="tj" t={stubT} />)
    expect(screen.queryByTestId('analog-card-rx-badge')).not.toBeInTheDocument()
  })

  it('2. Rx-элемент (isPrescriptionRequired=true) — Rx-бейдж присутствует', () => {
    render(<AnalogCard item={buildItem({ isPrescriptionRequired: true })} locale="tj" t={stubT} />)
    expect(screen.getByTestId('analog-card-rx-badge')).toBeInTheDocument()
  })

  it('3. TC-CAT-016: смешанный список — Rx-бейдж присутствует ТОЛЬКО у Rx-карточки, не у обеих', () => {
    const otcItem = buildItem({ medicineId: 'otc-id', isPrescriptionRequired: false })
    const rxItem = buildItem({ medicineId: 'rx-id', isPrescriptionRequired: true, manufacturerName: 'Завод №2' })

    render(
      <>
        <AnalogCard item={otcItem} locale="tj" t={stubT} />
        <AnalogCard item={rxItem} locale="tj" t={stubT} />
      </>,
    )

    const badges = screen.getAllByTestId('analog-card-rx-badge')
    expect(badges).toHaveLength(1)
    const cards = screen.getAllByTestId('analog-card')
    const rxCard = cards.find((card) => card.getAttribute('data-medicine-id') === 'rx-id')
    expect(rxCard?.querySelector('[data-testid="analog-card-rx-badge"]')).not.toBeNull()
  })

  it('4. отображает название и производителя', () => {
    render(<AnalogCard item={buildItem({ tradeName: 'Ибупрофен', manufacturerName: 'ОАО ФармПром' })} locale="tj" t={stubT} />)
    expect(screen.getByText('Ибупрофен')).toBeInTheDocument()
    expect(screen.getByText('ОАО ФармПром')).toBeInTheDocument()
  })

  it('5. [DTJ-431] цена форматируется через PriceTag/formatMoney (@dorutj/ui), не локальным formatSavings', () => {
    render(<AnalogCard item={buildItem({ cheapestOffer: { ...buildItem().cheapestOffer, priceDiram: 6500 } })} locale="tj" t={stubT} />)
    // Запятая, не точка — locale="tj" маппится на реальный BCP-47 `'tg'` (см. JSDoc `@dorutj/i18n/format-money.ts`).
    // Суффикс "сомонӣ" — часть вывода formatMoney (в отличие от прежнего catalog.search.price, который его не добавлял).
    expect(screen.getByTestId('analog-card-price')).toHaveTextContent('65,00 сомонӣ')
  })
})
