/**
 * `useFileDropzoneController` (DTJ-410) — состояние + обработчики `FileDropzone`, вынесены из
 * компонента в отдельный хук, чтобы держать сложность (`complexity`, C1-C5 `AGENTS.md`) самого
 * JSX-компонента в пределах порога. `inputRef` создаётся и владеется ЗДЕСЬ (не принимается
 * параметром) — мутация `.current` тогда не параметр функции, а собственная переменная хука
 * (`no-param-reassign` иначе запрещает присваивание свойству параметра).
 *
 * Drag-and-drop и кнопка «Выбрать файл» ведут в ОДНУ функцию `handleFile` (тест-план тикета:
 * «идентичный результат обработки файла») — гарантия идентичной обработки, а не два независимых
 * пути валидации.
 */
import { type ChangeEvent, type DragEvent, type RefObject, useRef, useState } from 'react'
import { type TranslationKey, type TranslationParams } from '@dorutj/i18n'
import { type FileValidationResult, validateFile } from './validate-file'

export type FileDropzoneState = 'idle' | 'dragging' | 'uploading' | 'error'

const resolveState = (isErrorActive: boolean, isUploading: boolean, isDragging: boolean): FileDropzoneState => {
  if (isErrorActive) {
    return 'error'
  }
  if (isUploading) {
    return 'uploading'
  }
  return isDragging ? 'dragging' : 'idle'
}

export interface UseFileDropzoneControllerArgs {
  readonly accept: string
  readonly maxSizeMb: number
  readonly onUpload: (file: File) => void
  readonly uploadProgressPercent: number | undefined
  readonly errorKey: TranslationKey | undefined
  readonly errorParams: TranslationParams | undefined
  readonly disabled: boolean
}

export interface FileDropzoneController {
  readonly state: FileDropzoneState
  readonly isDragging: boolean
  readonly selectedFileName: string | null
  readonly effectiveErrorKey: TranslationKey | undefined
  readonly effectiveErrorParams: TranslationParams | undefined
  readonly inputRef: RefObject<HTMLInputElement | null>
  readonly onDragOver: (event: DragEvent<HTMLDivElement>) => void
  readonly onDragLeave: () => void
  readonly onDrop: (event: DragEvent<HTMLDivElement>) => void
  readonly onInputChange: (event: ChangeEvent<HTMLInputElement>) => void
  readonly openFilePicker: () => void
}

export const useFileDropzoneController = ({
  accept,
  maxSizeMb,
  onUpload,
  uploadProgressPercent,
  errorKey,
  errorParams,
  disabled,
}: UseFileDropzoneControllerArgs): FileDropzoneController => {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [internalError, setInternalError] = useState<FileValidationResult | null>(null)
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null)

  const effectiveErrorKey = errorKey ?? internalError?.errorKey
  const effectiveErrorParams = errorKey !== undefined ? errorParams : internalError?.errorParams
  const state = resolveState(effectiveErrorKey !== undefined, uploadProgressPercent !== undefined, isDragging)

  const handleFile = (file: File | null): void => {
    if (file === null || disabled) {
      return
    }
    const result = validateFile(file, accept, maxSizeMb)
    if (!result.valid) {
      setInternalError(result)
      setSelectedFileName(null)
      return
    }
    setInternalError(null)
    setSelectedFileName(file.name)
    onUpload(file)
  }

  const onDragOver = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    if (!disabled) {
      setIsDragging(true)
    }
  }

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setIsDragging(false)
    handleFile(event.dataTransfer.files[0] ?? null)
  }

  const onInputChange = (event: ChangeEvent<HTMLInputElement>): void => {
    handleFile(event.target.files?.[0] ?? null)
    // Повторный выбор ТОГО ЖЕ файла тоже обязан вызывать onChange — браузер иначе не считает
    // значение изменившимся и не срабатывает второй раз подряд.
    if (inputRef.current !== null) {
      inputRef.current.value = ''
    }
  }

  return {
    state,
    isDragging,
    selectedFileName,
    effectiveErrorKey,
    effectiveErrorParams,
    inputRef,
    onDragOver,
    onDragLeave: () => { setIsDragging(false) },
    onDrop,
    onInputChange,
    openFilePicker: () => { inputRef.current?.click() },
  }
}
