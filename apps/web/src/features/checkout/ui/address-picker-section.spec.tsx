import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useT } from '@dorutj/i18n'
import { createInitialCheckoutFormState, validateCheckoutForm } from '../model/checkout-form.model'
import { AddressPickerSection, type SavedAddressOption } from './address-picker-section'

const { t } = useT('ru')

function baseProps(overrides: Partial<Parameters<typeof AddressPickerSection>[0]> = {}) {
  const state = createInitialCheckoutFormState()
  return {
    state,
    validation: validateCheckoutForm(state),
    savedAddresses: [] as readonly SavedAddressOption[],
    onSelectSavedAddress: vi.fn(),
    onSwitchToInlineAddress: vi.fn(),
    onAddressTextChange: vi.fn(),
    onCoordinatesPick: vi.fn(),
    onLandmarkChange: vi.fn(),
    onEntranceChange: vi.fn(),
    onFloorChange: vi.fn(),
    onApartmentChange: vi.fn(),
    t,
    ...overrides,
  }
}

describe('AddressPickerSection (DTJ-235)', () => {
  it('1. пустой savedAddresses — секция «сохранённые адреса» не рендерится, форма инлайн-ввода видна', () => {
    render(<AddressPickerSection {...baseProps()} />)
    expect(screen.queryByTestId('checkout-address-saved-list')).not.toBeInTheDocument()
    expect(screen.getByTestId('checkout-address-inline-form')).toBeInTheDocument()
  })

  it('2. непустой savedAddresses — рендерит опции, клик вызывает onSelectSavedAddress', () => {
    const onSelectSavedAddress = vi.fn()
    render(
      <AddressPickerSection
        {...baseProps({ savedAddresses: [{ id: 'addr-1', label: 'Дом' }], onSelectSavedAddress })}
      />,
    )
    fireEvent.click(screen.getByTestId('checkout-address-saved-option-addr-1'))
    expect(onSelectSavedAddress).toHaveBeenCalledWith('addr-1')
  })

  it('3. ввод текста адреса вызывает onAddressTextChange', () => {
    const onAddressTextChange = vi.fn()
    render(<AddressPickerSection {...baseProps({ onAddressTextChange })} />)
    fireEvent.change(screen.getByTestId('checkout-address-text-input'), { target: { value: 'ул. Рудаки, 12' } })
    expect(onAddressTextChange).toHaveBeenCalledWith('ул. Рудаки, 12')
  })

  it('4. клик по карте-пикеру вызывает onCoordinatesPick с координатами демо-точки', () => {
    const onCoordinatesPick = vi.fn()
    render(<AddressPickerSection {...baseProps({ onCoordinatesPick })} />)
    fireEvent.click(screen.getByTestId('checkout-address-map-picker-button'))
    expect(onCoordinatesPick).toHaveBeenCalledWith(38.5598, 68.787)
  })

  it('5. координаты не выбраны — показывает checkout.address.map_picker_not_selected', () => {
    render(<AddressPickerSection {...baseProps()} />)
    expect(screen.getByTestId('checkout-address-map-picker-status')).toHaveTextContent('не выбрана')
  })

  it('6. ошибка валидации адреса — показывает checkout.address.error_text_required', () => {
    const state = createInitialCheckoutFormState()
    render(<AddressPickerSection {...baseProps({ state, validation: validateCheckoutForm(state) })} />)
    expect(screen.getByTestId('checkout-address-text-error')).toBeInTheDocument()
  })

  it('7. подъезд/этаж/квартира — три отдельных поля, каждое зовёт свой колбэк', () => {
    const onEntranceChange = vi.fn()
    const onFloorChange = vi.fn()
    const onApartmentChange = vi.fn()
    render(<AddressPickerSection {...baseProps({ onEntranceChange, onFloorChange, onApartmentChange })} />)
    fireEvent.change(screen.getByTestId('checkout-address-entrance-input'), { target: { value: '2' } })
    fireEvent.change(screen.getByTestId('checkout-address-floor-input'), { target: { value: '5' } })
    fireEvent.change(screen.getByTestId('checkout-address-apartment-input'), { target: { value: '34' } })
    expect(onEntranceChange).toHaveBeenCalledWith('2')
    expect(onFloorChange).toHaveBeenCalledWith('5')
    expect(onApartmentChange).toHaveBeenCalledWith('34')
  })
})
