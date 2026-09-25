/**
 * `FileDropzone` (DTJ-410, `SRS-UX-002`/`SRS-UX-021`/`SRS-UX-034`) — загрузка фото рецепта
 * (CUJ-5, R1-флаг, `docs/spec/23-module-prescriptions-ai.md`) и документов онбординга аптеки
 * (лицензия). Оба сценария требуют одинакового превью + чек-листа качества файла — единственный
 * компонент, а не две реализации (AGENTS.md §12).
 *
 * Ограничения типа/размера (`accept`/`maxSizeMb`) — ответственность ПОТРЕБИТЕЛЯ, не хардкод здесь
 * (для CUJ-5 это `image/jpeg,image/png,image/webp,image/heic` + `PRESCRIPTION_MAX_FILE_SIZE_MB`
 * (ASSUMPTION 10 МБ), `docs/spec/23-module-prescriptions-ai.md` §таблица форматов, `SRS-RX-005`;
 * для Excel-импорта остатков — `.xlsx,.csv`, см. `apps/pharmacy/.../ExcelImportDropzone.tsx`,
 * который этот компонент призван заменить — TODO(DTJ-410) в том файле). Клиентская
 * пре-валидация (`validateFile`, `./validate-file.ts`) — быстрая обратная связь ДО отправки на
 * сервер; финальная валидация ВСЕГДА серверная (риски тикета, `SRS-NFR-020`).
 *
 * `errorKey`/`errorParams` — внешняя (серверная) ошибка, i18n-ключ передаётся ПРОПОМ потребителем
 * (например `ux.error.image_illegible`), не хардкодится здесь (контракт тикета «Что сделать» п.1).
 * Имеет приоритет над внутренней клиентской ошибкой валидации — тот же контракт `error`-приоритета,
 * что `PhoneInput`/`Input` (DTJ-404/405). Состояние/обработчики — `use-file-dropzone-controller.ts`
 * (drag-and-drop и кнопка «Выбрать файл» ведут в ОДНУ функцию `handleFile`, см. JSDoc хука).
 */
import { type ReactElement, useId } from 'react'
import { type TranslateFunction, type TranslationKey, type TranslationParams } from '@dorutj/i18n'
import { useReducedMotion } from '@/a11y/use-reduced-motion'
import { Button } from '../button/button'
import { buildTransition } from '../internal/motion'
import { ProgressBar } from '../progress-bar/progress-bar'
import { type FileDropzoneQualityCheck, QualityChecklist } from './quality-checklist'
import { type FileDropzoneState, useFileDropzoneController } from './use-file-dropzone-controller'

export type { FileDropzoneState } from './use-file-dropzone-controller'
export type { FileDropzoneQualityCheck } from './quality-checklist'
export { type FileValidationResult, validateFile } from './validate-file'

const DROPZONE_MIN_HEIGHT_PX = 160
const PREVIEW_SIZE_PX = 96

export interface FileDropzoneProps {
  readonly t: TranslateFunction
  /** Шаблон MIME/расширений: `'image/*'`, `'image/jpeg,image/png'`, `'.xlsx,.csv'`. */
  readonly accept: string
  readonly maxSizeMb: number
  /** Вызывается ТОЛЬКО для файла, прошедшего клиентскую пре-валидацию. */
  readonly onUpload: (file: File) => void
  readonly qualityChecks?: readonly FileDropzoneQualityCheck[]
  /** Превью уже выбранного/загруженного изображения — URL формирует потребитель. */
  readonly previewUrl?: string
  /** 0–100 — заданный проп переводит компонент в состояние `uploading` (рендерит `ProgressBar`). */
  readonly uploadProgressPercent?: number
  /** Внешняя (серверная) ошибка — приоритет над клиентской пре-валидацией. */
  readonly errorKey?: TranslationKey
  readonly errorParams?: TranslationParams
  readonly disabled?: boolean
}

const resolvePlaceholderKey = (state: FileDropzoneState, selectedFileName: string | null): TranslationKey => {
  if (selectedFileName !== null) {
    return 'ui.file_dropzone.selected_file'
  }
  return state === 'dragging' ? 'ui.file_dropzone.placeholder_dragging' : 'ui.file_dropzone.placeholder_idle'
}

const resolveBorderColor = (state: FileDropzoneState, isDragging: boolean): string => {
  if (state === 'error') {
    return 'var(--brand-danger-border)'
  }
  return isDragging ? 'var(--brand-primary)' : 'var(--brand-border)'
}

interface FileDropzoneStatusProps {
  readonly t: TranslateFunction
  readonly state: FileDropzoneState
  readonly uploadProgressPercent: number | undefined
  readonly effectiveErrorKey: TranslationKey | undefined
  readonly effectiveErrorParams: TranslationParams | undefined
  readonly qualityChecks: readonly FileDropzoneQualityCheck[] | undefined
}

/** Блок под drag-зоной: прогресс/ошибка/чек-лист — вынесен отдельно от JSX-разметки drag-зоны. */
const FileDropzoneStatus = ({
  t,
  state,
  uploadProgressPercent,
  effectiveErrorKey,
  effectiveErrorParams,
  qualityChecks,
}: FileDropzoneStatusProps): ReactElement => (
  <>
    {state === 'uploading' ? (
      <ProgressBar value={uploadProgressPercent ?? 0} labelKey="ui.file_dropzone.uploading_label" t={t} />
    ) : null}

    {state === 'error' && effectiveErrorKey !== undefined ? (
      <p
        role="alert"
        data-testid="dorutj-file-dropzone-error"
        style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-1)', color: 'var(--brand-danger-text)', fontSize: 'var(--font-size-sm)' }}
      >
        {t(effectiveErrorKey, effectiveErrorParams)}
      </p>
    ) : null}

    {qualityChecks !== undefined && qualityChecks.length > 0 ? <QualityChecklist checks={qualityChecks} t={t} /> : null}
  </>
)

export const FileDropzone = ({
  t,
  accept,
  maxSizeMb,
  onUpload,
  qualityChecks,
  previewUrl,
  uploadProgressPercent,
  errorKey,
  errorParams,
  disabled = false,
}: FileDropzoneProps): ReactElement => {
  const generatedId = useId()
  const inputId = `dorutj-file-dropzone-input-${generatedId}`
  const prefersReducedMotion = useReducedMotion()
  const controller = useFileDropzoneController({ accept, maxSizeMb, onUpload, uploadProgressPercent, errorKey, errorParams, disabled })
  const { state, isDragging, selectedFileName, effectiveErrorKey, effectiveErrorParams } = controller

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', fontFamily: 'var(--brand-font-family)' }}>
      <div
        data-testid="dorutj-file-dropzone"
        data-state={state}
        onDragOver={controller.onDragOver}
        onDragLeave={controller.onDragLeave}
        onDrop={controller.onDrop}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--space-3)',
          minHeight: `${String(DROPZONE_MIN_HEIGHT_PX)}px`,
          boxSizing: 'border-box',
          padding: 'var(--space-4)',
          textAlign: 'center',
          borderRadius: 'var(--radius-md)',
          border: `2px dashed ${resolveBorderColor(state, isDragging)}`,
          background: isDragging ? 'var(--brand-bg)' : 'var(--brand-surface)',
          transition: buildTransition(['border-color', 'background'], prefersReducedMotion),
        }}
      >
        {previewUrl !== undefined ? (
          <img
            src={previewUrl}
            alt={t('ui.file_dropzone.preview_alt')}
            style={{ width: `${String(PREVIEW_SIZE_PX)}px`, height: `${String(PREVIEW_SIZE_PX)}px`, objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
          />
        ) : null}

        <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--brand-text-muted)' }}>
          {t(resolvePlaceholderKey(state, selectedFileName), selectedFileName !== null ? { name: selectedFileName } : undefined)}
        </p>

        <Button type="button" variant="secondary" disabled={disabled} onClick={controller.openFilePicker}>
          {t('ui.file_dropzone.select_button')}
        </Button>

        <input
          ref={controller.inputRef}
          id={inputId}
          type="file"
          accept={accept}
          disabled={disabled}
          onChange={controller.onInputChange}
          data-testid="dorutj-file-dropzone-input"
          tabIndex={-1}
          aria-hidden="true"
          style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}
        />
      </div>

      <FileDropzoneStatus
        t={t}
        state={state}
        uploadProgressPercent={uploadProgressPercent}
        effectiveErrorKey={effectiveErrorKey}
        effectiveErrorParams={effectiveErrorParams}
        qualityChecks={qualityChecks}
      />
    </div>
  )
}
