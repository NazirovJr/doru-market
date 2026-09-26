/**
 * `validateFile` (DTJ-410) — клиентская пре-валидация (тип + размер) `FileDropzone`. Ограничения
 * (`accept`/`maxSizeMb`) — ответственность ПОТРЕБИТЕЛЯ, не хардкод здесь (см. JSDoc
 * `file-dropzone.tsx`). Финальная валидация ВСЕГДА серверная (`SRS-NFR-020` — MIME-спуфинг не
 * ловится клиентом).
 *
 * Вынесено из `file-dropzone.tsx` в отдельный файл — переиспользуется как компонентом, так и
 * `use-file-dropzone-controller.ts` без циклического импорта между ними.
 */
import { type TranslationKey, type TranslationParams } from '@dorutj/i18n'

const KB_PER_MB = 1024
const BYTES_PER_KB = 1024
const BYTES_PER_MB = KB_PER_MB * BYTES_PER_KB

export interface FileValidationResult {
  readonly valid: boolean
  readonly errorKey?: TranslationKey
  readonly errorParams?: TranslationParams
}

/** Сопоставление `File` с шаблоном `accept` (`'image/*'`/`'image/jpeg,image/png'`/`'.xlsx,.csv'`). */
const matchesAccept = (file: File, accept: string): boolean => {
  const patterns = accept
    .split(',')
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0)
  if (patterns.length === 0) {
    return true
  }
  return patterns.some((pattern) => {
    if (pattern.startsWith('.')) {
      return file.name.toLowerCase().endsWith(pattern.toLowerCase())
    }
    if (pattern.endsWith('/*')) {
      return file.type.startsWith(pattern.slice(0, -1))
    }
    return file.type === pattern
  })
}

/**
 * Экспортирована — переиспользуема потребителем для собственной обратной связи ДО рендера
 * компонента (например disabled-состояние кнопки отправки).
 */
export const validateFile = (file: File, accept: string, maxSizeMb: number): FileValidationResult => {
  if (!matchesAccept(file, accept)) {
    return { valid: false, errorKey: 'ui.file_dropzone.error_invalid_type' }
  }
  if (file.size > maxSizeMb * BYTES_PER_MB) {
    return { valid: false, errorKey: 'ui.file_dropzone.error_too_large', errorParams: { maxSizeMb } }
  }
  return { valid: true }
}
