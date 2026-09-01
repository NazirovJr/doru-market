import { DomainError } from './domain-error.js'

/**
 * Общая ошибка нарушения доменного инварианта во входных данных чистой доменной функции —
 * значение обязано соответствовать контракту (диапазон, обязательность), но не соответствует.
 * Обычно означает дефект вышестоящего слоя (SQL-мэппинг, инфраструктура), а не пользовательскую
 * ошибку валидации — маппинг на HTTP-код (500, не 400) происходит в `presentation`.
 *
 * Введена тикетом DTJ-183 (`RankingScoreMapper`) как часть публичного контракта сервиса
 * (defense-in-depth): `textRelevance` вне `[0,1]` или `reliabilityValue = null` при забытом
 * `COALESCE` в SQL-заготовке (`20-module-catalog-search.md` §3.3, `SRS-CAT-021`). Не привязана
 * к ranking намеренно — общая доменная ошибка, пригодная для повторного использования другими
 * доменными сервисами модуля `catalog` с той же природой дефекта.
 */
export class DomainInvariantViolationError extends DomainError {
  public constructor(message: string) {
    super('DOMAIN_INVARIANT_VIOLATION', message)
  }
}
