import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithA11yCheck } from '../shared/a11y-testing.js'
import { formatDisplayValue, PhoneInput } from './phone-input.js'

describe('formatDisplayValue — полное визуальное значение (AC4)', () => {
  it('пустая строка → только префикс "+992"', () => {
    expect(formatDisplayValue('')).toBe('+992')
  })

  it('полные 9 цифр → "+992 90 123 45 67"', () => {
    expect(formatDisplayValue('901234567')).toBe('+992 90 123 45 67')
  })
})

describe('PhoneInput — маска и normalized onChange (AC4)', () => {
  it('ввод «901234567» → onChange получает +992901234567, поле показывает «90 123 45 67»', () => {
    const onChange = vi.fn()
    render(<PhoneInput label="Телефон" onChange={onChange} />)
    const field = screen.getByLabelText<HTMLInputElement>('Телефон')

    fireEvent.change(field, { target: { value: '901234567' } })

    expect(onChange).toHaveBeenLastCalledWith('+992901234567')
    expect(field.value).toBe('90 123 45 67')
    expect(screen.getByText('+992')).toBeInTheDocument()
  })

  it('маска применяется посимвольно по мере ввода', () => {
    const onChange = vi.fn()
    render(<PhoneInput label="Телефон" onChange={onChange} />)
    const field = screen.getByLabelText<HTMLInputElement>('Телефон')

    fireEvent.change(field, { target: { value: '9' } })
    expect(field.value).toBe('9')
    expect(onChange).toHaveBeenLastCalledWith('+9929')

    fireEvent.change(field, { target: { value: '901' } })
    expect(field.value).toBe('90 1')
    expect(onChange).toHaveBeenLastCalledWith('+992901')
  })

  it('нечисловые символы игнорируются, лишние цифры после 9-й отбрасываются', () => {
    const onChange = vi.fn()
    render(<PhoneInput label="Телефон" onChange={onChange} />)
    const field = screen.getByLabelText<HTMLInputElement>('Телефон')

    fireEvent.change(field, { target: { value: '90-123-45-67-89' } })

    expect(field.value).toBe('90 123 45 67')
    expect(onChange).toHaveBeenLastCalledWith('+992901234567')
  })

  it('пустое значение отдаёт наружу пустую строку, не "+992"', () => {
    const onChange = vi.fn()
    render(<PhoneInput label="Телефон" onChange={onChange} defaultValue="9" />)
    const field = screen.getByLabelText<HTMLInputElement>('Телефон')

    fireEvent.change(field, { target: { value: '' } })

    expect(onChange).toHaveBeenLastCalledWith('')
    expect(field.value).toBe('')
  })
})

describe('PhoneInput — blur-валидация (SRS-DOM-069)', () => {
  it('неполный номер на blur вызывает onValidate(false)', () => {
    const onValidate = vi.fn()
    render(<PhoneInput label="Телефон" onChange={() => undefined} onValidate={onValidate} />)
    const field = screen.getByLabelText<HTMLInputElement>('Телефон')

    fireEvent.change(field, { target: { value: '901' } })
    fireEvent.blur(field)

    expect(onValidate).toHaveBeenCalledWith(false)
  })

  it('полные 9 цифр на blur вызывают onValidate(true)', () => {
    const onValidate = vi.fn()
    render(<PhoneInput label="Телефон" onChange={() => undefined} onValidate={onValidate} />)
    const field = screen.getByLabelText<HTMLInputElement>('Телефон')

    fireEvent.change(field, { target: { value: '901234567' } })
    fireEvent.blur(field)

    expect(onValidate).toHaveBeenCalledWith(true)
  })

  it('внешний onBlur потребителя вызывается наряду с onValidate', () => {
    const onBlur = vi.fn()
    render(<PhoneInput label="Телефон" onChange={() => undefined} onBlur={onBlur} />)
    const field = screen.getByLabelText<HTMLInputElement>('Телефон')

    fireEvent.blur(field)

    expect(onBlur).toHaveBeenCalledTimes(1)
  })

  it('внешний aria-describedby потребителя объединяется с id текста ошибки', () => {
    render(
      <PhoneInput
        label="Телефон"
        onChange={() => undefined}
        error="Введите полный номер"
        aria-describedby="hint-id"
      />,
    )
    const field = screen.getByLabelText<HTMLInputElement>('Телефон')
    expect(field.getAttribute('aria-describedby')).toContain('hint-id')
  })

  it('error-проп показывает error-слот Input (aria-invalid + aria-describedby)', () => {
    render(<PhoneInput label="Телефон" onChange={() => undefined} error="Введите полный номер" />)
    const field = screen.getByLabelText<HTMLInputElement>('Телефон')
    const errorParagraph = screen.getByText('Введите полный номер').closest('p')

    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field.getAttribute('aria-describedby')).toBe(errorParagraph?.id)
  })
})

describe('PhoneInput — доступность', () => {
  it('ноль critical/serious a11y-нарушений (default и error)', async () => {
    const defaultResult = await renderWithA11yCheck(<PhoneInput label="Телефон" onChange={() => undefined} />)
    expect(defaultResult.axeResults).toHaveNoViolations()

    const errorResult = await renderWithA11yCheck(
      <PhoneInput label="Телефон" onChange={() => undefined} error="Введите полный номер" />,
    )
    expect(errorResult.axeResults).toHaveNoViolations()
  })
})
