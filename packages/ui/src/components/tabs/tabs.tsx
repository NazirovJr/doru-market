import { useRef } from 'react'
import type { KeyboardEvent, ReactElement } from 'react'
import { useReducedMotion } from '../shared/a11y-runtime.js'
import { cx } from '../shared/cx.js'
import './tabs.css'

export interface TabItem {
  readonly id: string
  readonly label: string
  readonly disabled?: boolean
}

export interface TabsProps {
  /** Список вкладок домен-агностичен (сортировка результатов поиска, «Новые»/«В сборке»
   * терминала, период аналитики) — конкретные значения передаёт потребитель. */
  readonly items: readonly TabItem[]
  readonly value: string
  readonly onChange: (id: string) => void
  /** Доступное имя `role="tablist"` — обязателен пропом, компонент не формирует текст сам
   * (`AGENTS.md` «ноль хардкода строк»). */
  readonly 'aria-label': string
  readonly className?: string
}

const ARROW_KEYS: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End'])

function getEnabledIndices(items: readonly TabItem[]): number[] {
  return items.reduce<number[]>((indices, item, index) => {
    if (!item.disabled) {
      indices.push(index)
    }
    return indices
  }, [])
}

function resolveTargetIndex(items: readonly TabItem[], currentIndex: number, key: string): number | undefined {
  const enabledIndices = getEnabledIndices(items)
  if (enabledIndices.length === 0) {
    return undefined
  }

  if (key === 'Home') {
    return enabledIndices[0]
  }
  if (key === 'End') {
    return enabledIndices[enabledIndices.length - 1]
  }

  const currentPosition = enabledIndices.indexOf(currentIndex)
  const direction = key === 'ArrowRight' ? 1 : -1
  const nextPosition = (currentPosition + direction + enabledIndices.length) % enabledIndices.length
  return enabledIndices[nextPosition]
}

/**
 * Переключатель секций (`SRS-UX-021`): `role="tablist"`/`role="tab"` + `aria-selected`, активная
 * пилюля — заливка `--brand-primary`. Клавиатурная навигация — `ArrowLeft`/`ArrowRight` (по кругу,
 * пропуская `disabled`), `Home`/`End` — к первой/последней доступной вкладке (roving `tabIndex`:
 * только выбранная вкладка в tab-order, WAI-ARIA APG «Tabs»).
 */
export const Tabs = ({ items, value, onChange, className, ...rest }: TabsProps): ReactElement => {
  const prefersReducedMotion = useReducedMotion()
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const selectTab = (id: string): void => {
    onChange(id)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (!ARROW_KEYS.has(event.key)) {
      return
    }
    event.preventDefault()

    const targetIndex = resolveTargetIndex(items, index, event.key)
    if (targetIndex === undefined) {
      return
    }

    const targetItem = items[targetIndex]
    if (targetItem === undefined) {
      return
    }
    selectTab(targetItem.id)
    tabRefs.current[targetItem.id]?.focus()
  }

  return (
    <div role="tablist" aria-label={rest['aria-label']} className={cx('ui-tabs', className)}>
      {items.map((item, index) => {
        const isSelected = item.id === value
        return (
          <button
            key={item.id}
            ref={(element) => {
              tabRefs.current[item.id] = element
            }}
            role="tab"
            type="button"
            aria-selected={isSelected}
            aria-disabled={item.disabled === true || undefined}
            disabled={item.disabled}
            tabIndex={isSelected ? 0 : -1}
            className={cx(
              'ui-tabs__tab',
              isSelected && 'ui-tabs__tab--selected',
              !prefersReducedMotion && 'ui-tabs__tab--motion',
            )}
            onClick={() => {
              selectTab(item.id)
            }}
            onKeyDown={(event) => {
              handleKeyDown(event, index)
            }}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
