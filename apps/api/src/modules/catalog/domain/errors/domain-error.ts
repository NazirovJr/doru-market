/**
 * Базовый класс доменных ошибок модуля `catalog` (EP-04). Локальное определение,
 * чтобы `domain/` не зависел от `packages/contracts`/`packages/domain-kernel` (миграция
 * на единый источник — TODO, если EP-01 заведёт `DomainError` в `packages/contracts`).
 *
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
