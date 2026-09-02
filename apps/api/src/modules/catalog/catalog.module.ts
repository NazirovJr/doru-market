/**
 * NestJS-модуль `catalog` (EP-04, DTJ-090). Barrel-файл (D-27): правится ТОЛЬКО
 * добавлением строк, перечитать перед правкой, конфликты слияния — за архитектором.
 *
 * Провайдеры регистрируются по мере реализации тикетов DTJ-092, 094, 095, 096, 097, 100, 101.
 * Сейчас модуль пуст — скелет для подключения в корневой `AppModule` последующими тикетами.
 */
import { Module } from '@nestjs/common'
import { MedicinesController } from './presentation/controllers/medicines.controller.js'
import { CategoriesController } from './presentation/controllers/categories.controller.js'
// DTJ-197: контроллер карты аптек, первый потребитель GetPharmacyMapPinsUseCase (DTJ-196).
import { PharmaciesMapController } from './presentation/controllers/pharmacies-map.controller.js'
import { GetMedicineByIdUseCase } from './application/use-cases/get-medicine-by-id.use-case.js'
import { GetMedicineDetailUseCase } from './application/use-cases/get-medicine-detail.use-case.js'
import { ListMedicinesUseCase } from './application/use-cases/list-medicines.use-case.js'
import { GetCategoryTreeUseCase } from './application/use-cases/get-category-tree.use-case.js'
import { CategoryTreeService } from './domain/services/category-tree.service.js'
import {
  MEDICINE_READ_REPOSITORY,
} from './application/ports/medicine-read.repository.port.js'
import { CATEGORIES_READ_REPOSITORY } from './application/ports/categories-read.repository.port.js'
import { InMemoryMedicineReadRepository } from './infrastructure/adapters/in-memory-medicine-read.repository.js'
import { InMemoryCategoriesReadRepository } from './infrastructure/adapters/in-memory-categories-read.repository.js'
import { CATALOG_REPOSITORY } from './application/ports/catalog-repository.port.js'
import { CatalogRepositoryAdapter } from './infrastructure/adapters/catalog-repository.adapter.js'
import { FUZZY_MEDICINE_MATCHER } from './application/ports/fuzzy-medicine-matcher.port.js'
import { FuzzyMedicineMatcherAdapter } from './infrastructure/adapters/fuzzy-medicine-matcher.adapter.js'
import { DosageFormNormalizerService } from './application/services/dosage-form-normalizer.service.js'
import { ResolveMedicineByCompositeUseCase } from './application/use-cases/resolve-medicine-by-composite.use-case.js'
import { ANALOG_CANDIDATES_REPOSITORY } from './application/ports/analog-candidates.port.js'
import { AnalogCandidatesAdapter } from './infrastructure/adapters/analog-candidates.adapter.js'
// DTJ-101: порт офферов аналогов + Null-адаптер (временная заглушка, см. TODO в adapter).
import { ANALOG_OFFER_LOOKUP_PORT } from './application/ports/analog-offer-lookup.port.js'
import { NullAnalogOfferLookupAdapter } from './infrastructure/adapters/analog-offer-lookup.adapter.js'
// DTJ-101: оркестратор подбора аналогов.
import { FindAnalogsUseCase } from './application/use-cases/find-analogs.use-case.js'
// DTJ-096: новые use cases и фасад
import { PublishMedicineUseCase } from './application/use-cases/publish-medicine.use-case.js'
import { ProposeControlCategoryUseCase } from './application/use-cases/propose-control-category.use-case.js'
import { CATALOG_FACADE, CatalogFacadeImpl } from './index.js'
// DTJ-096 follow-up (разблокировка волны 4): `PublishMedicineUseCase`/
// `ProposeControlCategoryUseCase` инжектируют `UNIT_OF_WORK` из `auth` —
// без импорта `AuthModule` здесь Nest не резолвит эту зависимость
// (`UnknownDependenciesException` при старте, проверено вручную через
// `Test.createTestingModule({ imports: [AuthModule, CatalogModule] })`).
import { AuthModule } from '@/modules/auth/auth.module.js'
// DTJ-185: DI-биндинг SEARCH_PROVIDER — реальная развилка 'postgres' → PostgresSearchProvider
// (было DTJ-180 null-search.provider.ts, всегда NullSearchProvider; та фабрика архитектурно не
// может знать про infrastructure, см. JSDoc infrastructure/providers/search-provider.factory.ts).
import { searchProviderProvider } from './infrastructure/providers/search-provider.factory.js'
// DTJ-195: bbox-репозиторий пинов карты аптек (PharmacyMapRepository, DTJ-194). Пока не
// потреблён use case'ом (DTJ-196 — следующий тикет), но подключён к DI сразу (Ж2).
import {
  PHARMACY_MAP_REPOSITORY_PROVIDER,
  PostgresPharmacyMapAdapter,
} from './infrastructure/adapters/postgres-pharmacy-map.adapter.js'
// DTJ-196: use case карты аптек — первый реальный потребитель PHARMACY_MAP_REPOSITORY.
import { GetPharmacyMapPinsUseCase } from './application/use-cases/get-pharmacy-map-pins.use-case.js'
// DTJ-187: Redis-кэш поиска/подсказок/trending + защита от cache stampede. Пока не потреблены
// use case'ами (SearchMedicinesUseCase/SuggestMedicinesUseCase — DTJ-188/189, следующие тикеты
// той же волны), но подключены к DI сразу (Ж2) — инъекция напрямую по классу, без Symbol-токена.
import { SearchCacheService } from './infrastructure/cache/search-cache.service.js'
import { RedisLockGuard } from './infrastructure/cache/redis-lock-guard.js'
// DTJ-188/189: нормализация запроса (DTJ-182, домен) — регистрируется здесь, первым реальным
// потребителем. `QueryNormalizationService`/`TransliterationNormalizerService` — чистые классы
// без `@Injectable()`, собираются через `useFactory`; таблица транслитерации читается ОДИН раз
// при старте DI-графа инфраструктурным загрузчиком (не I/O в domain, см. JSDoc обоих файлов).
import { QueryNormalizationService } from './domain/services/query-normalization.service.js'
import { TransliterationNormalizerService } from './domain/services/transliteration-normalizer.service.js'
import { loadTranslitMap } from './infrastructure/loaders/translit-map.loader.js'
// DTJ-188/189: тонкие application-порты над `SearchCacheService`/`RedisLockGuard` (DTJ-187) —
// прямая инъекция ЭТИХ классов по классу в `application/use-cases/*` ломает машинно проверяемое
// правило `application-does-not-know-infrastructure` (`.dependency-cruiser.cjs`), см. JSDoc
// `cache-lock.port.ts`/`trending-searches.port.ts` за полным обоснованием и эмпирической проверкой.
import { CACHE_LOCK_PORT } from './application/ports/cache-lock.port.js'
import { TRENDING_SEARCHES_PORT } from './application/ports/trending-searches.port.js'
// DTJ-188/189: тот же разрыв, но для чистых функций/констант (не класс) — `buildSearchCacheKey`/
// `buildSuggestCacheKey`/TTL-константы (DTJ-187) связаны `useValue` (см. JSDoc `search-cache-key.port.ts`).
import {
  buildSearchCacheKey,
  buildSuggestCacheKey,
  SEARCH_RESULTS_CACHE_TTL_SECONDS,
  SUGGESTIONS_CACHE_TTL_SECONDS,
} from './infrastructure/cache/search-cache.service.js'
import { SEARCH_CACHE_KEY_BUILDER, type SearchCacheKeyBuilder } from './application/ports/search-cache-key.port.js'
// DTJ-188: insert-порт `search_query_log` (схема/миграция — DTJ-181, уже существует;
// порт+адаптер заводит этот тикет по образцу `ANALOG_CANDIDATES_REPOSITORY`).
import {
  SEARCH_QUERY_LOG_REPOSITORY_PROVIDER,
  SearchQueryLogAdapter,
} from './infrastructure/adapters/search-query-log.adapter.js'
// DTJ-188/189: оркестраторы поиска и автодополнения — первые реальные потребители
// SEARCH_PROVIDER (DTJ-185) и SearchCacheService/RedisLockGuard (DTJ-187).
import { SearchMedicinesUseCase } from './application/use-cases/search-medicines.use-case.js'
import { SuggestMedicinesUseCase } from './application/use-cases/suggest-medicines.use-case.js'
// DTJ-190: HTTP-граница поиска/автодополнения — первый реальный потребитель
// SearchMedicinesUseCase/SuggestMedicinesUseCase (DTJ-188/189) со стороны presentation.
import { CatalogSearchController } from './presentation/controllers/catalog-search.controller.js'

/** SRS-CAT-058: TTL кэша поиска/подсказок в секундах (DTJ-187) → миллисекунды для `CacheLockPort`. */
const MS_PER_SECOND = 1000

@Module({
  imports: [AuthModule],
  providers: [
    { provide: MEDICINE_READ_REPOSITORY, useClass: InMemoryMedicineReadRepository },
    { provide: CATEGORIES_READ_REPOSITORY, useClass: InMemoryCategoriesReadRepository },
    // DTJ-092: единый Drizzle-порт каталога. Не заменяет in-memory read-порты
    // (они используются существующими use case'ами волны 3.5); use case'ы
    // DTJ-094..096 будут постепенно переведены на этот порт в своих тикетах.
    { provide: CATALOG_REPOSITORY, useClass: CatalogRepositoryAdapter },
    // DTJ-097: composite-матчинг (точная проверка штрихкода + trigram fuzzy
    // + постфильтр по дозировке, D-06). Использует `DrizzleDb` напрямую.
    { provide: FUZZY_MEDICINE_MATCHER, useClass: FuzzyMedicineMatcherAdapter },
    // DTJ-100: SQL-предфильтр кандидатов аналогов по множеству веществ + форме
    // + фильтрам видимости/безопасности. Первый рубеж защиты перед тяжёлым
    // доменным решением AnalogEquivalenceService.isAnalog() (DTJ-099).
    { provide: ANALOG_CANDIDATES_REPOSITORY, useClass: AnalogCandidatesAdapter },
    // DTJ-101: временная заглушка `NullAnalogOfferLookupAdapter` возвращает пустой
    // `Map` офферов. После появления `InventoryFacade.getStockAndPriceBatch` (EP-05)
    // или согласования ADR на прямой SQL-путь — заменить `useClass` без правок use case.
    { provide: ANALOG_OFFER_LOOKUP_PORT, useClass: NullAnalogOfferLookupAdapter },
    InMemoryMedicineReadRepository,
    InMemoryCategoriesReadRepository,
    CatalogRepositoryAdapter,
    FuzzyMedicineMatcherAdapter,
    AnalogCandidatesAdapter,
    NullAnalogOfferLookupAdapter,
    DosageFormNormalizerService,
    ResolveMedicineByCompositeUseCase,
    GetMedicineByIdUseCase,
    GetMedicineDetailUseCase,
    ListMedicinesUseCase,
    GetCategoryTreeUseCase,
    CategoryTreeService,
    // DTJ-101: оркестратор `FindAnalogsUseCase` — экспортируется для
    // `GetMedicineDetailUseCase` (DTJ-095, когда переключит `hasAnalogs` на
    // прямой вызов) и для будущего контроллера `GET /api/v1/medicines/:id/analogs` (DTJ-102).
    FindAnalogsUseCase,
    // DTJ-096: новые use cases
    PublishMedicineUseCase,
    ProposeControlCategoryUseCase,
    // DTJ-096: фасад каталога для межмодульного взаимодействия
    { provide: CATALOG_FACADE, useClass: CatalogFacadeImpl },
    // DTJ-180/185: SEARCH_PROVIDER — фабрика резолвит PostgresSearchProvider при
    // SEARCH_DRIVER='postgres' (дефолт, боевой путь); NullSearchProvider — только фолбэк
    // для нереализованных значений (напр. 'elasticsearch', TODO(DTJ-191) внутри фабрики).
    searchProviderProvider,
    // DTJ-195: PHARMACY_MAP_REPOSITORY — реальный Drizzle bbox-адаптер (не Null-заглушка,
    // единственная продакшен-реализация порта DTJ-194 с самого начала).
    PHARMACY_MAP_REPOSITORY_PROVIDER,
    PostgresPharmacyMapAdapter,
    // DTJ-196: use case карты аптек (валидация площади bbox + маппинг в MapPinDto).
    // Экспортируется для будущего контроллера GET /api/v1/pharmacies/map (DTJ-197).
    GetPharmacyMapPinsUseCase,
    // DTJ-187: инфраструктурные утилиты кэша поиска — без Symbol-токена, потребители
    // (DTJ-188/189) инжектируют напрямую по классу через конструктор.
    SearchCacheService,
    RedisLockGuard,
    // DTJ-188/189: фабрики для доменных классов без @Injectable() — translitMap читается один
    // раз через infrastructure-загрузчик, не на каждый поисковый запрос (DTJ-182 «Что сделать» п.2).
    {
      provide: TransliterationNormalizerService,
      useFactory: () => new TransliterationNormalizerService(loadTranslitMap()),
    },
    {
      provide: QueryNormalizationService,
      inject: [TransliterationNormalizerService],
      useFactory: (transliterator: TransliterationNormalizerService) =>
        new QueryNormalizationService(transliterator),
    },
    // DTJ-188/189: CacheLockPort/TrendingSearchesPort — алиасы на уже зарегистрированные
    // RedisLockGuard/SearchCacheService выше (не новый провайдер, `useExisting`).
    { provide: CACHE_LOCK_PORT, useExisting: RedisLockGuard },
    { provide: TRENDING_SEARCHES_PORT, useExisting: SearchCacheService },
    // DTJ-188/189: SearchCacheKeyBuilder — `useValue`, т.к. `buildSearchCacheKey`/
    // `buildSuggestCacheKey` обычные функции (не класс), `useExisting` здесь неприменим.
    {
      provide: SEARCH_CACHE_KEY_BUILDER,
      useValue: {
        searchResultsTtlMs: SEARCH_RESULTS_CACHE_TTL_SECONDS * MS_PER_SECOND,
        suggestionsTtlMs: SUGGESTIONS_CACHE_TTL_SECONDS * MS_PER_SECOND,
        buildSearchResultsKey: buildSearchCacheKey,
        buildSuggestKey: buildSuggestCacheKey,
      } satisfies SearchCacheKeyBuilder,
    },
    // DTJ-188: search_query_log insert-порт.
    SEARCH_QUERY_LOG_REPOSITORY_PROVIDER,
    SearchQueryLogAdapter,
    // DTJ-188/189: оркестраторы поиска и автодополнения.
    SearchMedicinesUseCase,
    SuggestMedicinesUseCase,
  ],
  controllers: [MedicinesController, CategoriesController, PharmaciesMapController, CatalogSearchController],
  exports: [
    MEDICINE_READ_REPOSITORY,
    CATEGORIES_READ_REPOSITORY,
    CATALOG_REPOSITORY,
    GetMedicineByIdUseCase,
    GetMedicineDetailUseCase,
    ListMedicinesUseCase,
    GetCategoryTreeUseCase,
    // DTJ-096: экспорт фасада для потребителей (inventory, orders)
    CATALOG_FACADE,
    // DTJ-096: экспорт use cases для админских контроллеров модерации
    PublishMedicineUseCase,
    ProposeControlCategoryUseCase,
    // DTJ-101: оркестратор аналогов доступен для DTJ-095 (hasAnalogs) и DTJ-102 (контроллер).
    FindAnalogsUseCase,
    // DTJ-196: use case карты аптек, экспортирован для контроллера DTJ-197.
    GetPharmacyMapPinsUseCase,
    // DTJ-188/189: use cases поиска/автодополнения, экспортированы для будущего контроллера DTJ-190.
    SearchMedicinesUseCase,
    SuggestMedicinesUseCase,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: пустое тело класса — его контракт, вся конфигурация в декораторе @Module(...) выше.
export class CatalogModule {}
