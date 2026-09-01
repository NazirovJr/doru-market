/**
 * `@Public()` — маркер для endpoint'ов, НЕ требующих JWT (SRS-API-067).
 * `TenantScopeGuard` (DTJ-055) пропускает проверку `token.tenantId ===
 * resolvedTenantId` для таких маршрутов, НО шаги 2/3 (проверка технической
 * ошибки / неизвестного slug) применяются ВСЕГДА — резолвинг обязателен
 * независимо от публичности (SRS-TEN-008).
 *
 * Файл расположен в `common/decorators/` потому что это инфраструктура,
 * переиспользуемая любым модулем (не только tenancy).
 */
import { SetMetadata } from '@nestjs/common'

export const PUBLIC_METADATA_KEY = Symbol.for('@dorutj/common/public')

/** Помечает контроллер/маршрут как публичный (без JWT). */
export const Public = (): MethodDecorator & ClassDecorator => {
  return SetMetadata(PUBLIC_METADATA_KEY, true)
}
