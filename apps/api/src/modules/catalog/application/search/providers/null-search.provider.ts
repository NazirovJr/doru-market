/**
 * `NullSearchProvider` (DTJ-180, EP-06, R1) — временная реализация `SearchProvider`.
 *
 * Это **явная, типизированная заглушка** (`05-DEVELOPER-HANDBOOK.md` §14
 * «Null*Adapter + явный TODO с номером тикета»), а не пропуск работы: `PostgresSearchProvider`
 * (SRS-CAT-013) — предмет отдельного тикета DTJ-185, который на момент DTJ-180 ещё не
 * существует. Без резолвящегося `SEARCH_PROVIDER` ЛЮБОЙ параллельный тикет, поднимающий
 * `apps/api` целиком (например, e2e/интеграционные тесты других модулей волны 5), падал бы
 * на `UnknownDependenciesException` — заглушка держит приложение живым до готовности
 * реального движка (ticket DTJ-180, «Что сделать» п.3).
 *
 * **Семантика.** `search()`/`suggest()` возвращают пустые структуры формы
 * `SearchResultPage`/`SuggestItem[]` для ЛЮБОГО входа — «результатов ещё нет», а не «ничего
 * не найдено». Использующий код (будущий `SearchMedicinesUseCase`, DTJ-183+) не отличает эти
 * два случая на уровне типов — отличие ответственность presentation/UX той же логики, что
 * `NullAnalogOfferLookupAdapter` (DTJ-101) уже применяет для `hasAnalogs`.
 *
 * **DTJ-185: реальная развилка живёт В `infrastructure`, НЕ здесь.** Этот файл — слой
 * `application` (`modules/catalog/application/search/providers/`) — не имеет права
 * импортировать `PostgresSearchProvider`/`DrizzleDb` (`02` §1.1, `application-does-not-know-
 * infrastructure`, проверено `no-restricted-imports`/`depcruise` при попытке сделать это прямо
 * здесь). Реальная фабрика с веткой `'postgres' → PostgresSearchProvider` — отдельный файл
 * `infrastructure/providers/search-provider.factory.ts` (DTJ-185), который легитимно
 * импортирует ЭТОТ класс (`NullSearchProvider`, application) как fallback для нераспознанного
 * `SEARCH_DRIVER` — направление `infrastructure → application` архитектурно разрешено (`02`
 * §1.1, стрелки внутрь). `catalog.module.ts` резолвит `SEARCH_PROVIDER` из ТОГО файла;
 * `createSearchProvider`/`searchProviderProvider` ниже — оставлены как самостоятельный,
 * протестированный строительный блок (простая, всегда-`NullSearchProvider` фабрика), но
 * production DI-граф их больше не использует напрямую.
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-011, SRS-CAT-012)
 * @see tickets/ep05-search-map/DTJ-180.md
 * @see tickets/ep05-search-map/DTJ-185.md
 */
import { Injectable, Logger, type Provider } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  SEARCH_PROVIDER,
  type SearchProvider,
  type SearchQuery,
  type SearchResultPage,
  type SuggestItem,
} from '../ports/search-provider.port.js'
import type { TenantId } from '@/modules/tenancy/index.js'

/** ENV-ключ переключения движка поиска (SRS-CAT-012). Не объявлен в `env.schema.ts` — см. `resolveSearchDriver`. */
const SEARCH_DRIVER_ENV_KEY = 'SEARCH_DRIVER'
const DEFAULT_SEARCH_DRIVER = 'postgres'

/**
 * Реализация `SearchProvider`, ничего не знающая о хранилище. Оборачиваем результат
 * в `Promise.resolve(...)` (не `async`), чтобы выполнить контракт порта
 * (`Promise<...>`) без лишнего `async`-шума — тот же приём, что `NullAnalogOfferLookupAdapter`.
 */
@Injectable()
export class NullSearchProvider implements SearchProvider {
  public search(_query: SearchQuery): Promise<SearchResultPage> {
    return Promise.resolve({ items: [], nextCursor: null, hasMore: false })
  }

  public suggest(_prefix: string, _tenantId: TenantId, _limit: number): Promise<readonly SuggestItem[]> {
    return Promise.resolve([])
  }
}

/**
 * `ConfigService.get(key)` без `infer: true` возвращает `unknown`. Безопасно читаем ключ,
 * не объявленный в `env.schema.ts` — тот же приём, что `readAmbiguityGap`/`readFuzzyLimit`
 * в `resolve-medicine-by-composite.use-case.ts` (DTJ-097): DTJ-180 НЕ требует добавления
 * `SEARCH_DRIVER` в схему (само значение пока ни на что не влияет, см. класс выше),
 * регистрация в `env.schema.ts` — по факту первой реальной ветки в DTJ-185. Fallback на
 * дефолт `'postgres'` при отсутствии/пустом/нестроковом значении.
 */
function resolveSearchDriver(configService: ConfigService): string {
  const raw: unknown = configService.get(SEARCH_DRIVER_ENV_KEY)
  return typeof raw === 'string' && raw.length > 0 ? raw : DEFAULT_SEARCH_DRIVER
}

const factoryLogger = new Logger('SearchProviderFactory')

/**
 * Фабрика `SearchProvider` (SRS-CAT-012). Именованная функция (не инлайн-стрелка) —
 * прямой юнит-тест без типовой гимнастики над union-типом `Provider` в тесте
 * (`null-search.provider.spec.ts`), при этом `searchProviderProvider.useFactory` ниже
 * ссылается на неё же — единственная реализация, не дублирование.
 *
 * Читает `SEARCH_DRIVER` (дефолт `'postgres'`, SRS-CAT-012) уже сейчас — форма готова для
 * DTJ-185/DTJ-191. Пока резолвится единственная реализация: ЛЮБОЕ значение `SEARCH_DRIVER`
 * (включая `'elasticsearch'`, не имеющий адаптера до R2/DTJ-191) возвращает
 * `NullSearchProvider` — см. TODO внутри. Приложение обязано стартовать при
 * незаданном/любом `SEARCH_DRIVER` (DTJ-180, критерий приёмки №1).
 *
 * НЕ используется production DI-графом (DTJ-185, см. JSDoc файла) — `catalog.module.ts`
 * резолвит `SEARCH_PROVIDER` из `infrastructure/providers/search-provider.factory.ts`.
 * Оставлена как протестированный строительный блок/референс поведения «безопасный дефолт».
 */
export function createSearchProvider(configService: ConfigService): SearchProvider {
  const searchDriver = resolveSearchDriver(configService)
  // TODO(DTJ-191, R2): 'elasticsearch' → ElasticSearchProvider тем же путём (SRS-CAT-016/017).
  // 'postgres' → PostgresSearchProvider реализовано в infrastructure/providers/
  // search-provider.factory.ts (DTJ-185, см. JSDoc файла) — ЗДЕСЬ остаётся ЛЮБОЕ значение →
  // NullSearchProvider (эта функция архитектурно не может знать про infrastructure).
  if (searchDriver !== DEFAULT_SEARCH_DRIVER) {
    factoryLogger.warn(
      `SEARCH_DRIVER="${searchDriver}" задан, но движок ещё не реализован (TODO DTJ-185/DTJ-191) — используется NullSearchProvider`,
    )
  }
  return new NullSearchProvider()
}

/**
 * DI-биндинг для `SEARCH_PROVIDER` (D-27, тот же приём готового `Provider`-объекта, что
 * `drizzleProvider` в `infrastructure/database/drizzle.provider.ts`) — `catalog.module.ts`
 * добавляет ОДНУ строку импорта и ОДНУ строку в `providers: [...]`, не переписывая секцию.
 *
 * НЕ используется production DI-графом (см. JSDoc файла и `createSearchProvider` выше) —
 * оставлен для симметрии/тестируемости, реальный биндинг — `search-provider.factory.ts`.
 */
export const searchProviderProvider: Provider = {
  provide: SEARCH_PROVIDER,
  inject: [ConfigService],
  useFactory: createSearchProvider,
}
