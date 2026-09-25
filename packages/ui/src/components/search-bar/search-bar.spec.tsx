/**
 * `search-bar.spec.tsx` (DTJ-408, критерии приёмки 2/5, тест-план тикета).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNoBlockingViolations, renderWithA11yCheck } from '@/a11y/test-utils'
import { DEFAULT_SEARCH_DEBOUNCE_MS, SearchBar } from './search-bar'

afterEach(() => {
  cleanup()
})

describe('SearchBar — debounce (AC2)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('схлопывает быстрый ввод в один вызов onSearch с финальным значением', () => {
    const onSearch = vi.fn()
    render(<SearchBar onSearch={onSearch} debounceMs={200} aria-label="Поиск лекарств" />)
    const input = screen.getByRole('searchbox', { name: 'Поиск лекарств' })

    const characters = ['п', 'а', 'р', 'а', 'ц']
    let typed = ''
    for (const char of characters) {
      typed += char
      fireEvent.change(input, { target: { value: typed } })
      vi.advanceTimersByTime(50)
    }

    expect(onSearch).not.toHaveBeenCalled()

    vi.advanceTimersByTime(200)

    expect(onSearch).toHaveBeenCalledTimes(1)
    expect(onSearch).toHaveBeenCalledWith('парац')
  })

  it('дефолт debounceMs — 200мс, переопределяется пропом', () => {
    expect(DEFAULT_SEARCH_DEBOUNCE_MS).toBe(200)
    const onSearch = vi.fn()
    render(<SearchBar onSearch={onSearch} debounceMs={300} aria-label="Поиск лекарств" />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск лекарств' }), { target: { value: 'а' } })

    vi.advanceTimersByTime(200)
    expect(onSearch).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(onSearch).toHaveBeenCalledTimes(1)
  })
})

describe('SearchBar — атрибуты поля (AC5, SRS-UX-030)', () => {
  it('spellcheck="false", autocapitalize/autocorrect не агрессивные', () => {
    render(<SearchBar onSearch={vi.fn()} aria-label="Поиск лекарств" />)
    const input = screen.getByRole('searchbox', { name: 'Поиск лекарств' })
    expect(input).toHaveAttribute('spellcheck', 'false')
    expect(input).toHaveAttribute('autocapitalize', 'off')
    expect(input).toHaveAttribute('autocorrect', 'off')
  })
})

describe('SearchBar — голосовой ввод (опциональный)', () => {
  it('не рендерит иконку микрофона, если onVoiceInput не передан', () => {
    render(<SearchBar onSearch={vi.fn()} aria-label="Поиск лекарств" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('рендерит кнопку голосового ввода и вызывает onVoiceInput по клику, если проп передан', () => {
    const onVoiceInput = vi.fn()
    render(
      <SearchBar
        onSearch={vi.fn()}
        aria-label="Поиск лекарств"
        onVoiceInput={onVoiceInput}
        voiceButtonLabel="Голосовой поиск"
      />,
    )
    const voiceButton = screen.getByRole('button', { name: 'Голосовой поиск' })
    fireEvent.click(voiceButton)
    expect(onVoiceInput).toHaveBeenCalledTimes(1)
  })
})

describe('SearchBar — focus (SRS-UX-019)', () => {
  it('показывает --focus-ring через box-shadow при фокусе, не подавляя outline без замены', () => {
    render(<SearchBar onSearch={vi.fn()} aria-label="Поиск лекарств" />)
    const input = screen.getByRole('searchbox', { name: 'Поиск лекарств' })
    fireEvent.focus(input)
    expect(getComputedStyle(input).boxShadow).toContain('var(--focus-ring)')
    fireEvent.blur(input)
    expect(getComputedStyle(input).boxShadow).toBe('none')
  })
})

describe('SearchBar — доступность', () => {
  it('нулевые critical/serious нарушения', async () => {
    const { axeResults } = await renderWithA11yCheck(<SearchBar onSearch={vi.fn()} aria-label="Поиск лекарств" />)
    assertNoBlockingViolations(axeResults)
  })
})
