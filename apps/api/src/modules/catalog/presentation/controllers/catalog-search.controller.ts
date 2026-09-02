/**
 * `CatalogSearchController` (DTJ-190, EP-06 «Умный поиск + ранжирование + автодополнение», R1)
 * — `GET /api/v1/medicines/search` (`SRS-CAT-011/018/022-026/044-048`) и
 * `GET /api/v1/medicines/suggest` (`SRS-CAT-027-030`).
 *
 * HTTP-граница модуля поиска: единственное место, где `SearchQuerySchema` (`@dorutj/contracts`,
 * DTJ-180) применяется к реальному запросу, и где `SearchTemporarilyDegradedError` (DTJ-185)
 * мапится в HTTP (`SRS-CAT-075`). Presentation зависит ТОЛЬКО от `application`
 * (`SearchMedicinesUseCase`/`SuggestMedicinesUseCase`, DTJ-188/189) — не импортирует
 * `infrastructure` напрямую (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1).
 *
 * **Почему `SearchQuerySchema` парсится ВРУЧНУЮ (`safeParse`), а не через общий
 * `ZodValidationPipe` (как `PharmaciesMapController`, DTJ-197).** Два требования DTJ-190
 * («Что сделать» п.1) НЕ выполнимы через `ZodValidationPipe`:
 *   1. `details.field='radiusMeters'`/`details.field='sort'` в теле ответа. `ZodValidationPipe`
 *      бросает `BadRequestException({ error: {...} })` — ПЛОСКИЙ объект, не экземпляр
 *      `DomainError`. Оба глобальных фильтра (`DomainExceptionFilter`/`AllExceptionsFilter`,
 *      EP-01, вне зоны этого тикета) форвардят `details` ТОЛЬКО когда брошенное исключение —
 *      САМ экземпляр `DomainError` (см. `all-exceptions.filter.spec.ts`, тест
 *      «DomainError → details пробрасываются»); `HttpException`-ветка ОБОИХ фильтров
 *      (`sendHttpException`/`TransportExceptionFilter.catch`) строит `envelope` заново из
 *      ТОЛЬКО `code`+`message`, `details` теряются безвозвратно. Проверено чтением обоих
 *      файлов — не предположение. Поэтому ниже `ValidationError` (`@dorutj/contracts`)
 *      бросается НАПРЯМУЮ (тот же приём, что `ClockPort.parse`/доменные сущности
 *      `onboarding`/`tenancy` — см. grep `throw new ValidationError(` по кодовой базе), а не
 *      оборачивается в `BadRequestException`.
 *   2. `sort=distance_asc` без `geo` → `400`. Кросс-полевое правило (`SRS-CAT-048`) НЕ
 *      выразимо внутри самой `SearchQuerySchema` (файл `packages/contracts/src/search.ts` вне
 *      `files_owned` DTJ-190 — добавлять туда `.refine()` запрещено правилом Ж7) — проверяется
 *      здесь, после успешного `safeParse`.
 *
 * **`sort` — опциональность клиента теряется в `SearchQuerySchema.default('relevance')`
 * (см. JSDoc `search.ts`, раздел «Правило дефолтов»).** Схема ВСЕГДА возвращает `sort`
 * заполненным — контроллер обязан заглянуть в СЫРОЙ query (`rawQuery.sort`), чтобы отличить
 * «клиент не передал `sort` вовсе» (тогда `SearchMedicinesCommand.sort` остаётся `undefined`,
 * и `SearchMedicinesUseCase` сам выбирает `price_asc` для browsing-режима, `SRS-CAT-023`) от
 * «клиент явно запросил `relevance`» (тогда `sort: 'relevance'` идёт как есть, даже в
 * browsing-режиме — явный выбор клиента не переопределяется).
 *
 * **Локаль.** `SearchQuerySchema` НЕ содержит поле `locale` (контракт намеренно ограничен
 * сериализуемыми примитивами географии/пагинации — см. его JSDoc) — резолвится из заголовка
 * `Accept-Language` (`12-api-conventions...md`, таблица заголовков), фолбэк `'tj'`
 * (тот же дефолт, что `MedicinesController.getById`).
 *
 * **`customerId` — ASSUMPTION.** Маршрут `@Public()`: `AuthGuard` для публичных эндпоинтов
 * НЕ пытается разобрать JWT вовсе (см. его JSDoc, шаг 1 — `isPublic` даёт `return true` до
 * чтения заголовка), поэтому `request.authClaims` здесь никогда не установлен — опциональная
 * идентификация «гость или залогиненный клиент» инфраструктурно не реализована нигде в
 * кодовой базе на момент этого тикета. `customerId` передаётся в use case как `null` всегда
 * (аналитика видит гостя, а не 500 из-за отсутствующего декоратора) — не блокирующее решение
 * этого тикета, доработка (`@Optional` JWT-парсинг) — отдельный тикет EP-01/EP-02.
 *
 * **Rate limiting (`SRS-CAT-057`, «Что сделать» п.6) — НЕ подключён.** Общий анонимный лимит
 * `RATE_LIMIT_ANON_PER_MIN` не существует НИГДЕ в кодовой базе на момент этого тикета (grep
 * `RATE_LIMIT_ANON` — ноль совпадений вне спек/доков): ни guard'а, ни decorator'а, ни ENV не
 * заведено ни одним модулем (EP-01 baseline). DTJ-190 сам предупреждает («Риски»): «если EP-04
 * ещё не подключил decorator... синхронизировать подход, не изобретать второй паттерн» —
 * изобретать инфраструктуру rate-limiting'а с нуля внутри тикета `catalog/presentation`
 * противоречило бы этому прямому указанию и вышло бы за зону DTJ-190. Подключение —
 * TODO следующего тикета EP-01, как только общий guard появится.
 *
 * **`GeoPoint`/`SearchTemporarilyDegradedError` — обход `presentation-goes-through-application`
 * (`.dependency-cruiser.cjs`).** Оба нужны здесь по прямому требованию тикета (гео для
 * `SearchMedicinesCommand.geo: GeoPoint`, детект деградации для `SRS-CAT-075`), но прямой
 * импорт из `/domain/` запрещён гейтом — см. развёрнутое обоснование каждого случая в JSDoc
 * `shared-kernel/index.ts` (`GeoPoint` — реэкспорт барrel'ом, тот же приём, что `TenantId`) и
 * у функции `isSearchTemporarilyDegradedError` ниже (детект по коду ошибки — `catalog/index.ts`
 * не имеет права реэкспортировать доменные ошибки, `SRS-CAT-064`, закрытый список).
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-011, 018, 022-030, 044-048, 057, 077)
 * @see tickets/ep05-search-map/DTJ-190.md
 */
import { Controller, Get, Headers, Inject, InternalServerErrorException, Query } from '@nestjs/common'
import {
  ErrorCode,
  ok,
  SearchQuerySchema,
  ValidationError,
  type SearchQueryDto,
  type SearchResultItemDto,
  type SuccessEnvelope,
} from '@dorutj/contracts'
import { Public } from '@/common/decorators/public.decorator.js'
import { TenantContext } from '@/common/context/tenant-context.js'
import { TenantId } from '@/modules/tenancy/index.js'
import { GeoPoint } from '@/shared-kernel/index.js'
import { SearchMedicinesUseCase } from '@/modules/catalog/application/use-cases/search-medicines.use-case.js'
import { SuggestMedicinesUseCase } from '@/modules/catalog/application/use-cases/suggest-medicines.use-case.js'
import type { SearchFilters, SearchQuery } from '@/modules/catalog/application/search/ports/search-provider.port.js'
import { toSearchResultPageItems, toSuggestResponseDto, type SuggestResponseItemDto } from '../mappers/search-result.mapper.js'
import { SearchServiceUnavailableError } from '../errors/search-service-unavailable.error.js'
import { MedicineSuggestQuerySchema, type MedicineSuggestQueryDto } from '../dto/medicine-suggest-query.dto.js'

/** `SRS-CAT-008`/`MedicinesController.getById` — тот же дефолт локали для всего каталога. */
const SUPPORTED_LOCALE_VALUES = ['tj', 'ru', 'en'] as const
type SupportedLocale = (typeof SUPPORTED_LOCALE_VALUES)[number]
const DEFAULT_LOCALE: SupportedLocale = 'tj'

@Controller({ path: 'medicines', version: '1' })
@Public()
export class CatalogSearchController {
  // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` — см. DTJ-001, тот же приём,
  // что `PharmaciesMapController`.
  constructor(
    @Inject(SearchMedicinesUseCase) private readonly searchMedicines: SearchMedicinesUseCase,
    @Inject(SuggestMedicinesUseCase) private readonly suggestMedicines: SuggestMedicinesUseCase,
  ) {}

  @Get('search')
  async search(
    @Query() rawQuery: Record<string, unknown>,
    @Headers('accept-language') acceptLanguage: string | undefined,
  ): Promise<SuccessEnvelope<readonly SearchResultItemDto[]>> {
    const query = parseSearchQuery(rawQuery)
    const tenantId = resolveTenantId()
    const geo = buildGeo(query.lat, query.lon)
    // Клиент не указал `sort` вовсе (не путать с явным `sort=relevance`, см. JSDoc файла).
    const explicitSort = rawQuery.sort === undefined ? undefined : query.sort

    try {
      const resultPage = await this.searchMedicines.execute({
        tenantId,
        text: query.text,
        locale: resolveLocale(acceptLanguage),
        filters: toPortSearchFilters(query.filters),
        limit: query.limit,
        customerId: null,
        ...(geo === null ? {} : { geo }),
        ...(query.radiusMeters === undefined ? {} : { radiusMeters: query.radiusMeters }),
        ...(explicitSort === undefined ? {} : { sort: explicitSort satisfies SearchQuery['sort'] }),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      })
      return ok(toSearchResultPageItems(resultPage), {
        pagination: { nextCursor: resultPage.nextCursor, hasMore: resultPage.hasMore, limit: query.limit },
      })
    } catch (error) {
      if (isSearchTemporarilyDegradedError(error)) {
        throw new SearchServiceUnavailableError()
      }
      throw error
    }
  }

  @Get('suggest')
  async suggest(@Query() rawQuery: Record<string, unknown>): Promise<SuccessEnvelope<readonly SuggestResponseItemDto[]>> {
    const query = parseSuggestQuery(rawQuery)
    const tenantId = resolveTenantId()
    const items = await this.suggestMedicines.execute({
      prefix: query.q,
      tenantId,
      limit: query.limit,
    })
    return ok(toSuggestResponseDto(items))
  }
}

/**
 * `SearchQuerySchema.safeParse` + перевод ПЕРВОЙ ошибки в `ValidationError` брошенный НАПРЯМУЮ
 * (не `BadRequestException` — см. JSDoc файла). `radiusMeters` — отдельная ветка ПЕРВОЙ
 * (`SRS-CAT-044`, буквальный `details.field` из критерия приёмки DTJ-190 №1), остальные поля —
 * generic ветка с `field` из пути первого issue (напр. `limit`, `text`, `filters.categoryId`).
 */
function parseSearchQuery(rawQuery: Record<string, unknown>): SearchQueryDto {
  const parsed = SearchQuerySchema.safeParse(rawQuery)
  if (parsed.success) {
    assertSortRequiresGeo(parsed.data)
    return parsed.data
  }
  const radiusIssue = parsed.error.issues.find((issue) => issue.path[0] === 'radiusMeters')
  if (radiusIssue !== undefined) {
    throw new ValidationError(radiusIssue.message, { field: 'radiusMeters', value: rawQuery.radiusMeters })
  }
  const firstIssue = parsed.error.issues[0]
  throw new ValidationError(firstIssue?.message ?? 'Invalid query parameters', {
    field: firstIssue === undefined ? 'unknown' : firstIssue.path.join('.'),
    issues: parsed.error.issues,
  })
}

/** `SRS-CAT-048`: `sort=distance_asc` требует `geo` — кросс-полевая проверка вне схемы (см. JSDoc файла). */
function assertSortRequiresGeo(query: SearchQueryDto): void {
  if (query.sort === 'distance_asc' && (query.lat === undefined || query.lon === undefined)) {
    throw new ValidationError('distance_asc requires geo', { field: 'sort', value: query.sort })
  }
}

function parseSuggestQuery(rawQuery: Record<string, unknown>): MedicineSuggestQueryDto {
  const parsed = MedicineSuggestQuerySchema.safeParse(rawQuery)
  if (parsed.success) {
    return parsed.data
  }
  const firstIssue = parsed.error.issues[0]
  throw new ValidationError(firstIssue?.message ?? 'Invalid query parameters', {
    field: firstIssue === undefined ? 'unknown' : firstIssue.path.join('.'),
    issues: parsed.error.issues,
  })
}

/**
 * `SearchFiltersDto` (contract, zod-инференс `field?: T | undefined`) → `SearchFilters` (порт,
 * `field?: T` под `exactOptionalPropertyTypes`) — ключи-«не заданы» обязаны ОТСУТСТВОВАТЬ, а не
 * нести `undefined` явно (та же дедупликация, что `SearchMedicinesUseCase.buildSearchQuery`:
 * `...(x === undefined ? {} : { x })`).
 */
function toPortSearchFilters(filters: SearchQueryDto['filters']): SearchFilters {
  return {
    inStockOnly: filters.inStockOnly,
    openNowOnly: filters.openNowOnly,
    is24x7Only: filters.is24x7Only,
    ...(filters.categoryId === undefined ? {} : { categoryId: filters.categoryId }),
    ...(filters.priceMinDiram === undefined ? {} : { priceMinDiram: filters.priceMinDiram }),
    ...(filters.priceMaxDiram === undefined ? {} : { priceMaxDiram: filters.priceMaxDiram }),
    ...(filters.manufacturerName === undefined ? {} : { manufacturerName: filters.manufacturerName }),
    ...(filters.isPrescriptionRequired === undefined ? {} : { isPrescriptionRequired: filters.isPrescriptionRequired }),
  }
}

/**
 * `SEARCH_TEMPORARILY_DEGRADED` — код `SearchTemporarilyDegradedError` (DTJ-185,
 * `catalog/domain/errors/search-temporarily-degraded.error.ts`). Обнаружение по КОДУ, а не
 * `instanceof`: правило `.dependency-cruiser.cjs` `presentation-goes-through-application`
 * запрещает presentation импортировать что-либо из пути `/domain/` НАПРЯМУЮ (проверено —
 * прямой импорт этого класса даёт реальное нарушение depcruise, не гипотетическое), а
 * `catalog/index.ts` НЕ имеет права реэкспортировать доменные ошибки (`SRS-CAT-064`,
 * закрытый список того, что барrel может экспортировать — `CatalogFacade` + перечисленные
 * типы, ошибок в списке нет). Код ошибки — публичный, стабильный идентификатор именно для
 * такого пересечения границы (тот же принцип, что `ERROR_HTTP_STATUS[code]` в
 * `DomainExceptionFilter`) — использование строки вместо класса здесь НЕ хак, а единственный
 * путь, не требующий правки чужого закрытого списка экспортов ИЛИ ослабления архитектурного
 * гейта (оба — вне зоны DTJ-190).
 */
const SEARCH_TEMPORARILY_DEGRADED_CODE = 'SEARCH_TEMPORARILY_DEGRADED'

function isSearchTemporarilyDegradedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { readonly code: unknown }).code === SEARCH_TEMPORARILY_DEGRADED_CODE
  )
}

/**
 * `lat`/`lon` оба заданы → `GeoPoint`; ЛЮБОЙ отсутствует (в т.ч. один из двух — асимметричный
 * ввод, не описанный SRS явно) → `null`, тот же дух, что `SRS-CAT-044` («радиус без гео —
 * не ошибка, тихо игнорируется»), ASSUMPTION по аналогии для незеркальной пары координат.
 * Диапазон `[-90,90]`/`[-180,180]` уже проверен `SearchQuerySchema` — `GeoPoint.create` здесь
 * технически не может провалиться, `geoPointOrThrow`-стиль (`GetPharmacyMapPinsUseCase`)
 * сохранён как defense-in-depth, а не потому что ожидается реальный сбой.
 */
function buildGeo(lat: number | undefined, lon: number | undefined): GeoPoint | null {
  if (lat === undefined || lon === undefined) {
    return null
  }
  const result = GeoPoint.create(lat, lon)
  if (!result.ok) {
    throw result.error
  }
  return result.value
}

/**
 * `Accept-Language` → локаль каталога (`tj`/`ru`/`en`). `SearchQuerySchema` не несёт `locale`
 * (см. JSDoc файла) — заголовок берётся напрямую, первый распознанный тег до `-`/`;` (напр.
 * `ru-RU` → `ru`), фолбэк `DEFAULT_LOCALE` при отсутствии/нераспознанном значении (тот же
 * fail-open стиль, что `MedicinesController.parseLocale` — карточка/поиск обязаны отдаваться
 * даже при кривом заголовке, не `400`).
 */
function resolveLocale(acceptLanguage: string | undefined): SupportedLocale {
  if (acceptLanguage === undefined || acceptLanguage.length === 0) {
    return DEFAULT_LOCALE
  }
  const primaryTag = (acceptLanguage.split(',')[0] ?? '').split(';')[0]?.split('-')[0]?.trim().toLowerCase()
  if (primaryTag !== undefined && (SUPPORTED_LOCALE_VALUES as readonly string[]).includes(primaryTag)) {
    return primaryTag as SupportedLocale
  }
  return DEFAULT_LOCALE
}

/**
 * Резолв `TenantId` из `TenantContext` — тот же приём, что `PharmaciesMapController` (DTJ-197):
 * `TenantResolutionMiddleware`/`TenantScopeGuard` (глобальные) гарантируют резолвленный тенант
 * до presentation даже для `@Public()`-маршрутов; недостижимая ветка страхует только от
 * рассинхронизации контракта, без фолбэка на `'neutral'`.
 */
function resolveTenantId(): TenantId {
  const store = TenantContext.get()
  if (store?.tenantId === undefined || store.tenantId === null) {
    throw new InternalServerErrorException({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'tenant context not resolved (TenantScopeGuard should have rejected earlier)',
    })
  }
  return TenantId.from(store.tenantId)
}
