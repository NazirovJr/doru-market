import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { Button } from '../button/button.js'
import { useReducedMotion } from '../shared/a11y-runtime.js'
import { cx } from '../shared/cx.js'
import { FileDropzoneChecklist, FileDropzoneError, FileDropzonePreview, FileDropzoneProgress } from './file-dropzone-parts.js'
import type { FileDropzoneRejectionReason, FileQualityCheck } from './file-dropzone-types.js'
import './file-dropzone.css'

export type { FileDropzoneRejectionReason, FileQualityCheck } from './file-dropzone-types.js'

const BYTES_PER_KB = 1024
const KB_PER_MB = 1024
const BYTES_PER_MB = BYTES_PER_KB * KB_PER_MB
const IMAGE_MIME_PREFIX = 'image/'

export interface FileDropzoneProps {
  /** Паттерн `accept` нативного `<input type="file">` (`image/*`, `image/*,application/pdf`, ...).
   * Тот же паттерн используется клиентской пре-валидацией типа (AC3). Без ограничения, если не
   * задан. */
  readonly accept?: string
  /** Максимальный размер файла в МБ — клиентская пре-валидация ДО сети (AC3). Без ограничения,
   * если не задан. */
  readonly maxSizeMb?: number
  /** Инструктирующий текст зоны (например, «Перетащите фото рецепта сюда») — уже переведённый
   * текст потребителя. */
  readonly label: ReactNode
  /** Подпись кнопки выбора файла — единственный полностью клавиатурный вход в компонент (fallback
   * для touch-устройств без drag, «Что сделать» п.1); рендерится design-system `Button` (DTJ-404),
   * поэтому Enter/Space и тап-зона ≥48×48 (`SRS-UX-002`) уже гарантированы им. */
  readonly browseButtonLabel: ReactNode
  /** Текст ошибки при превышении `maxSizeMb` — передаётся пропом потребителем, не хардкодится
   * (например, локализованное `ux.error.file_too_large`). */
  readonly tooLargeMessage?: ReactNode
  /** Текст ошибки при несовпадении `accept`. */
  readonly invalidTypeMessage?: ReactNode
  /** Внешняя (например, серверная) ошибка — перекрывает клиентскую пре-валидацию тем же слотом. */
  readonly error?: ReactNode
  /** Файл прошёл клиентскую пре-валидацию — загрузка на сервер целиком в руках потребителя
   * (`packages/ui` — presentation-слой, без сетевых вызовов). */
  readonly onFileAccepted: (file: File) => void
  /** Файл отклонён клиентски — `onFileAccepted` НЕ вызывается для этого файла (AC3). */
  readonly onFileRejected?: (reason: FileDropzoneRejectionReason, file: File) => void
  /** Присутствие числа означает состояние `uploading` (0–100) — рисуется `ProgressBar` (DTJ-406),
   * не собственным прогресс-баром (прямое указание тикета). */
  readonly uploadProgress?: number
  readonly uploadProgressLabel?: ReactNode
  /** URL превью — если не передан явно, компонент строит собственный `URL.createObjectURL` из
   * последнего принятого файла-изображения (превью, «Что сделать» п.1). Передайте `null`, чтобы
   * подавить любое превью. */
  readonly previewUrl?: string | null
  /** Альтернативный текст превью — ОБЯЗАТЕЛЕН (не может быть пустым по умолчанию, `AGENTS.md`
   * §9), используется, только если превью реально показано. */
  readonly previewAltText: string
  /** Чек-лист качества файла (например, CUJ-5 «Хорошее освещение») — содержимое решает потребитель
   * (тикет, «Что сделать» п.1). */
  readonly qualityChecks?: readonly FileQualityCheck[]
  readonly disabled?: boolean
  readonly id?: string
  readonly className?: string
}

function matchesAccept(file: File, accept: string | undefined): boolean {
  if (accept === undefined || accept.trim() === '') {
    return true
  }
  return accept
    .split(',')
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern !== '')
    .some((pattern) => (pattern.endsWith('/*') ? file.type.startsWith(pattern.slice(0, -1)) : file.type === pattern))
}

interface UseFileDropzoneStateParams {
  readonly accept: string | undefined
  readonly maxSizeMb: number | undefined
  readonly onFileAccepted: (file: File) => void
  readonly onFileRejected: ((reason: FileDropzoneRejectionReason, file: File) => void) | undefined
}

interface UseFileDropzoneStateResult {
  readonly isDragging: boolean
  readonly rejectionReason: FileDropzoneRejectionReason | null
  readonly localPreviewUrl: string | null
  readonly setIsDragging: (value: boolean) => void
  readonly processFile: (file: File) => void
}

/** Общая логика приёма файла — используется ОДИНАКОВО drag-and-drop и `<input type="file">`
 * (тест-план: «идентичный результат обработки файла»). */
function useFileDropzoneState(params: UseFileDropzoneStateParams): UseFileDropzoneStateResult {
  const { accept, maxSizeMb, onFileAccepted, onFileRejected } = params
  const [isDragging, setIsDragging] = useState(false)
  const [rejectionReason, setRejectionReason] = useState<FileDropzoneRejectionReason | null>(null)
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null)

  useEffect(
    () => (): void => {
      if (localPreviewUrl !== null) {
        URL.revokeObjectURL(localPreviewUrl)
      }
    },
    [localPreviewUrl],
  )

  const processFile = useCallback(
    (file: File): void => {
      if (maxSizeMb !== undefined && file.size > maxSizeMb * BYTES_PER_MB) {
        setRejectionReason('too_large')
        onFileRejected?.('too_large', file)
        return
      }
      if (!matchesAccept(file, accept)) {
        setRejectionReason('invalid_type')
        onFileRejected?.('invalid_type', file)
        return
      }

      setRejectionReason(null)
      setLocalPreviewUrl((previous) => {
        if (previous !== null) {
          URL.revokeObjectURL(previous)
        }
        return file.type.startsWith(IMAGE_MIME_PREFIX) ? URL.createObjectURL(file) : null
      })
      onFileAccepted(file)
    },
    [accept, maxSizeMb, onFileAccepted, onFileRejected],
  )

  return { isDragging, rejectionReason, localPreviewUrl, setIsDragging, processFile }
}

interface ResolveErrorMessageParams {
  readonly externalError: ReactNode | undefined
  readonly rejectionReason: FileDropzoneRejectionReason | null
  readonly tooLargeMessage: ReactNode | undefined
  readonly invalidTypeMessage: ReactNode | undefined
}

function resolveErrorMessage(params: ResolveErrorMessageParams): ReactNode | undefined {
  const { externalError, rejectionReason, tooLargeMessage, invalidTypeMessage } = params
  if (externalError !== undefined) {
    return externalError
  }
  if (rejectionReason === 'too_large') {
    return tooLargeMessage
  }
  if (rejectionReason === 'invalid_type') {
    return invalidTypeMessage
  }
  return undefined
}

interface DropzoneZoneClassNameParams {
  readonly isDragging: boolean
  readonly hasError: boolean
  readonly isDisabled: boolean
  readonly isMotionEnabled: boolean
}

function getZoneClassName(params: DropzoneZoneClassNameParams): string {
  const { isDragging, hasError, isDisabled, isMotionEnabled } = params
  return cx(
    'ui-file-dropzone__zone',
    isDragging && 'ui-file-dropzone__zone--dragging',
    hasError && 'ui-file-dropzone__zone--error',
    isDisabled && 'ui-file-dropzone__zone--disabled',
    isMotionEnabled && 'ui-file-dropzone__zone--motion',
  )
}

/**
 * Загрузка файла с превью и чек-листом качества (`SRS-UX-021`, CUJ-5 фото рецепта + документы
 * онбординга аптеки). Клиентская пре-валидация (тип/размер) — ДО сети, финальная валидация всегда
 * серверная («Технический контекст» тикета). Полностью управляем клавиатурой: единственный
 * триггер выбора файла — `Button` (нативная кнопка, Enter/Space работают из коробки), drag-and-drop
 * — дополнение для указывающих устройств, не единственный путь (`SRS-UX-034`).
 */
export const FileDropzone = ({
  accept,
  maxSizeMb,
  label,
  browseButtonLabel,
  tooLargeMessage,
  invalidTypeMessage,
  error,
  onFileAccepted,
  onFileRejected,
  uploadProgress,
  uploadProgressLabel,
  previewUrl,
  previewAltText,
  qualityChecks,
  disabled = false,
  id,
  className,
}: FileDropzoneProps): ReactElement => {
  const prefersReducedMotion = useReducedMotion()
  const generatedId = useId()
  const inputId = id ?? generatedId
  const inputRef = useRef<HTMLInputElement>(null)
  const isUploading = uploadProgress !== undefined
  const isDisabled = disabled || isUploading

  const { isDragging, rejectionReason, localPreviewUrl, setIsDragging, processFile } = useFileDropzoneState({
    accept,
    maxSizeMb,
    onFileAccepted,
    onFileRejected,
  })

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      event.preventDefault()
      if (!isDisabled) {
        setIsDragging(true)
      }
    },
    [isDisabled, setIsDragging],
  )

  const handleDragLeave = useCallback((): void => {
    setIsDragging(false)
  }, [setIsDragging])

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      event.preventDefault()
      setIsDragging(false)
      if (isDisabled) {
        return
      }
      const file = event.dataTransfer.files[0]
      if (file !== undefined) {
        processFile(file)
      }
    },
    [isDisabled, processFile],
  )

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const inputElement = event.target
      const file = inputElement.files?.[0]
      inputElement.value = ''
      if (file !== undefined) {
        processFile(file)
      }
    },
    [processFile],
  )

  const openFileDialog = useCallback((): void => {
    inputRef.current?.click()
  }, [])

  const previewSrc = previewUrl !== undefined ? previewUrl : localPreviewUrl
  const displayError = resolveErrorMessage({ externalError: error, rejectionReason, tooLargeMessage, invalidTypeMessage })
  const hasError = displayError !== undefined
  const zoneClassName = getZoneClassName({
    isDragging,
    hasError,
    isDisabled,
    isMotionEnabled: !prefersReducedMotion,
  })

  return (
    <div className={cx('ui-file-dropzone', className)}>
      <div
        className={zoneClassName}
        aria-busy={isUploading || undefined}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={accept}
          className="ui-file-dropzone__input"
          onChange={handleInputChange}
          disabled={isDisabled}
          tabIndex={-1}
          aria-hidden="true"
        />
        <FileDropzonePreview src={previewSrc} alt={previewAltText} />
        <p className="ui-file-dropzone__label">{label}</p>
        <Button type="button" variant="secondary" onClick={openFileDialog} disabled={isDisabled}>
          {browseButtonLabel}
        </Button>
      </div>

      <FileDropzoneProgress value={uploadProgress} label={uploadProgressLabel} />
      <FileDropzoneError message={displayError} />
      <FileDropzoneChecklist qualityChecks={qualityChecks} />
    </div>
  )
}
