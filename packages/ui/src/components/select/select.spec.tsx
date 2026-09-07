import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithA11yCheck } from '../shared/a11y-testing.js'
import { Select } from './select.js'

const OPTIONS = [
  { value: 'ru', label: 'Русский' },
  { value: 'tj', label: 'Тоҷикӣ' },
  { value: 'en', label: 'English' },
]

describe('Select — closed/open, role=listbox', () => {
  it('закрыт по умолчанию, открывается по клику, aria-expanded меняется', () => {
    render(<Select label="Язык" options={OPTIONS} value={null} onChange={() => undefined} placeholder="Выберите" />)
    const trigger = screen.getByRole('button', { name: 'Язык' })

    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('listbox')).toBeVisible()
  })

  it('повторный клик по триггеру закрывает открытый список', () => {
    render(<Select label="Язык" options={OPTIONS} value={null} onChange={() => undefined} placeholder="Выберите" />)
    const trigger = screen.getByRole('button', { name: 'Язык' })

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('наведение мышью на опцию меняет выделение (highlightedIndex)', () => {
    render(<Select label="Язык" options={OPTIONS} value={null} onChange={() => undefined} placeholder="Выберите" />)
    const trigger = screen.getByRole('button', { name: 'Язык' })
    fireEvent.click(trigger)

    fireEvent.mouseEnter(screen.getByRole('option', { name: 'English' }))

    expect(trigger.getAttribute('aria-activedescendant')).toMatch(/option-2$/)
  })

  it('blur за пределы обёртки закрывает список, blur внутрь обёртки — нет', () => {
    render(<Select label="Язык" options={OPTIONS} value={null} onChange={() => undefined} placeholder="Выберите" />)
    const trigger = screen.getByRole('button', { name: 'Язык' })
    fireEvent.click(trigger)

    fireEvent.blur(trigger, { relatedTarget: screen.getByRole('option', { name: 'Русский' }) })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    fireEvent.blur(trigger, { relatedTarget: document.body })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('плейсхолдер показывается, когда value=null', () => {
    render(<Select label="Язык" options={OPTIONS} value={null} onChange={() => undefined} placeholder="Выберите" />)
    expect(screen.getByRole('button', { name: 'Язык' })).toHaveTextContent('Выберите')
  })

  it('выделяет текущее значение в списке (aria-selected)', () => {
    render(<Select label="Язык" options={OPTIONS} value="tj" onChange={() => undefined} placeholder="Выберите" />)
    fireEvent.click(screen.getByRole('button', { name: 'Язык' }))
    expect(screen.getByRole('option', { name: 'Тоҷикӣ' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: 'Русский' })).toHaveAttribute('aria-selected', 'false')
  })
})

describe('Select — клавиатурная навигация', () => {
  it('ArrowDown несколько раз двигает выделение, не открывая второй список', () => {
    render(<Select label="Язык" options={OPTIONS} value={null} onChange={() => undefined} placeholder="Выберите" />)
    const trigger = screen.getByRole('button', { name: 'Язык' })

    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(screen.getAllByRole('listbox')).toHaveLength(1)
    expect(trigger.getAttribute('aria-activedescendant')).toMatch(/option-0$/)

    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(screen.getAllByRole('listbox')).toHaveLength(1)
    expect(trigger.getAttribute('aria-activedescendant')).toMatch(/option-1$/)
  })

  it('ArrowUp двигает выделение вверх, не открывая второй список', () => {
    render(<Select label="Язык" options={OPTIONS} value="en" onChange={() => undefined} placeholder="Выберите" />)
    const trigger = screen.getByRole('button', { name: 'Язык' })

    fireEvent.keyDown(trigger, { key: 'ArrowUp' })
    expect(screen.getAllByRole('listbox')).toHaveLength(1)
    expect(trigger.getAttribute('aria-activedescendant')).toMatch(/option-2$/)

    fireEvent.keyDown(trigger, { key: 'ArrowUp' })
    expect(trigger.getAttribute('aria-activedescendant')).toMatch(/option-1$/)
  })

  it('Enter без опций не вызывает onChange (защита от выхода за границы)', () => {
    const onChange = vi.fn()
    render(<Select label="Пусто" options={[]} value={null} onChange={onChange} placeholder="Нет вариантов" />)
    const trigger = screen.getByRole('button', { name: 'Пусто' })

    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'Enter' })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('Enter выбирает выделенную опцию и закрывает список', () => {
    const onChange = vi.fn()
    render(<Select label="Язык" options={OPTIONS} value={null} onChange={onChange} placeholder="Выберите" />)
    const trigger = screen.getByRole('button', { name: 'Язык' })

    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith('tj')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('Escape закрывает список без изменения значения', () => {
    const onChange = vi.fn()
    render(<Select label="Язык" options={OPTIONS} value="ru" onChange={onChange} placeholder="Выберите" />)
    const trigger = screen.getByRole('button', { name: 'Язык' })

    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'Escape' })

    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('выбор мышью и клавиатурой дают идентичный результат', () => {
    const onChangeMouse = vi.fn()
    const onChangeKeyboard = vi.fn()

    const { unmount } = render(
      <Select label="Язык" options={OPTIONS} value={null} onChange={onChangeMouse} placeholder="Выберите" />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Язык' }))
    fireEvent.click(screen.getByRole('option', { name: 'English' }))
    unmount()

    render(<Select label="Язык" options={OPTIONS} value={null} onChange={onChangeKeyboard} placeholder="Выберите" />)
    const trigger = screen.getByRole('button', { name: 'Язык' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'Enter' })

    expect(onChangeMouse).toHaveBeenCalledWith('en')
    expect(onChangeKeyboard).toHaveBeenCalledWith('en')
  })
})

describe('Select — error-слот', () => {
  it('error-проп выставляет aria-invalid и aria-describedby', () => {
    render(
      <Select
        label="Язык"
        options={OPTIONS}
        value={null}
        onChange={() => undefined}
        placeholder="Выберите"
        error="Выберите язык"
      />,
    )
    const trigger = screen.getByRole('button', { name: 'Язык' })
    const errorParagraph = screen.getByText('Выберите язык').closest('p')

    expect(trigger).toHaveAttribute('aria-invalid', 'true')
    expect(trigger.getAttribute('aria-describedby')).toBe(errorParagraph?.id)
  })
})

describe('Select — доступность', () => {
  it('ноль critical/serious a11y-нарушений в закрытом состоянии', async () => {
    const closedResult = await renderWithA11yCheck(
      <Select label="Язык" options={OPTIONS} value={null} onChange={() => undefined} placeholder="Выберите" />,
    )
    expect(closedResult.axeResults).toHaveNoViolations()
  })
})
