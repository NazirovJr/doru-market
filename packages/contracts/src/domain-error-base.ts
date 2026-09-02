/**
 * Базовый класс `DomainError` — вынесен из `domain-errors.ts` в отдельный файл, чтобы
 * `domain-errors.ts` и `domain-errors-security.ts` (split по max-lines, DTJ-lint-33) могли
 * оба импортировать его напрямую без цикла `domain-errors.ts` → `domain-errors-security.ts`
 * → `domain-errors.ts` (ESM circular import ломает `class ... extends DomainError` в момент
 * инициализации модуля). Публичный API пакета не меняется — переэкспортируется из
 * `domain-errors.ts`.
 */
import type { ErrorCode } from './errors.js'

export abstract class DomainError extends Error {
  protected constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = new.target.name
  }
}
