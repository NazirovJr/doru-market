import { useCallback, useState, type ReactElement } from 'react'
import type { TranslateFunction } from '@dorutj/i18n'
import { FileDropzone, type FileDropzoneRejectionReason } from '@dorutj/ui'
import { HttpError } from '@/shared/api/http-client'
import { uploadOnboardingDocument } from '../api/onboarding-application.api'

/**
 * `file-upload-field.tsx` (DTJ-076/431, «Что сделать» §4, AC3) — тонкая сетевая обёртка над
 * `FileDropzone` (`@dorutj/ui`, DTJ-410). Известное расхождение API, зафиксированное постановкой
 * DTJ-431: `FileDropzone` — чистое отображение (клиентская пре-валидация `accept`/`maxSizeMb` ДО
 * вызова `onFileAccepted`, без единого сетевого вызова и без `useT()`, тексты приходят пропами) —
 * сеть (`POST /api/v1/onboarding-documents`, `uploadOnboardingDocument`) и перевод кодов отказа
 * (`too_large`/`invalid_type` → `onboarding.upload.error_*`) остаются здесь, на границе фичи.
 *
 * AC3/AC5 (файл >10 МБ — ошибка ДО сети) сохраняется: `FileDropzone` сам отклоняет файл клиентски
 * (`accept`/`maxSizeMb`, `use-file-dropzone-state` внутри) и вызывает `onFileRejected` синхронно —
 * `uploadOnboardingDocument` для отклонённого файла не вызывается в принципе (см. тест-план).
 *
 * Прогресс: `uploadOnboardingDocument` работает через `fetch`/JSON (не `XMLHttpRequest`) — нет
 * byte-level событий `progress`. Пока загрузка идёт — фиксированный индикатор (`ProgressBar`
 * внутри `FileDropzone` требует ЧИСЛО, не булев "idle/uploading"), а не имитация процента,
 * которого на самом деле нет.
 */

const MAX_SIZE_MB = 10
const ACCEPT = 'image/*,application/pdf'
/** `ProgressBar` (`@dorutj/ui`) принимает 0..100 — конкретное число здесь НЕ означает реальный
 * прогресс байт (см. JSDoc файла), только «идёт загрузка» (единственное состояние без реального
 * прогресса, которое умеет отобразить общий компонент). */
const UPLOADING_INDICATOR_PERCENT = 50

export interface FileUploadFieldProps {
  readonly label: string
  readonly required?: boolean
  readonly value: string | null
  readonly onUploaded: (url: string | null) => void
  readonly t: TranslateFunction
  readonly testId: string
}

/** `data:<mime>;base64,<payload>` → только `<payload>` (тело запроса `OnboardingDocumentUploadRequestSchema`). */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => {
      reject(new Error('file read error'))
    }
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('unexpected FileReader result'))
        return
      }
      const commaIndex = result.indexOf(',')
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result)
    }
    reader.readAsDataURL(file)
  })
}

function resolveRejectionMessage(reason: FileDropzoneRejectionReason, t: TranslateFunction): string {
  return reason === 'too_large' ? t('onboarding.upload.error_too_large') : t('onboarding.upload.error_invalid_type')
}

export const FileUploadField = ({ label, required = false, value, onUploaded, t, testId }: FileUploadFieldProps): ReactElement => {
  const [isUploading, setIsUploading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(value)

  const handleFileAccepted = useCallback(
    (file: File): void => {
      setErrorMessage(null)
      setIsUploading(true)
      void (async (): Promise<void> => {
        try {
          const base64 = await readFileAsBase64(file)
          const result = await uploadOnboardingDocument({ base64, mimeType: file.type, fileName: file.name })
          setIsUploading(false)
          setPreviewUrl(result.url)
          onUploaded(result.url)
        } catch (err: unknown) {
          setIsUploading(false)
          setErrorMessage(err instanceof HttpError ? t('onboarding.upload.error_upload_failed') : t('ux.error.network_offline'))
          onUploaded(null)
        }
      })()
    },
    [onUploaded, t],
  )

  const handleFileRejected = useCallback(
    (reason: FileDropzoneRejectionReason): void => {
      setErrorMessage(resolveRejectionMessage(reason, t))
      onUploaded(null)
    },
    [onUploaded, t],
  )

  return (
    <FileDropzone
      id={testId}
      accept={ACCEPT}
      maxSizeMb={MAX_SIZE_MB}
      label={`${label}${required ? ' *' : ''}`}
      browseButtonLabel={t('onboarding.upload.browse_button')}
      {...(errorMessage !== null ? { error: errorMessage } : {})}
      onFileAccepted={handleFileAccepted}
      onFileRejected={handleFileRejected}
      {...(isUploading
        ? { uploadProgress: UPLOADING_INDICATOR_PERCENT, uploadProgressLabel: t('onboarding.upload.uploading') }
        : {})}
      previewUrl={previewUrl}
      previewAltText={label}
    />
  )
}
