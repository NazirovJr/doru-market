/**
 * Базовый класс доменных ошибок модуля `inventory` (EP-05, DTJ-140).
 * Локальное определение, как в `modules/catalog/domain/errors/domain-error.ts`.
 * `02-CLEAN-ARCHITECTURE-AND-CODE.md` §2.5: доменные ошибки — свои классы, не
 * `HttpException`. Маппинг на HTTP-коды — в presentation слое.
 */
export abstract class DomainError extends Error {
  public readonly code: string

  protected constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = new.target.name
  }
}
