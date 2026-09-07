import type { ReactElement, ReactNode } from 'react'
import { ProgressBar } from '../progress-bar/progress-bar.js'
import { cx } from '../shared/cx.js'
import type { FileQualityCheck } from './file-dropzone-types.js'

/** Внутренние под-элементы `FileDropzone`, вынесены в отдельный файл ради `max-lines`
 * (`eslint.config.mjs` C1: 300 строк на файл) — не публичный API компонента, не экспортируются
 * из `packages/ui/src/index.ts`. */

const ICON_SIZE_PX = 16

export const CheckIcon = (): ReactElement => (
  <svg width={ICON_SIZE_PX} height={ICON_SIZE_PX} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 8.5 6.5 12 13 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const CrossIcon = (): ReactElement => (
  <svg width={ICON_SIZE_PX} height={ICON_SIZE_PX} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 4 12 12M12 4 4 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
)

export const ErrorIcon = (): ReactElement => (
  <svg width={ICON_SIZE_PX} height={ICON_SIZE_PX} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 1.5 15 14H1L8 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M8 6.5v3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <circle cx="8" cy="12" r="0.9" fill="currentColor" />
  </svg>
)

interface FileDropzoneErrorProps {
  readonly message: ReactNode | undefined
}

/** Возвращает `null` сама, когда ошибки нет — вызывающий код обходится без своего `?:` (C5). */
export const FileDropzoneError = ({ message }: FileDropzoneErrorProps): ReactElement | null => {
  if (message === undefined) {
    return null
  }
  return (
    <p role="alert" className="ui-file-dropzone__error">
      <ErrorIcon />
      <span>{message}</span>
    </p>
  )
}

interface FileDropzoneChecklistProps {
  readonly qualityChecks: readonly FileQualityCheck[] | undefined
}

export const FileDropzoneChecklist = ({ qualityChecks }: FileDropzoneChecklistProps): ReactElement | null => {
  if (qualityChecks === undefined || qualityChecks.length === 0) {
    return null
  }
  return (
    <ul className="ui-file-dropzone__checklist">
      {qualityChecks.map((check) => (
        <li
          key={check.label}
          className={cx(
            'ui-file-dropzone__check',
            check.passed ? 'ui-file-dropzone__check--passed' : 'ui-file-dropzone__check--failed',
          )}
        >
          {check.passed ? <CheckIcon /> : <CrossIcon />}
          <span>{check.label}</span>
        </li>
      ))}
    </ul>
  )
}

interface FileDropzoneProgressProps {
  readonly value: number | undefined
  readonly label: ReactNode
}

export const FileDropzoneProgress = ({ value, label }: FileDropzoneProgressProps): ReactElement | null => {
  if (value === undefined) {
    return null
  }
  return <ProgressBar value={value} label={label} className="ui-file-dropzone__progress" />
}

interface FileDropzonePreviewProps {
  readonly src: string | null
  readonly alt: string
}

export const FileDropzonePreview = ({ src, alt }: FileDropzonePreviewProps): ReactElement | null => {
  if (src === null) {
    return null
  }
  return <img src={src} alt={alt} className="ui-file-dropzone__preview" />
}
