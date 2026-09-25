/**
 * `input.spec.tsx` (DTJ-404, критерий приёмки 3, тест-план тикета).
 */
import { type ReactElement, useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertNoBlockingViolations, renderWithA11yCheck } from '@/a11y/test-utils'
import { Input } from './input'

afterEach(() => {
  cleanup()
})

describe('Input — связка label↔input (SRS-UX-034)', () => {
  it('label связан с input через htmlFor/id', () => {
    render(<Input label="Имя" />)
    expect(screen.getByLabelText('Имя')).toBeInTheDocument()
  })

  it('генерирует id автоматически, если не передан явно', () => {
    render(<Input label="Телефон" />)
    const input = screen.getByLabelText('Телефон')
    expect(input.id).not.toBe('')
  })
})

describe('Input — error-состояние (AC3)', () => {
  it('выставляет aria-invalid и aria-describedby, указывающий на текст ошибки с иконкой', () => {
    render(<Input label="Телефон" error="Обязательное поле" />)
    const input = screen.getByLabelText('Телефон')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    const describedBy = input.getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()
    const errorNode = document.getElementById(describedBy ?? '')
    expect(errorNode).toHaveTextContent('Обязательное поле')
    // Иконка предупреждения — не только текст/рамка (SRS-UX-019 error-строка).
    expect(errorNode?.querySelector('svg')).not.toBeNull()
  })

  it('не выставляет aria-invalid/aria-describedby без ошибки', () => {
    render(<Input label="Телефон" />)
    const input = screen.getByLabelText('Телефон')
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(input).not.toHaveAttribute('aria-describedby')
  })

  it('нулевые critical/serious нарушения доступности в error-состоянии', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <Input label="Телефон" error="Обязательное поле" />,
    )
    assertNoBlockingViolations(axeResults)
  })
})

describe('Input — focus (SRS-UX-019)', () => {
  it('показывает --focus-ring на фокусе и прокидывает переданные onFocus/onBlur', () => {
    const onFocus = vi.fn()
    const onBlur = vi.fn()
    render(<Input label="Телефон" onFocus={onFocus} onBlur={onBlur} />)
    const input = screen.getByLabelText('Телефон')
    fireEvent.focus(input)
    expect(getComputedStyle(input).boxShadow).toContain('var(--focus-ring)')
    expect(onFocus).toHaveBeenCalledTimes(1)
    fireEvent.blur(input)
    expect(getComputedStyle(input).boxShadow).toBe('none')
    expect(onBlur).toHaveBeenCalledTimes(1)
  })
})

describe('Input — контролируемый компонент', () => {
  it('ввод текста не мутирует переданный value напрямую — обновление идёт через onChange', () => {
    const Wrapper = (): ReactElement => {
      const [value, setValue] = useState('')
      return (
        <Input
          label="Название"
          value={value}
          onChange={(event) => { setValue(event.target.value) }}
        />
      )
    }
    render(<Wrapper />)
    const input = screen.getByLabelText<HTMLInputElement>('Название')
    fireEvent.change(input, { target: { value: 'Парацетамол' } })
    expect(input.value).toBe('Парацетамол')
  })

  it('onChange, не обновляющий состояние, не мутирует управляемое value (React controlled-инвариант)', () => {
    render(<Input label="Название" value="фикс" onChange={() => undefined} />)
    const input = screen.getByLabelText<HTMLInputElement>('Название')
    fireEvent.change(input, { target: { value: 'другое' } })
    expect(input.value).toBe('фикс')
  })
})
