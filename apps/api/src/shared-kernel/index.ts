/**
 * Public barrel `shared-kernel` (D-27). Другие модули импортируют порты
 * `Clock`/`IdGenerator` ТОЛЬКО через эту точку (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2).
 *
 * `GeoPoint` (DTJ-190, добавлено ADD-only, тот же барrel-приём, что `TenantId` через
 * `modules/tenancy/index.ts`): `CatalogSearchController` (`presentation/`) обязан передать
 * `SearchMedicinesCommand.geo: GeoPoint` (частично-заморожённый порт DTJ-188) как реальный
 * экземпляр класса (не структурно совместимый плоский объект — `GeoPoint` несёт методы
 * `distanceTo`/`isLikelyWithinTajikistan`, которых нет у `{latitude, longitude}`), но правило
 * `presentation-goes-through-application` (`.dependency-cruiser.cjs`) запрещает presentation
 * импортировать что-либо из пути `/domain/` НАПРЯМУЮ. Реэкспорт здесь — тот же обход, что уже
 * применён для `TenantId`/`TenantSlug` (`modules/tenancy/index.ts`): прямой edge презентации
 * идёт на этот барrel-файл (путь без `/domain/`), а не на `domain/value-objects/geo-point.vo.ts`.
 */
export { CLOCK, type Clock } from './application/ports/clock.port.js'
export { ID_GENERATOR, type IdGenerator } from './application/ports/id-generator.port.js'
export { SharedKernelModule } from './shared-kernel.module.js'
export { GeoPoint } from './domain/value-objects/geo-point.vo.js'
