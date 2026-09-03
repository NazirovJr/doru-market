import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useT } from '@dorutj/i18n'
import type { CartPharmacyGroupDto } from '@dorutj/contracts'
import { OrderSummarySection } from './order-summary-section'

const { t } = useT('ru')

const GROUPS: readonly CartPharmacyGroupDto[] = [
  { pharmacyId: 'p1', pharmacyName: 'Аптека 1', items: [{ medicineId: 'm1', medicineTradeName: 'Парацетамол', pharmacyId: 'p1', pharmacyName: 'Аптека 1', quantity: 2, unitPriceDiram: 500 }], subtotalDiram: 1000 },
  { pharmacyId: 'p2', pharmacyName: null, items: [], subtotalDiram: 2000 },
]

describe('OrderSummarySection (DTJ-235)', () => {
  it('1. рендерит группу по каждой аптеке с названием и подытогом', () => {
    render(<OrderSummarySection pharmacyGroups={GROUPS} locale="ru" t={t} />)
    const rows = screen.getAllByTestId('checkout-summary-group')
    expect(rows).toHaveLength(2)
    expect(screen.getByText('Аптека 1')).toBeInTheDocument()
  })

  it('2. pharmacyName=null — фолбэк cart.pharmacy_unknown_name', () => {
    render(<OrderSummarySection pharmacyGroups={GROUPS} locale="ru" t={t} />)
    expect(screen.getByText('Аптека')).toBeInTheDocument()
  })

  it('3. итог по товарам — сумма subtotalDiram всех групп (1000+2000=3000 diram → 30.00)', () => {
    render(<OrderSummarySection pharmacyGroups={GROUPS} locale="ru" t={t} />)
    expect(screen.getByTestId('checkout-summary-items-total')).toHaveTextContent('30,00')
  })

  it('4. НЕ рисует фиктивную сумму доставки — только сноска-предупреждение', () => {
    render(<OrderSummarySection pharmacyGroups={GROUPS} locale="ru" t={t} />)
    expect(screen.queryByText(/доставка \d/i)).not.toBeInTheDocument()
  })
})
