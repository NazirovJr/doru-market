/**
 * Доменные ошибки `Dosage` (SRS-DOM-077/078, TC-DOM-012/013). Базовый класс — общий
 * для всего пакета, чтобы потребители (`apps/api/src/modules/catalog/domain/*`) могли
 * матчить через `instanceof DomainError` (см. `domain.error.ts` пакета).
 */
export class DomainError extends Error {
  public readonly code: string

  public constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = new.target.name
  }
}

export class InvalidDosageError extends DomainError {
  public constructor(message: string) {
    super('INVALID_DOSAGE', message)
  }
}

export class DosageParseError extends DomainError {
  public constructor(message: string) {
    super('DOSAGE_PARSE', message)
  }
}
