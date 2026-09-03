/**
 * `AnalogsController` (DTJ-102, EP-07 «Analog Engine», R1) —
 * `GET /api/v1/medicines/:id/analogs` (SRS-API-008/014/015, SRS-CAT-039/040/042).
 *
 * Единственный HTTP-маршрут блока аналогов — до этого тикета вся доменная часть
 * (`AnalogEquivalenceService` DTJ-099, `AnalogCandidatesAdapter` DTJ-100,
 * `FindAnalogsUseCase` DTJ-101) существовала, но была недостижима снаружи
 * (правило 2 AGENTS.md: написанный, но неподключённый код).
 *
 * Presentation зависит ТОЛЬКО от application-слоя (`FindAnalogsUseCase`,
 * `CatalogRepository`, `I18nOverridesRepository` — все три объявлены в
 * `application/ports`/`application/use-cases`, ни один импорт из `domain/`/
 * `infrastructure/` напрямую, `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.1/§3.2).
 *
 * **`@Public()`.** Тот же уровень доступа, что карточка товара (`MedicinesController`) —
 * блок аналогов виден анонимному гостю (DTJ-102 «Что сделать» п.1).
 *
 * **Обогащение `manufacturerName`/`isPrescriptionRequired`.** `FindAnalogsUseCase`
 * (DTJ-101, вне `files_owned` этого тикета) не возвращает эти два поля в
 * `FindAnalogsItem` — см. подробное обоснование и `foundIssues` в JSDoc
 * `../dto/analog-result.dto.ts`. Контроллер подгружает их отдельным батч-вызовом
 * `CatalogRepository.findMedicinesByIds` СРАЗУ после `FindAnalogsUseCase.execute()`.
 *
 * **404 mapping.** `FindAnalogsUseCase` бросает ЛОКАЛЬНЫЙ (module-private,
 * `modules/catalog/domain/errors/medicine-not-found.error.ts`) `MedicineNotFoundError`
 * с кодом `'MEDICINE_NOT_FOUND'`, которого НЕТ в `ERROR_HTTP_STATUS`
 * (`@dorutj/contracts`) — без перехвата `AllExceptionsFilter`/`DomainExceptionFilter`
 * замапили бы это в `500`, не в `404` (тот же самый, уже задокументированный
 * дефект см. JSDoc `GetMedicineDetailUseCase`, DTJ-095, который обходит его
 * ТЕМ ЖЕ приёмом на уровне use case). Импортировать класс ошибки напрямую из
 * `domain/` presentation не имеет права (`dependency-cruiser`
 * `presentation-goes-through-application`, тот же обход, что
 * `isSearchTemporarilyDegradedError` в `catalog-search.controller.ts`) — детект
 * по `error.code === 'MEDICINE_NOT_FOUND'`, рестроук как `NotFoundError`
 * (`@dorutj/contracts`, `ErrorCode.NOT_FOUND` уже зарегистрирован → `404`).
 *
 * **Дисклеймер — обязателен при КАЖДОМ рендере (решение CTO D-EP07-2,
 * SRS-CAT-039/042).** Резолвится через `I18nOverridesRepository` (DTJ-103) по
 * ключу `catalog.analogs.disclaimer`: тенант запроса → нейтральный тенант той же
 * локали → нейтральный тенант дефолтной локали (`tj`). Если ни одна из трёх
 * попыток не находит строку — `InternalServerErrorException` (громкий отказ,
 * НЕ хардкод-фолбэк текста, правило 9 AGENTS.md): это означает, что `pnpm
 * db:seed` (DTJ-103) не запускался на этом окружении — конфигурационный дефект,
 * а не штатный путь, тот же приём, что `resolveTenantId()` ниже.
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-039/040/042)
 * @see tickets/ep03-catalog-analogs/DTJ-102.md
 */
import {
  Controller,
  Get,
  Headers,
  Inject,
  InternalServerErrorException,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common'
import { ErrorCode, NotFoundError, ok, SEARCH_DEFAULT_RADIUS_METERS, type SuccessEnvelope } from '@dorutj/contracts'
import { Public } from '@/common/decorators/public.decorator.js'
import { TenantContext } from '@/common/context/tenant-context.js'
import { TenantId } from '@/modules/tenancy/index.js'
import { FindAnalogsUseCase, type FindAnalogsResult } from '@/modules/catalog/application/use-cases/find-analogs.use-case.js'
import { CATALOG_REPOSITORY, type CatalogRepository } from '@/modules/catalog/application/ports/catalog-repository.port.js'
import {
  I18N_OVERRIDES_REPOSITORY,
  type I18nOverridesRepository,
} from '@/modules/catalog/application/ports/i18n-overrides.port.js'
import { toAnalogsDataDto, type AnalogsDataDto, type MedicineRecordDto } from '../dto/analog-result.dto.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

/** Тот же дефолт/набор локалей, что `CatalogSearchController` (DTJ-190) — дисклеймер существует на 3 языках. */
const SUPPORTED_LOCALE_VALUES = ['tj', 'ru', 'en'] as const
type SupportedLocale = (typeof SUPPORTED_LOCALE_VALUES)[number]
const DEFAULT_LOCALE: SupportedLocale = 'tj'

/**
 * Нейтральный тенант — ЗАФИКСИРОВАННЫЙ UUID (заведён `0021_seed_neutral_tenant.sql`,
 * содержимое `catalog.analogs.*` засеяно под ним, `i18n-overrides-catalog.seed.ts`,
 * DTJ-103). Дублируется тут тем же приёмом, что уже применён в
 * `0021_seed_neutral_tenant.sql`/`i18n-overrides-catalog.seed.ts` («id обязан
 * совпадать во всех источниках») — ни один из этих файлов не экспортирует константу.
 */
const NEUTRAL_TENANT_ID = '00000000-0000-4000-8000-000000000001'

const DISCLAIMER_I18N_KEY = 'catalog.analogs.disclaimer'
const MEDICINE_NOT_FOUND_CODE = 'MEDICINE_NOT_FOUND'

@Controller({ path: 'medicines', version: '1' })
@Public()
export class AnalogsController {
  // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` — см. DTJ-001,
  // тот же приём, что и остальные контроллеры `catalog` (кроме документированного
  // дефекта `MedicinesController`, см. `catalog-read-endpoints.integration.spec.ts`).
  constructor(
    @Inject(FindAnalogsUseCase) private readonly findAnalogs: FindAnalogsUseCase,
    @Inject(CATALOG_REPOSITORY) private readonly catalogRepository: CatalogRepository,
    @Inject(I18N_OVERRIDES_REPOSITORY) private readonly i18nOverrides: I18nOverridesRepository,
  ) {}

  @Get(':id/analogs')
  async getAnalogs(
    @Param('id', ID_PARSE_UUID) id: string,
    @Query() rawQuery: Record<string, unknown>,
    @Headers('accept-language') acceptLanguage: string | undefined,
  ): Promise<SuccessEnvelope<AnalogsDataDto>> {
    const locale = resolveLocale(acceptLanguage)
    const tenantId = resolveTenantId()
    const geo = buildGeo(rawQuery)
    const radiusMeters = parseRadiusMeters(rawQuery.radiusMeters)

    const result = await this.executeFindAnalogs(id, geo, radiusMeters)
    const medicineRecordsById = await this.loadMedicineRecords(result.items)
    const disclaimer = await this.resolveDisclaimer(tenantId.value, locale)

    return ok(toAnalogsDataDto(result, medicineRecordsById, disclaimer))
  }

  /** Шаг 6 DTJ-102: `medicineId` не найден/не виден → `404`, паттерн — см. JSDoc файла. */
  private async executeFindAnalogs(
    medicineId: string,
    geo: { readonly lat: number; readonly lon: number } | undefined,
    radiusMeters: number,
  ): Promise<FindAnalogsResult> {
    const input = geo === undefined ? { medicineId, radiusMeters } : { medicineId, radiusMeters, geo }
    try {
      return await this.findAnalogs.execute(input)
    } catch (error) {
      if (isMedicineNotFoundError(error)) {
        throw new NotFoundError({ medicineId })
      }
      throw error
    }
  }

  /** Обогащение `manufacturerName`/`isPrescriptionRequired` — см. JSDoc файла. */
  private async loadMedicineRecords(
    items: FindAnalogsResult['items'],
  ): Promise<ReadonlyMap<string, MedicineRecordDto>> {
    if (items.length === 0) return new Map()
    const ids = items.map((item) => item.medicineId)
    const records = await this.catalogRepository.findMedicinesByIds(ids)
    return new Map(records.map((record) => [record.id, record]))
  }

  /** Резолв дисклеймера — тенант → нейтральный тенант → нейтральный+дефолтная локаль. См. JSDoc файла. */
  private async resolveDisclaimer(tenantId: string, locale: SupportedLocale): Promise<string> {
    const own = await this.findDisclaimer(tenantId, locale)
    if (own !== null) return own
    if (tenantId !== NEUTRAL_TENANT_ID) {
      const neutralSameLocale = await this.findDisclaimer(NEUTRAL_TENANT_ID, locale)
      if (neutralSameLocale !== null) return neutralSameLocale
    }
    const neutralDefault = await this.findDisclaimer(NEUTRAL_TENANT_ID, DEFAULT_LOCALE)
    if (neutralDefault !== null) return neutralDefault
    throw new InternalServerErrorException({
      code: ErrorCode.INTERNAL_ERROR,
      message: `catalog.analogs.disclaimer missing in i18n_overrides (locale=${locale}) — run pnpm db:seed (DTJ-103)`,
    })
  }

  private async findDisclaimer(tenantId: string, locale: string): Promise<string | null> {
    const entry = await this.i18nOverrides.findOne({ tenantId, locale, translationKey: DISCLAIMER_I18N_KEY })
    return entry === null ? null : entry.value
  }
}

/** Тот же приём детекта по коду ошибки, что `isSearchTemporarilyDegradedError` — см. JSDoc файла. */
function isMedicineNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { readonly code: unknown }).code === MEDICINE_NOT_FOUND_CODE
  )
}

/** Тот же приём, что `CatalogSearchController.resolveLocale` (DTJ-190). */
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
 * Резолв `TenantId` из `TenantContext` — тот же приём, что `PharmaciesMapController`/
 * `CatalogSearchController`: `TenantResolutionMiddleware`/`TenantScopeGuard`
 * (глобальные) гарантируют резолвленный тенант до presentation даже для
 * `@Public()`-маршрутов; недостижимая ветка страхует только от рассинхронизации
 * контракта, без фолбэка на `'neutral'` здесь.
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

function toQueryString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** `radiusMeters?` — дефолт переиспользует `SEARCH_DEFAULT_RADIUS_METERS` (`@dorutj/contracts`, C15). */
function parseRadiusMeters(raw: unknown): number {
  const str = toQueryString(raw)
  if (str === undefined) return SEARCH_DEFAULT_RADIUS_METERS
  const n = Number.parseInt(str, 10)
  return Number.isFinite(n) && n > 0 ? n : SEARCH_DEFAULT_RADIUS_METERS
}

/** `lat`/`lon` — оба заданы и валидны → гео-точка, иначе `undefined` (радиус без гео не ошибка). */
function buildGeo(rawQuery: Record<string, unknown>): { readonly lat: number; readonly lon: number } | undefined {
  const lat = parseFloatQuery(rawQuery.lat)
  const lon = parseFloatQuery(rawQuery.lon)
  return lat === undefined || lon === undefined ? undefined : { lat, lon }
}

function parseFloatQuery(raw: unknown): number | undefined {
  const str = toQueryString(raw)
  if (str === undefined) return undefined
  const n = Number.parseFloat(str)
  return Number.isFinite(n) ? n : undefined
}
