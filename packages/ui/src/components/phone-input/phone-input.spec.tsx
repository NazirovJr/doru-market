/**
 * `phone-input.spec.tsx` (DTJ-405, критерий приёмки 4, тест-план тикета).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertNoBlockingViolations, renderWithA11yCheck } from '@/a11y/test-utils'
import { PhoneInput } from './phone-input'

afterEach(() => {
  cleanup()
})

describe('PhoneInput — маска и normalized onChange (AC4)', () => {
  it('применяет маску посимвольно и отдаёт normalized E.164-подобную строку в onChange', () => {
    const onChange = vi.fn()
    render(<PhoneInput label="Телефон" onChange={onChange} />)
    const input = screen.getByRole('textbox')

    fireEvent.change(input, { target: { value: '9' } })
    expect(onChange).toHaveBeenLastCalledWith('+9929')

    fireEvent.change(input, { target: { value: '90' } })
    expect(onChange).toHaveBeenLastCalledWith('+99290')

    fireEvent.change(input, { target: { value: '901234567' } })
    expect(onChange).toHaveBeenLastCalledWith('+992901234567')
    expect(input).toHaveValue('90 123 45 67')
  })

  it('фиксированный префикс +992 виден рядом с полем и не редактируется пользователем', () => {
    render(<PhoneInput label="Телефон" onChange={vi.fn()} />)
    expect(screen.getByText('+992')).toBeInTheDocument()
  })

  it('обрезает ввод до 9 национальных цифр', () => {
    const onChange = vi.fn()
    render(<PhoneInput label="Телефон" onChange={onChange} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '9012345678888' } })
    expect(onChange).toHaveBeenLastCalledWith('+992901234567')
  })
})

describe('PhoneInput — blur-валидация неполного номера', () => {
  it('показывает встроенную ошибку и вызывает onValidate(false) при неполном номере на blur', () => {
    const onValidate = vi.fn()
    render(<PhoneInput label="Телефон" onChange={vi.fn()} onValidate={onValidate} locale="ru" />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '90' } })
    fireEvent.blur(input)
    expect(onValidate).toHaveBeenCalledWith(false)
    expect(screen.getByRole('alert')).toHaveTextContent('Введите полный номер телефона')
  })

  it('не показывает ошибку и вызывает onValidate(true) при полном номере на blur', () => {
    const onValidate = vi.fn()
    render(<PhoneInput label="Телефон" onChange={vi.fn()} onValidate={onValidate} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '901234567' } })
    fireEvent.blur(input)
    expect(onValidate).toHaveBeenCalledWith(true)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('внешний проп error имеет приоритет над встроенной валидацией', () => {
    render(<PhoneInput label="Телефон" onChange={vi.fn()} error="Номер уже занят" />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '901234567' } })
    fireEvent.blur(input)
    expect(screen.getByRole('alert')).toHaveTextContent('Номер уже занят')
  })
})

describe('PhoneInput — доступность', () => {
  it('нулевые critical/serious нарушения доступности', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <PhoneInput label="Телефон" onChange={vi.fn()} />,
    )
    assertNoBlockingViolations(axeResults)
  })
})
