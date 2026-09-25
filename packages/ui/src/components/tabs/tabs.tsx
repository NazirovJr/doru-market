/**
 * `Tabs` (DTJ-408, `SRS-UX-002`/`SRS-UX-034`) — переключение секций (сортировка результатов
 * поиска, «Новые»/«В сборке» терминала, период аналитики). `role="tablist"`/`role="tab"` +
 * `aria-selected`, активная пилюля — заливка `--brand-primary` (тот же приём, что `Chip`).
 *
 * Клавиатурная навигация — automatic activation (WAI-ARIA Authoring Practices, простой набор
 * табов без тяжёлого содержимого на панель): `ArrowLeft`/`ArrowRight`/`Home`/`End` двигают фокус
 * И сразу переключают активный таб (roving `tabIndex` — только активная кнопка в tab-order).
 */
import { type CSSProperties, type KeyboardEvent, type ReactElement, useRef, useState } from 'react'
import { MIN_HIT_AREA_PX } from '@/a11y/assert-hit-area'
import { useReducedMotion } from '@/a11y/use-reduced-motion'
import { buildTransition } from '../internal/motion'

export interface TabItem {
  readonly id: string
  /** Текст таба — переводится потребителем (i18n), не хардкод в компоненте. */
  readonly label: string
}

export interface TabsProps {
  readonly tabs: readonly TabItem[]
  readonly activeId: string
  readonly onChange: (id: string) => void
  /** Доступное имя `tablist` (SRS-UX-034) — например «Сортировка результатов поиска». */
  readonly 'aria-label': string
}

const TAB_CONTENT_HEIGHT_PX = 32
const TAB_PADDING_X_PX = MIN_HIT_AREA_PX / 2
const TAB_PADDING_Y_PX = (MIN_HIT_AREA_PX - TAB_CONTENT_HEIGHT_PX) / 2

const TABLIST_STYLE: CSSProperties = {
  display: 'inline-flex',
  gap: 'var(--space-2)',
}

interface TabButtonProps {
  readonly tab: TabItem
  readonly selected: boolean
  readonly onClick: () => void
  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
  readonly buttonRef: (element: HTMLButtonElement | null) => void
}

const TabButton = ({ tab, selected, onClick, onKeyDown, buttonRef }: TabButtonProps): ReactElement => {
  const prefersReducedMotion = useReducedMotion()
  const [isFocused, setIsFocused] = useState(false)
  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'content-box',
    height: `${String(TAB_CONTENT_HEIGHT_PX)}px`,
    padding: `${String(TAB_PADDING_Y_PX)}px ${String(TAB_PADDING_X_PX)}px`,
    borderRadius: 'var(--radius-full)',
    fontSize: 'var(--font-size-sm)',
    fontFamily: 'var(--brand-font-family)',
    fontWeight: 'var(--font-weight-medium)',
    cursor: 'pointer',
    background: selected ? 'var(--brand-primary)' : 'var(--brand-surface)',
    color: selected ? 'var(--brand-surface)' : 'var(--brand-text)',
    border: selected ? '1px solid transparent' : '1px solid var(--brand-border)',
    // `outline` подавляется только одновременно с заменой `box-shadow` (см. `button.tsx`).
    outline: isFocused ? 'none' : undefined,
    boxShadow: isFocused ? 'var(--focus-ring)' : 'none',
    transition: buildTransition(['background', 'box-shadow'], prefersReducedMotion),
  }
  return (
    <button
      ref={buttonRef}
      type="button"
      role="tab"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onFocus={() => { setIsFocused(true) }}
      onBlur={() => { setIsFocused(false) }}
      style={style}
    >
      {tab.label}
    </button>
  )
}

export const Tabs = ({ tabs, activeId, onChange, 'aria-label': ariaLabel }: TabsProps): ReactElement => {
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const moveTo = (nextIndex: number): void => {
    const next = tabs[nextIndex]
    if (next === undefined) {
      return
    }
    onChange(next.id)
    buttonRefs.current[next.id]?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const currentIndex = tabs.findIndex((tab) => tab.id === activeId)
    if (currentIndex === -1 || tabs.length === 0) {
      return
    }
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault()
        moveTo((currentIndex + 1) % tabs.length)
        return
      case 'ArrowLeft':
        event.preventDefault()
        moveTo((currentIndex - 1 + tabs.length) % tabs.length)
        return
      case 'Home':
        event.preventDefault()
        moveTo(0)
        return
      case 'End':
        event.preventDefault()
        moveTo(tabs.length - 1)
        break
      default:
    }
  }

  return (
    <div role="tablist" aria-label={ariaLabel} style={TABLIST_STYLE}>
      {tabs.map((tab) => (
        <TabButton
          key={tab.id}
          tab={tab}
          selected={tab.id === activeId}
          onClick={() => { onChange(tab.id) }}
          onKeyDown={handleKeyDown}
          buttonRef={(element) => { buttonRefs.current[tab.id] = element }}
        />
      ))}
    </div>
  )
}
