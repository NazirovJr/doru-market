/**
 * DI-фабрика `SEARCH_PROVIDER` (DTJ-185, EP-06, R1, `SRS-CAT-012`) — реальная развилка
 * `SEARCH_DRIVER==='postgres'` (дефолт) → `PostgresSearchProvider`.
 *
 * **Почему не в `application/search/providers/null-search.provider.ts` (DTJ-180).** Та
 * фабрика — слой `application`, ему запрещено импортировать `infrastructure`
 * (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.1, `application-does-not-know-infrastructure`,
 * проверено `no-restricted-imports`/`dependency-cruiser` при попытке сделать ветвление прямо
 * там). Направление `infrastructure → application` архитектурно разрешено (стрелки
 * зависимостей — только внутрь), поэтому этот файл легитимно импортирует ОБА:
 * `PostgresSearchProvider` (тот же слой) и `NullSearchProvider` (application, DTJ-180,
 * fallback для `'elasticsearch'`/нераспознанного значения).
 *
 * `catalog.module.ts` резолвит `SEARCH_PROVIDER` ОТСЮДА — правка тикета: одна строка импорта
 * (`from './application/...'` → `from './infrastructure/providers/search-provider.factory.js'`),
 * имя `searchProviderProvider` сохранено, чтобы диф в barrel-файле (D-27) остался
 * однострочным.
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-012, SRS-CAT-013)
 * @see tickets/ep05-search-map/DTJ-185.md
 */
import { Logger, type Provider } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Logger as PinoLogger } from 'pino'
import { PINO_LOGGER } from '@/common/logging/pino-logger.token.js'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { AppConfigService } from '@/config/app-config.service.js'
import { CLOCK, type Clock } from '@/shared-kernel/index.js'
import { SEARCH_PROVIDER, type SearchProvider } from '@/modules/catalog/application/search/ports/search-provider.port.js'
import { NullSearchProvider } from '@/modules/catalog/application/search/providers/null-search.provider.js'
import { PostgresSearchProvider } from '../adapters/postgres-search.adapter.js'

/** ENV-ключ переключения движка поиска (SRS-CAT-012) — та же схема чтения, что DTJ-180. */
const SEARCH_DRIVER_ENV_KEY = 'SEARCH_DRIVER'
const DEFAULT_SEARCH_DRIVER = 'postgres'

function resolveSearchDriver(configService: ConfigService): string {
  const raw: unknown = configService.get(SEARCH_DRIVER_ENV_KEY)
  return typeof raw === 'string' && raw.length > 0 ? raw : DEFAULT_SEARCH_DRIVER
}

const factoryLogger = new Logger('SearchProviderFactory')

/**
 * `'postgres'` (дефолт) → `PostgresSearchProvider` (DTJ-185). Иначе (включая `'elasticsearch'`,
 * без адаптера до R2/DTJ-191) → `NullSearchProvider`. `PostgresSearchProvider` не открывает
 * соединение в конструкторе (ленивый пул, DTJ-051) — веткование безопасно, даже если Postgres
 * временно недоступен при старте процесса (DTJ-180, критерий приёмки №1, сохранён).
 */
/* eslint-disable max-params -- NestJS useFactory: параметры соответствуют позициям inject ниже, стандартная практика фреймворка */
export function createSearchProvider(
  configService: ConfigService,
  db: DrizzleDb,
  logger: PinoLogger,
  clock: Clock,
  appConfig: AppConfigService,
): SearchProvider {
  const searchDriver = resolveSearchDriver(configService)
  if (searchDriver === DEFAULT_SEARCH_DRIVER) {
    return new PostgresSearchProvider(db, logger, clock, appConfig)
  }
  // TODO(DTJ-191, R2): 'elasticsearch' → ElasticSearchProvider (SRS-CAT-016/017) тем же путём.
  factoryLogger.warn(
    `SEARCH_DRIVER="${searchDriver}" задан, но движок ещё не реализован (TODO DTJ-191) — используется NullSearchProvider`,
  )
  return new NullSearchProvider()
}
/* eslint-enable max-params */

/** DI-биндинг для `SEARCH_PROVIDER` (D-27) — см. JSDoc файла. */
export const searchProviderProvider: Provider = {
  provide: SEARCH_PROVIDER,
  inject: [ConfigService, DRIZZLE_DB, PINO_LOGGER, CLOCK, AppConfigService],
  useFactory: createSearchProvider,
}
