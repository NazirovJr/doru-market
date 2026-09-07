import { cx } from '../shared/cx.js'

/** Общая логика `Input`/`Textarea` — className контрола и `aria-describedby` (`SRS-UX-034`). */
export function getFieldControlClassName(
  baseClassName: string,
  hasError: boolean,
  className: string | undefined,
): string {
  return cx(baseClassName, hasError && `${baseClassName}--error`, className)
}

export function getFieldDescribedBy(errorId: string | undefined, ariaDescribedBy: string | undefined): string | undefined {
  return cx(errorId, ariaDescribedBy).trim() || undefined
}
