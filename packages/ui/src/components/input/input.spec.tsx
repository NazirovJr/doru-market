import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithA11yCheck } from '../shared/a11y-testing.js'
import { Input } from './input.js'
import { Textarea } from './textarea.js'

describe('Input/Textarea — связка label↔control (SRS-UX-034)', () => {
  it('Input: label связан с полем через htmlFor/id', () => {
    render(<Input label="Телефон" value="" onChange={() => undefined} />);
    const field = screen.getByLabelText('Телефон')
    expect(field).toBeInstanceOf(HTMLInputElement)
  })

  it('Textarea: label связан с полем через htmlFor/id', () => {
    render(<Textarea label="Комментарий" value="" onChange={() => undefined} />)
    const field = screen.getByLabelText('Комментарий')
    expect(field).toBeInstanceOf(HTMLTextAreaElement)
  })
})

describe('Input — error-состояние (AC3)', () => {
  it('выставляет aria-invalid и aria-describedby на текст ошибки, рядом с текстом есть иконка', () => {
    render(<Input label="Телефон" value="" onChange={() => undefined} error="Обязательное поле" />)

    const field = screen.getByLabelText('Телефон')
    const errorParagraph = screen.getByText('Обязательное поле').closest('p')

    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(errorParagraph).not.toBeNull()
    expect(field.getAttribute('aria-describedby')).toBe(errorParagraph?.id)
    expect(errorParagraph?.querySelector('svg')).not.toBeNull()
  })

  it('без error — aria-invalid и aria-describedby отсутствуют', () => {
    render(<Input label="Телефон" value="" onChange={() => undefined} />)
    const field = screen.getByLabelText('Телефон')

    expect(field).not.toHaveAttribute('aria-invalid')
    expect(field).not.toHaveAttribute('aria-describedby')
  })
})

describe('Input — управляемый компонент', () => {
  it('ввод текста не мутирует переданный value-проп напрямую — состояние держит потребитель', () => {
    const onChange = vi.fn()
    const { rerender } = render(<Input label="Телефон" value="9" onChange={onChange} />)
    const field = screen.getByLabelText<HTMLInputElement>('Телефон')

    fireEvent.change(field, { target: { value: '92' } })

    expect(onChange).toHaveBeenCalledTimes(1)
    // Проп value НЕ поменялся сам — компонент не держит собственное состояние, значение всё ещё "9",
    // пока потребитель не передаст новое value явно (контролируемый компонент).
    expect(field.value).toBe('9')

    rerender(<Input label="Телефон" value="92" onChange={onChange} />)
    expect(field.value).toBe('92')
  })

  it('интегрированный сценарий: поле реально принимает ввод при управлении состоянием потребителем', () => {
    const ControlledInput = (): ReturnType<typeof Input> => {
      const [value, setValue] = useState('')
      return (
        <Input
          label="Телефон"
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
          }}
        />
      )
    }
    render(<ControlledInput />)
    const field = screen.getByLabelText<HTMLInputElement>('Телефон')

    fireEvent.change(field, { target: { value: '+992' } })
    expect(field.value).toBe('+992')
  })
})

describe('Input/Textarea — доступность', () => {
  it('Input: ноль critical/serious a11y-нарушений (default и error)', async () => {
    const defaultResult = await renderWithA11yCheck(<Input label="Телефон" value="" onChange={() => undefined} />)
    expect(defaultResult.axeResults).toHaveNoViolations()

    const errorResult = await renderWithA11yCheck(
      <Input label="Телефон" value="" onChange={() => undefined} error="Обязательное поле" />,
    )
    expect(errorResult.axeResults).toHaveNoViolations()
  })

  it('Textarea: ноль critical/serious a11y-нарушений', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <Textarea label="Комментарий" value="" onChange={() => undefined} />,
    )
    expect(axeResults).toHaveNoViolations()
  })
})
