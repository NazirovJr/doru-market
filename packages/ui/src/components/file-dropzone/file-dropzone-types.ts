/** Общие типы `FileDropzone`, вынесены отдельно, чтобы `file-dropzone.tsx` и
 * `file-dropzone-parts.tsx` не образовывали цикл импортов (`import-x/no-cycle`, C16). */

/** Причина клиентского отклонения файла ДО отправки на сервер (AC3) — сообщается наружу КОДОМ
 * (`onFileRejected`), текст выбирает потребитель через `tooLargeMessage`/`invalidTypeMessage`
 * (`AGENTS.md` §9: пакет не вызывает `useT()` сам). */
export type FileDropzoneRejectionReason = 'too_large' | 'invalid_type'

export interface FileQualityCheck {
  readonly label: string
  readonly passed: boolean
}
