import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useT } from '@dorutj/i18n'
import type { CartItemResponseDto } from '@dorutj/contracts'
import { PharmacyGroupCard } from './pharmacy-group-card'

const { t } = useT('ru')

const item = (overrides: Partial<CartItemResponseDto> = {}): CartItemResponseDto => ({
  id: 'item-1',
  cartId: 'cart-1',
  medicineId: 'm1',
  medicineTradeName: 'Парацетамол 500мг',
  pharmacyId: 'p1',
  pharmacyName: 'Аптека 1',
  quantity: 2,
  priceDiram: 500,
  availableQuantity: 5,
  addedAt: '2026-01-01T00:00:00Z',
  ...overrides,
})

describe('PharmacyGroupCard (DTJ-234, AC1)', () => {
  it('1. рендерит название аптеки, позиции и подытог', () => {
    render(
      <PharmacyGroupCard
        pharmacyId="p1"
        pharmacyName="Аптека 1"
        subtotalDiram={1000}
        items={[item()]}
        warningCartItemIds={new Set()}
        locale="ru"
        onRemove={vi.fn()}
        onQuantityChange={vi.fn()}
        t={t}
      />,
    )
    expect(screen.getByTestId('pharmacy-group-name')).toHaveTextContent('Аптека 1')
    expect(screen.getAllByTestId('cart-item-row')).toHaveLength(1)
    // DTJ-431: подытог теперь formatMoney() (@dorutj/i18n) — locale='ru' даёт запятую, не точку
    // прежнего локального formatSomoni().
    expect(screen.getByTestId('pharmacy-group-subtotal')).toHaveTextContent('10,00')
    // DTJ-234 (дефект приёмки): строка показывает читаемое название препарата, НЕ medicineId (UUID).
    expect(screen.getByTestId('cart-item-medicine-name')).toHaveTextContent('Парацетамол 500мг')
    expect(screen.getByTestId('cart-item-medicine-name')).not.toHaveTextContent('m1')
  })

  it('2. pharmacyName=null — использует fallback cart.pharmacy_unknown_name', () => {
    render(
      <PharmacyGroupCard
        pharmacyId="p1"
        pharmacyName={null}
        subtotalDiram={1000}
        items={[item()]}
        warningCartItemIds={new Set()}
        locale="ru"
        onRemove={vi.fn()}
        onQuantityChange={vi.fn()}
        t={t}
      />,
    )
    expect(screen.getByTestId('pharmacy-group-name')).toHaveTextContent('Аптека')
  })

  it('3. клик по кнопке удаления вызывает onRemove с id строки', () => {
    const onRemove = vi.fn()
    render(
      <PharmacyGroupCard
        pharmacyId="p1"
        pharmacyName="Аптека 1"
        subtotalDiram={1000}
        items={[item({ id: 'item-9' })]}
        warningCartItemIds={new Set()}
        locale="ru"
        onRemove={onRemove}
        onQuantityChange={vi.fn()}
        t={t}
      />,
    )
    fireEvent.click(screen.getByTestId('cart-item-remove'))
    expect(onRemove).toHaveBeenCalledWith('item-9')
  })

  it('4. степпер: "+" вызывает onQuantityChange(id, quantity+1), "−" — (id, quantity-1)', () => {
    const onQuantityChange = vi.fn()
    render(
      <PharmacyGroupCard
        pharmacyId="p1"
        pharmacyName="Аптека 1"
        subtotalDiram={1000}
        items={[item({ id: 'item-1', quantity: 3 })]}
        warningCartItemIds={new Set()}
        locale="ru"
        onRemove={vi.fn()}
        onQuantityChange={onQuantityChange}
        t={t}
      />,
    )
    fireEvent.click(screen.getByTestId('cart-item-increase'))
    expect(onQuantityChange).toHaveBeenCalledWith('item-1', 4)
    fireEvent.click(screen.getByTestId('cart-item-decrease'))
    expect(onQuantityChange).toHaveBeenCalledWith('item-1', 2)
  })

  it('5. quantity=1 — кнопка "−" disabled (явное удаление через отдельную кнопку, не через 0)', () => {
    render(
      <PharmacyGroupCard
        pharmacyId="p1"
        pharmacyName="Аптека 1"
        subtotalDiram={500}
        items={[item({ quantity: 1 })]}
        warningCartItemIds={new Set()}
        locale="ru"
        onRemove={vi.fn()}
        onQuantityChange={vi.fn()}
        t={t}
      />,
    )
    expect(screen.getByTestId('cart-item-decrease')).toBeDisabled()
  })

  it('6. [AC4, SRS-UX-002] удаление/степпер несут классы тап-зоны min-h-12/min-w-12', () => {
    render(
      <PharmacyGroupCard
        pharmacyId="p1"
        pharmacyName="Аптека 1"
        subtotalDiram={500}
        items={[item()]}
        warningCartItemIds={new Set()}
        locale="ru"
        onRemove={vi.fn()}
        onQuantityChange={vi.fn()}
        t={t}
      />,
    )
    for (const testId of ['cart-item-remove', 'cart-item-increase', 'cart-item-decrease']) {
      const button = screen.getByTestId(testId)
      expect(button).toHaveClass('min-h-12')
      expect(button).toHaveClass('min-w-12')
    }
  })

  it('7. строка с warningCartItemIds — помечена data-has-stock-warning=true', () => {
    render(
      <PharmacyGroupCard
        pharmacyId="p1"
        pharmacyName="Аптека 1"
        subtotalDiram={500}
        items={[item({ id: 'item-1' })]}
        warningCartItemIds={new Set(['item-1'])}
        locale="ru"
        onRemove={vi.fn()}
        onQuantityChange={vi.fn()}
        t={t}
      />,
    )
    expect(screen.getByTestId('cart-item-row')).toHaveAttribute('data-has-stock-warning', 'true')
  })
})
