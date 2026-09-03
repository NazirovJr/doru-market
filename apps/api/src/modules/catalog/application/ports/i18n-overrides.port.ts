/**
 * Порт `I18nOverridesRepository` (DTJ-102/103, EP-07, R1).
 *
 * Единственный потребитель на момент этого тикета — `AnalogsController`
 * (DTJ-102), резолвящий `catalog.analogs.disclaimer` по `Accept-Language`
 * (SRS-CAT-042: «presentation — маппинг DTO→JSON, дисклеймер подставляется
 * на этом уровне из `i18n_overrides`»). Presentation не ходит в БД напрямую
 * (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2, `dependency-cruiser`) — контроллер
 * зависит ТОЛЬКО от этого порта (объявлен в `application/`), а не от
 * `infrastructure`/Drizzle. Реализация — `DrizzleI18nOverridesRepository`
 * (`infrastructure/adapters/drizzle-i18n-overrides.repository.ts`).
 *
 * Единообразный паттерн (решение CTO D-EP07-5): чтение `i18n_overrides` идёт
 * через порт+адаптер, как всё остальное в модуле (`CatalogRepository`,
 * `AnalogCandidatesRepository`, ...), а не через прямой SQL из контроллера,
 * который «риски» DTJ-102 допускали как временное решение.
 */

/** DI-токен NestJS (D-27: единый Symbol на пакет). */
export const I18N_OVERRIDES_REPOSITORY = Symbol.for('@dorutj/catalog/i18n-overrides-repository')

/** Одна строка `i18n_overrides` — значение + статус визирования (SRS-CAT-041). */
export interface I18nOverrideEntry {
  readonly value: string
  readonly reviewStatus: string
}

/**
 * Контракт порта. `findOne` возвращает `null`, если строка для точной тройки
 * `(tenantId, locale, translationKey)` не найдена — репозиторий НЕ делает
 * фолбэков (tenant → neutral, locale → default); это ответственность
 * вызывающего (см. JSDoc `AnalogsController.resolveDisclaimer`).
 */
export interface I18nOverridesRepository {
  findOne(input: {
    readonly tenantId: string
    readonly locale: string
    readonly translationKey: string
  }): Promise<I18nOverrideEntry | null>
}
