import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithA11yCheck } from '../shared/a11y-testing.js'
import { SearchBar } from './search-bar.js'

describe('SearchBar — debounce (AC2)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('5 символов подряд с интервалом 50мс между нажатиями → onSearch вызывается РОВНО один раз, с финальным значением', () => {
    const onSearch = vi.fn()
    render(<SearchBar label="Поиск" onSearch={onSearch} debounceMs={200} />)
    const field = screen.getByLabelText<HTMLInputElement>('Поиск')

    const query = 'парац'
    for (let index = 1; index <= query.length; index += 1) {
      fireEvent.change(field, { target: { value: query.slice(0, index) } })
      vi.advanceTimersByTime(50)
    }

    // Промежуточные вызовы ещё не случились — с последнего нажатия прошло только 50мс из 200мс.
    expect(onSearch).not.toHaveBeenCalled()

    vi.advanceTimersByTime(200)

    expect(onSearch).toHaveBeenCalledTimes(1)
    expect(onSearch).toHaveBeenCalledWith(query)
  })

  it('debounceMs конфигурируем — иное значение уважается', () => {
    const onSearch = vi.fn()
    render(<SearchBar label="Поиск" onSearch={onSearch} debounceMs={300} />)
    const field = screen.getByLabelText<HTMLInputElement>('Поиск')

    fireEvent.change(field, { target: { value: 'а' } })
    vi.advanceTimersByTime(200)
    expect(onSearch).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(onSearch).toHaveBeenCalledWith('а')
  })
})

describe('SearchBar — атрибуты поля (AC5, SRS-UX-030)', () => {
  it('spellcheck="false", autocapitalize/autocorrect="off"', () => {
    render(<SearchBar label="Поиск" onSearch={() => undefined} />)
    const field = screen.getByLabelText<HTMLInputElement>('Поиск')

    expect(field).toHaveAttribute('spellcheck', 'false')
    expect(field).toHaveAttribute('autocorrect', 'off')
    expect(field).toHaveAttribute('autocapitalize', 'off')
  })
})

describe('SearchBar — голосовой ввод опционален', () => {
  it('без onVoiceInput — иконка микрофона не рендерится', () => {
    render(<SearchBar label="Поиск" onSearch={() => undefined} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('с onVoiceInput — кнопка микрофона рендерится и вызывает колбэк по клику', () => {
    const onVoiceInput = vi.fn()
    render(
      <SearchBar label="Поиск" onSearch={() => undefined} onVoiceInput={onVoiceInput} voiceInputAriaLabel="Голосовой поиск" />,
    )
    const voiceButton = screen.getByRole('button', { name: 'Голосовой поиск' })
    fireEvent.click(voiceButton)
    expect(onVoiceInput).toHaveBeenCalledTimes(1)
  })
})

describe('SearchBar — доступность', () => {
  it('ноль critical/serious a11y-нарушений (с голосовой кнопкой и без)', async () => {
    const withoutVoice = await renderWithA11yCheck(<SearchBar label="Поиск" onSearch={() => undefined} />)
    expect(withoutVoice.axeResults).toHaveNoViolations()

    const withVoice = await renderWithA11yCheck(
      <SearchBar label="Поиск" onSearch={() => undefined} onVoiceInput={() => undefined} voiceInputAriaLabel="Голосовой поиск" />,
    )
    expect(withVoice.axeResults).toHaveNoViolations()
  })
})
