/**
 * Фиксированные `Date`-фикстуры для доменных тестов inventory (EP-05).
 *
 * `domain/**` (eslint `no-restricted-globals`, `02` §2.6) не имеет права
 * ссылаться на глобальный `Date` напрямую — в том числе в спеках, которые
 * конструируют литералы для `now`/`lastSyncedAt`. Этот файл лежит ВНЕ
 * `domain/` намеренно (см. прецедент `modules/tenancy/testing/`) — он
 * единственное место в модуле, которому позволено строить `Date` из
 * ISO-строки; domain-спеки импортируют готовый `Date` отсюда вместо
 * `new Date(...)` на месте.
 */
export function fixedDate(iso: string): Date {
  return new Date(iso)
}
