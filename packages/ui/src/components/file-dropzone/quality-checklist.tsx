/**
 * `QualityChecklist` (DTJ-410) — внутренний под-компонент `FileDropzone`, вынесен в отдельный
 * файл, чтобы держать основной `file-dropzone.tsx` в пределах `max-lines` (C1 `AGENTS.md`) — тот
 * же приём, что `select/select-parts.tsx` (DTJ-405).
 *
 * Непройденный пункт отличим от пройденного ФОРМОЙ иконки (✓ vs ✕ — `CheckGlyph`/`CloseGlyph`),
 * не только цветом (критерий приёмки 4 тикета DTJ-410).
 */
import { type ReactElement } from 'react'
import { type TranslateFunction } from '@dorutj/i18n'
import { CloseGlyph } from '../internal/close-glyph'

const STATUS_ICON_SIZE_PX = 16
const GLYPH_STROKE_WIDTH = 1.6

export interface FileDropzoneQualityCheck {
  readonly label: string
  readonly passed: boolean
}

const CheckGlyph = (): ReactElement => (
  <svg aria-hidden="true" width={STATUS_ICON_SIZE_PX} height={STATUS_ICON_SIZE_PX} viewBox="0 0 16 16" fill="none">
    <path
      d="M2.5 8.2 6 11.7 13.5 4.2"
      stroke="var(--brand-success)"
      strokeWidth={GLYPH_STROKE_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

interface QualityChecklistItemProps {
  readonly check: FileDropzoneQualityCheck
  readonly t: TranslateFunction
}

const QualityChecklistItem = ({ check, t }: QualityChecklistItemProps): ReactElement => (
  <li style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
    <span aria-hidden="true" style={{ display: 'inline-flex', color: check.passed ? 'var(--brand-success)' : 'var(--brand-danger)' }}>
      {check.passed ? <CheckGlyph /> : <CloseGlyph sizePx={STATUS_ICON_SIZE_PX} />}
    </span>
    <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--brand-text)' }}>
      {check.label}
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {check.passed ? t('ui.file_dropzone.quality_check_passed') : t('ui.file_dropzone.quality_check_failed')}
      </span>
    </span>
  </li>
)

export interface QualityChecklistProps {
  readonly checks: readonly FileDropzoneQualityCheck[]
  readonly t: TranslateFunction
}

export const QualityChecklist = ({ checks, t }: QualityChecklistProps): ReactElement => (
  <ul
    data-testid="dorutj-file-dropzone-quality-checks"
    style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
  >
    {checks.map((check, index) => (
      // `label` может повторяться (два пункта с одинаковым текстом) — составной ключ с индексом,
      // список статичен на весь рендер потребителя (не переупорядочивается).
      <QualityChecklistItem key={`${check.label}-${String(index)}`} check={check} t={t} />
    ))}
  </ul>
)
