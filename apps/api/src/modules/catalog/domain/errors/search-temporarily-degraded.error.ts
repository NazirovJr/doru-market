import { DomainError } from './domain-error.js'

/**
 * `SearchTemporarilyDegradedError` (DTJ-185, `SRS-CAT-075`, `TC-CAT-025`). Брошена
 * `PostgresSearchProvider.search()`, когда PostgreSQL прерывает композитный запрос по
 * `statement_timeout` (код `57014 query_canceled`) — ожидаемая деградация под нагрузкой, не
 * программная ошибка. Presentation-слой (DTJ-190) мапит её в `503 SERVICE_UNAVAILABLE
 * details.reason='search_temporarily_degraded'`, НЕ в `500`.
 *
 * Новый файл вне `files_owned` DTJ-185 (только `postgres-search.adapter.ts`/`.sql.ts`) — создан
 * как необходимое, минимальное расширение: класс явно требуется тикетом («вернуть доменную
 * ошибку SearchTemporarilyDegradedError»), нигде ещё не существует (проверено grep, Ж12) и не
 * пересекается с чужим `files_owned` (первое использование этого имени в кодовой базе).
 */
export class SearchTemporarilyDegradedError extends DomainError {
  public constructor(message: string) {
    super('SEARCH_TEMPORARILY_DEGRADED', message)
  }
}
