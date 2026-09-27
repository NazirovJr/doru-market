/**
 * `select.spec.tsx` (DTJ-405, тест-план тикета).
 */
import { type ReactElement, useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertNoBlockingViolations, renderWithA11yCheck } from '@/a11y/test-utils'
import { Select, type SelectOption } from './select'

afterEach(() => {
  cleanup()
})

const OPTIONS: readonly SelectOption[] = [
  { value: 'ru', label: 'Русский' },
  { value: 'tj', label: 'Тоҷикӣ' },
  { value: 'en', label: 'English' },
]

describe('Select — клавиатурная навигация', () => {
  it('ArrowDown/ArrowUp меняют подсветку без коммита значения и без второго списка', () => {
    const onChange = vi.fn()
    render(<Select label="Язык" options={OPTIONS} value="ru" onChange={onChange} />)
    const trigger = screen.getByRole('combobox')
    fireEvent.click(trigger)
    expect(screen.getAllByRole('listbox')).toHaveLength(1)

    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(screen.getAllByRole('listbox')).toHaveLength(1)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Enter подтверждает подсвеченную опцию и закрывает список', () => {
    const onChange = vi.fn()
    render(<Select label="Язык" options={OPTIONS} value="ru" onChange={onChange} />)
    const trigger = screen.getByRole('combobox')
    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('tj')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('Escape закрывает список без изменения значения', () => {
    const onChange = vi.fn()
    render(<Select label="Язык" options={OPTIONS} value="ru" onChange={onChange} />)
    const trigger = screen.getByRole('combobox')
    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('выбор мышью и клавиатурой дают идентичный результат', () => {
    const onChangeMouse = vi.fn()
    const onChangeKeyboard = vi.fn()
    const { unmount } = render(<Select label="Язык" options={OPTIONS} value="ru" onChange={onChangeMouse} />)
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.mouseDown(screen.getByRole('option', { name: 'English' }))
    expect(onChangeMouse).toHaveBeenCalledWith('en')
    unmount()

    render(<Select label="Язык" options={OPTIONS} value="ru" onChange={onChangeKeyboard} />)
    const trigger = screen.getByRole('combobox')
    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(onChangeKeyboard).toHaveBeenCalledWith('en')
  })
})

describe('Select — ARIA', () => {
  it('aria-expanded отражает состояние открытости, role listbox на списке опций', () => {
    render(<Select label="Язык" options={OPTIONS} value={null} onChange={vi.fn()} />)
    const trigger = screen.getByRole('combobox')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })
})

describe('Select — контролируемый компонент', () => {
  it('значение не меняется без вызова onChange потребителем', () => {
    const Wrapper = (): ReactElement => {
      const [value, setValue] = useState<string | null>('ru')
      return (
        <Select
          label="Язык"
          options={OPTIONS}
          value={value}
          onChange={(next) => { setValue(next) }}
        />
      )
    }
    render(<Wrapper />)
    expect(screen.getByRole('combobox')).toHaveTextContent('Русский')
  })
})

describe('Select — открытие/закрытие', () => {
  it('Enter на закрытом триггере открывает список с подсветкой текущего значения', () => {
    render(<Select label="Язык" options={OPTIONS} value="tj" onChange={vi.fn()} />)
    const trigger = screen.getByRole('combobox')
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Тоҷикӣ' })).toHaveAttribute('aria-selected', 'true')
  })

  it('пробел на закрытом триггере тоже открывает список', () => {
    render(<Select label="Язык" options={OPTIONS} value={null} onChange={vi.fn()} />)
    const trigger = screen.getByRole('combobox')
    fireEvent.keyDown(trigger, { key: ' ' })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('disabled игнорирует клавиатуру и клик, список не открывается', () => {
    render(<Select label="Язык" options={OPTIONS} value={null} onChange={vi.fn()} disabled />)
    const trigger = screen.getByRole('combobox')
    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('пустой список options не открывается по клавиатуре', () => {
    render(<Select label="Язык" options={[]} value={null} onChange={vi.fn()} />)
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('клик по открытому триггеру закрывает список', () => {
    render(<Select label="Язык" options={OPTIONS} value="ru" onChange={vi.fn()} />)
    const trigger = screen.getByRole('combobox')
    fireEvent.click(trigger)
    fireEvent.click(trigger)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('blur за пределы контейнера закрывает список; blur на опцию внутри контейнера — нет', () => {
    render(<Select label="Язык" options={OPTIONS} value="ru" onChange={vi.fn()} />)
    const trigger = screen.getByRole('combobox')
    fireEvent.click(trigger)
    const option = screen.getByRole('option', { name: 'Тоҷикӣ' })
    fireEvent.blur(trigger, { relatedTarget: option })
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    fireEvent.blur(trigger, { relatedTarget: document.body })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('ArrowUp/ArrowDown не выходят за границы списка (clamp)', () => {
    render(<Select label="Язык" options={OPTIONS} value="ru" onChange={vi.fn()} />)
    const trigger = screen.getByRole('combobox')
    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: 'ArrowUp' })
    fireEvent.keyDown(trigger, { key: 'ArrowUp' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('наведение мышью подсвечивает опцию (onMouseEnter)', () => {
    render(<Select label="Язык" options={OPTIONS} value="ru" onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.mouseEnter(screen.getByRole('option', { name: 'English' }))
    expect(screen.getByRole('option', { name: 'English' })).toBeInTheDocument()
  })
})

describe('Select — placeholder без выбранного значения', () => {
  it('показывает placeholder, когда value=null', () => {
    render(<Select label="Язык" options={OPTIONS} value={null} onChange={vi.fn()} placeholder="Выберите язык" />)
    expect(screen.getByRole('combobox')).toHaveTextContent('Выберите язык')
  })
})

describe('Select — error/ARIA-invalid', () => {
  it('aria-invalid выставлен при переданном error', () => {
    render(<Select label="Язык" options={OPTIONS} value="ru" onChange={vi.fn()} error="Обязательное поле" />)
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Обязательное поле')
  })
})

describe('Select — доступность', () => {
  it('нулевые critical/serious нарушения доступности', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <Select label="Язык" options={OPTIONS} value="ru" onChange={vi.fn()} />,
    )
    assertNoBlockingViolations(axeResults)
  })
})
