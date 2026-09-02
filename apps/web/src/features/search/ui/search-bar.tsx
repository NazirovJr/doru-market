/**
 * `search-bar.tsx` (DTJ-192, `SRS-CAT-001`/`027`/`028`/`030`).
 *
 * Точка входа в CUJ-1: поле поиска с автодополнением поверх `GET /medicines/suggest`
 * (`use-search-suggestions.ts`) и переходом к результатам (`GET /search?text=<query>`,
 * `SRS-CAT-028` — переход ВСЕГДА по имени, не по `medicine.id` конкретной записи, даже для
 * подсказки с известным `medicineId`, т.к. пользователь обязан увидеть ВСЕ варианты товара).
 * Сам экран `/search` реализован DTJ-193 (`search-results-page.tsx`), переиспользует этот
 * компонент как есть.
 *
 * ARIA: `role="combobox"` на `<input>` + `role="listbox"`/`role="option"` в `SuggestDropdown`
 * — ARIA 1.2 combobox-паттерн. `aria-activedescendant` синхронизирован с клавиатурной
 * навигацией (см. `handleKeyDown`) — без него подсказки недоступны с клавиатуры для
 * скринридеров, даже если визуально стрелки работают.
 *
 * `initialQuery` (DTJ-193) — необязательный проп, обратно совместимый с вызовом без пропов
 * (существующие места остаются `<SearchBar />`, `rawQuery` стартует с `''`, как раньше).
 * `search-results-page.tsx` передаёт сюда текущий `?text=` из URL: страница результатов
 * переиспользует ЭТОТ ЖЕ компонент как строку поиска наверху экрана — без него поле было бы
 * пустым, хотя пользователь уже что-то искал, что и нарушало бы требование тикета «переход со
 * страницы результатов обратно к поиску не должен терять введённый запрос» (запрос живёт в URL,
 * `initialQuery` — просто способ показать его в самом поле при монтировании).
 */
import { useCallback, useId, useState, type KeyboardEvent, type ReactElement } from 'react'
import { useNavigate } from 'react-router'
import { useT } from '@dorutj/i18n'
import { useLocale } from '@/shared/config/locale-provider'
import { useSearchSuggestions, type UseSearchSuggestionsResult } from '../model/use-search-suggestions'
import { addSearchHistoryEntry } from '../model/search-history'
import { SuggestDropdown, type SuggestDropdownStatus } from './suggest-dropdown'
import type { SuggestSuggestion } from '../api/search.api'

const NO_ACTIVE_OPTION = -1

function resolveDropdownStatus(result: UseSearchSuggestionsResult): SuggestDropdownStatus {
  if (result.isLoading) {
    return 'loading'
  }
  if (result.isError) {
    return 'error'
  }
  return result.suggestions.length === 0 ? 'empty' : 'ready'
}

function moveActiveIndex(current: number, itemCount: number, delta: 1 | -1): number {
  if (itemCount === 0) {
    return NO_ACTIVE_OPTION
  }
  return (current + delta + itemCount) % itemCount
}

export interface SearchBarProps {
  readonly initialQuery?: string
}

export const SearchBar = ({ initialQuery = '' }: SearchBarProps = {}): ReactElement => {
  const navigate = useNavigate()
  const { locale } = useLocale()
  const { t } = useT(locale)
  const listboxId = useId()

  const [rawQuery, setRawQuery] = useState(initialQuery)
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(NO_ACTIVE_OPTION)

  const suggestState = useSearchSuggestions(rawQuery, isOpen)
  const { suggestions, belowMinLength } = suggestState
  const showDropdown = isOpen && !belowMinLength
  const status = resolveDropdownStatus(suggestState)

  const goToResults = useCallback(
    (text: string): void => {
      const trimmed = text.trim()
      if (trimmed.length === 0) {
        return
      }
      addSearchHistoryEntry(trimmed)
      setIsOpen(false)
      setActiveIndex(NO_ACTIVE_OPTION)
      void navigate(`/search?text=${encodeURIComponent(trimmed)}`)
    },
    [navigate],
  )

  const handleSelect = useCallback(
    (item: SuggestSuggestion): void => {
      setRawQuery(item.tradeName)
      goToResults(item.tradeName)
    },
    [goToResults],
  )

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setIsOpen(true)
      setActiveIndex((current) => moveActiveIndex(current, suggestions.length, 1))
      return
    }
    if (event.key === 'ArrowUp') {
      if (!isOpen) {
        return
      }
      event.preventDefault()
      setActiveIndex((current) => moveActiveIndex(current, suggestions.length, -1))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const activeItem = isOpen ? suggestions[activeIndex] : undefined
      if (activeItem !== undefined) {
        handleSelect(activeItem)
      } else {
        goToResults(rawQuery)
      }
      return
    }
    if (event.key === 'Escape' && isOpen) {
      event.preventDefault()
      setIsOpen(false)
      setActiveIndex(NO_ACTIVE_OPTION)
    }
  }

  const activeOptionId = activeIndex === NO_ACTIVE_OPTION ? undefined : `${listboxId}-option-${String(activeIndex)}`

  return (
    <div className="relative" data-testid="search-bar">
      <input
        type="text"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
        aria-label={t('search.placeholder')}
        placeholder={t('search.placeholder')}
        value={rawQuery}
        data-testid="search-bar-input"
        className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
        onChange={(event) => {
          setRawQuery(event.target.value)
          setIsOpen(true)
          setActiveIndex(NO_ACTIVE_OPTION)
        }}
        onFocus={() => {
          setIsOpen(true)
        }}
        onBlur={() => {
          setIsOpen(false)
          setActiveIndex(NO_ACTIVE_OPTION)
        }}
        onKeyDown={handleKeyDown}
      />
      {showDropdown ? (
        <SuggestDropdown
          listboxId={listboxId}
          getOptionId={(index) => `${listboxId}-option-${String(index)}`}
          items={suggestions}
          activeIndex={activeIndex}
          status={status}
          onSelect={handleSelect}
          t={t}
        />
      ) : null}
    </div>
  )
}
