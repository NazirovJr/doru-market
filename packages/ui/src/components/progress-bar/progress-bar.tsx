/**
 * `ProgressBar` (DTJ-406, `SRS-UX-021`) — базовая генерическая полоса прогресса, `value` 0–100%.
 * Агрегирующий вариант для N-батчевого Excel-импорта — ВНЕ зоны этого тикета (пробел дизайна,
 * `32-design-reference.md`), реализуется тем эпиком, чей экран его первым потребует, как обёртка
 * НАД этим базовым компонентом, не с нуля (см. JSDoc тикета DTJ-406 п.6).
 *
 * `label`/`labelKey` — как у `Input.label` (DTJ-404): `label` — уже переведённая строка от
 * потребителя, `labelKey` — i18n-ключ, переводимый ЗДЕСЬ через переданный `t` (нужен, если задан
 * `labelKey`). `ProgressBar` НЕ входит в список компонентов DTJ-406, которым запрещён свободный
 * текст (тот список — `EmptyState`/`ErrorState`/`OfflineBanner`, см. Definition of Done тикета) —
 * дублирует гибкость `Input`, а не строгость `EmptyState`.
 */
import { type ReactElement } from 'react'
import { type TranslateFunction, type TranslationKey, type TranslationParams } from '@dorutj/i18n'

const MIN_PERCENT = 0
const MAX_PERCENT = 100
const BAR_HEIGHT_PX = 8

export interface ProgressBarProps {
  /** 0–100, обрезается до диапазона (значение вне диапазона не считается ошибкой рендера). */
  readonly value: number
  readonly label?: string
  readonly labelKey?: TranslationKey
  readonly labelParams?: TranslationParams
  /** Обязателен, если задан `labelKey`. */
  readonly t?: TranslateFunction
}

const clampPercent = (value: number): number => Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, value))

const resolveLabel = ({ label, labelKey, labelParams, t }: ProgressBarProps): string | undefined => {
  if (labelKey !== undefined && t !== undefined) {
    return t(labelKey, labelParams)
  }
  return label
}

export const ProgressBar = (props: ProgressBarProps): ReactElement => {
  const percent = clampPercent(props.value)
  const resolvedLabel = resolveLabel(props)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', fontFamily: 'var(--brand-font-family)' }}>
      {resolvedLabel !== undefined && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--brand-text)',
          }}
        >
          <span>{resolvedLabel}</span>
          <span>{`${String(Math.round(percent))}%`}</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuemin={MIN_PERCENT}
        aria-valuemax={MAX_PERCENT}
        aria-valuenow={Math.round(percent)}
        style={{
          width: '100%',
          height: `${String(BAR_HEIGHT_PX)}px`,
          borderRadius: 'var(--radius-full)',
          background: 'var(--brand-border)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${String(percent)}%`,
            height: '100%',
            borderRadius: 'var(--radius-full)',
            background: 'var(--brand-primary)',
          }}
        />
      </div>
    </div>
  )
}
