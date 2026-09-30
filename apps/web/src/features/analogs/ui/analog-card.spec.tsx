import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { formatMoney, useT } from '@dorutj/i18n'
import { AnalogCard } from './analog-card'
import type { AnalogItemDto } from '../api/use-analogs-query'

const { t } = useT('tj')

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

function renderCards(items: readonly AnalogItemDto[], onAddToCart = vi.fn()): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      {items.map((item) => (
        <AnalogCard key={item.medicineId} item={item} locale="tj" t={t} onAddToCart={onAddToCart} />
      ))}
    </MemoryRouter>,
  )
}

describe('AnalogCard (DTJ-104)', () => {
  it('1. OTC-элемент (isPrescriptionRequired=false) — Rx-бейдж отсутствует', () => {
    renderCards([buildItem({ isPrescriptionRequired: false })])
    expect(screen.queryByTestId('analog-card-rx-badge')).not.toBeInTheDocument()
  })

  it('2. Rx-элемент (isPrescriptionRequired=true) — Rx-бейдж присутствует', () => {
    renderCards([buildItem({ isPrescriptionRequired: true })])
    expect(screen.getByTestId('analog-card-rx-badge')).toBeInTheDocument()
  })

  it('3. TC-CAT-016: смешанный список — Rx-бейдж присутствует ТОЛЬКО у Rx-карточки, не у обеих', () => {
    const otcItem = buildItem({ medicineId: 'otc-id', isPrescriptionRequired: false })
    const rxItem = buildItem({ medicineId: 'rx-id', isPrescriptionRequired: true, manufacturerName: 'Завод №2' })

    renderCards([otcItem, rxItem])

    expect(screen.getAllByTestId('analog-card-rx-badge')).toHaveLength(1)
    const cards = screen.getAllByTestId('analog-card')
    const rxCard = cards.find((card) => card.getAttribute('data-medicine-id') === 'rx-id')
    expect(rxCard?.querySelector('[data-testid="analog-card-rx-badge"]')).not.toBeNull()
  })

  it('4. название — ссылка на карточку аналога, производитель отображается', () => {
    renderCards([buildItem({ tradeName: 'Ибупрофен', manufacturerName: 'ОАО ФармПром' })])
    expect(screen.getByRole('link', { name: 'Ибупрофен' })).toHaveAttribute(
      'href',
      '/medicines/22222222-2222-2222-2222-222222222222',
    )
    expect(screen.getByText('ОАО ФармПром')).toBeInTheDocument()
  })

  it('5. цена форматируется через formatMoney', () => {
    renderCards([buildItem({ cheapestOffer: { ...buildItem().cheapestOffer, priceDiram: 6500 } })])
    expect(screen.getByTestId('analog-card-price')).toHaveTextContent(formatMoney(6500, 'tj'))
  })

  it('6. «В корзину» передаёт id аналога и аптеки предложения', () => {
    const onAddToCart = vi.fn()
    renderCards([buildItem()], onAddToCart)

    fireEvent.click(screen.getByRole('button', { name: t('cart.add_item_cta') }))

    expect(onAddToCart).toHaveBeenCalledWith(
      '22222222-2222-2222-2222-222222222222',
      '33333333-3333-3333-3333-333333333333',
    )
  })
})
