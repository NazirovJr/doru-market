/**
 * `SearchServiceUnavailableError` (DTJ-190, EP-06, R1) — граница presentation/`DomainError`
 * (`@dorutj/contracts`) для деградации поиска (`SRS-CAT-075`, `TC-CAT-025`).
 *
 * **Почему НЕ пробрасывается `SearchTemporarilyDegradedError` (DTJ-185) как есть.** Тот класс
 * наследует ЛОКАЛЬНЫЙ `catalog/domain/errors/domain-error.ts` (`extends Error`, НЕ
 * `@dorutj/contracts`' `DomainError`) — намеренная изоляция домена `catalog` от пакета
 * контрактов (см. JSDoc `domain/errors/domain-error.ts`). Оба глобальных фильтра
 * (`DomainExceptionFilter`/`AllExceptionsFilter`, EP-01) матчат ошибки через
 * `instanceof DomainError` ИЗ `@dorutj/contracts` — локальный класс каталога НИКОГДА не
 * попадёт в эту ветку и улетел бы как generic `500 INTERNAL_ERROR`, что прямо запрещено
 * тикетом DTJ-190 («Риски», п.1: «ни одна доменная/application ошибка не должна утекать как
 * generic 500 без явного перехвата»). `CatalogSearchController` перехватывает
 * `SearchTemporarilyDegradedError` и перебрасывает этот класс — единственный (кроме
 * копирования полей в локальный `ValidationError`-подобный класс) способ получить корректный
 * `503` без правки чужих файлов (`domain-error.ts`/фильтры — вне зоны DTJ-190).
 *
 * **История.** Раньше здесь стояло предупреждение, что `DomainExceptionFilter` урезает
 * `details` до `{ requestId }` для ЛЮБОГО статуса `>= 500`, включая `503`, поэтому
 * `details.reason` до клиента не долетает. Это ограничение СНЯТО: фильтр теперь маскирует
 * ровно `500` — «мы сломались», внутренности которого показывать нельзя (SRS-API-014), —
 * а намеренные статусы вроде `503` проходят с собственным кодом и `details`. Так и должно
 * быть: код берётся из закрытого каталога `ErrorCode`, а деградация поиска — это
 * задокументированный сигнал доступности, часть контракта, а не утечка внутренностей.
 * Экран результатов (DTJ-193) обязан отличать её от прочих ошибок (SRS-CAT-075).
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-075 — прим.: раздел переиспользует
 *   нумерацию из смежных доков; см. JSDoc `SearchTemporarilyDegradedError`, DTJ-185)
 * @see tickets/ep05-search-map/DTJ-190.md (Что сделать п.3, Критерий приёмки 4)
 */
import { DomainError, ErrorCode } from '@dorutj/contracts'

/** Machine-readable причина (`details.reason`) — константа, не литерал в нескольких местах. */
export const SEARCH_TEMPORARILY_DEGRADED_REASON = 'search_temporarily_degraded'

export class SearchServiceUnavailableError extends DomainError {
  constructor(details?: Record<string, unknown>) {
    super(ErrorCode.SERVICE_UNAVAILABLE, 'Search is temporarily degraded, please retry shortly', {
      reason: SEARCH_TEMPORARILY_DEGRADED_REASON,
      ...details,
    })
  }
}
