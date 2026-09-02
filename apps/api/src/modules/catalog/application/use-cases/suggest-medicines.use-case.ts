/**
 * `SuggestMedicinesUseCase` (DTJ-189, EP-06 «Умный поиск + ранжирование + автодополнение», R1).
 *
 * Автодополнение — REQ-UX-12. Отдельный use case от `SearchMedicinesUseCase` (DTJ-188):
 * принципиально другая ветка для пустого ввода (серверный trending-фолбэк, `SRS-CAT-030`) и
 * НЕ пишет `search_query_log` (это только для полноценных поисковых запросов, не подсказок на
 * каждый символ — DTJ-189 «Что сделать» п.3). Конструктор НАМЕРЕННО не инжектирует
 * `SearchQueryLogRepository` — «не пишет лог» доказано отсутствием самой зависимости, не
 * условием внутри метода.
 *
 * **Кэш + stampede-защита — тот же архитектурный порт, что `SearchMedicinesUseCase`.**
 * `CacheLockPort`/`TrendingSearchesPort` — тонкие `application`-обёртки над `RedisLockGuard`/
 * `SearchCacheService` (DTJ-187, `infrastructure/cache/`): прямая инъекция ЭТИХ классов по
 * классу (как буквально описывает JSDoc DTJ-187 и комментарий `catalog.module.ts`) ломает
 * машинно проверяемое правило `application-does-not-know-infrastructure`
 * (`.dependency-cruiser.cjs`) — см. полное обоснование в JSDoc `cache-lock.port.ts`/
 * `trending-searches.port.ts` (тот же разрыв, решённый тем же способом, что в DTJ-188).
 *
 * **Форма ответа — НЕ порт `SuggestItem` напрямую.** Тикет («Что сделать» п.1, «Риски»)
 * прямо требует задокументировать отклонение: пустой `prefix` возвращает записи trending,
 * у которых есть ТОЛЬКО текст запроса (никакой привязки к конкретному `medicineId` — Redis
 * хранит строки, не UUID). `SuggestMedicinesResultItem` ниже — дискриминированный союз,
 * который делает это отклонение явным на уровне типов (не `medicineId: null` заглушкой в общей
 * форме — та маппинг-заглушка, по тексту тикета, задача presentation, DTJ-190/192/193, не этого
 * use case).
 *
 * **Debounce/`AbortController` — НЕ ответственность backend.** DTJ-189 «Что сделать» п.4:
 * искусственная задержка на сервере здесь НЕ реализуется — это фронтенд-тикет DTJ-192
 * (`SRS-CAT-027`). Каждый вызов `execute()` обрабатывается немедленно.
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-027..030)
 * @see tickets/ep05-search-map/DTJ-189.md
 */
import { Inject, Injectable } from '@nestjs/common'
import type { TenantId } from '@/modules/tenancy/index.js'
import {
  SEARCH_PROVIDER,
  type SearchProvider,
  type SuggestItem,
} from '@/modules/catalog/application/search/ports/search-provider.port.js'
import {
  CACHE_LOCK_PORT,
  type CacheLockPort,
} from '@/modules/catalog/application/ports/cache-lock.port.js'
import {
  TRENDING_SEARCHES_PORT,
  type TrendingSearchesPort,
} from '@/modules/catalog/application/ports/trending-searches.port.js'
import {
  SEARCH_CACHE_KEY_BUILDER,
  type SearchCacheKeyBuilder,
} from '@/modules/catalog/application/ports/search-cache-key.port.js'

export interface SuggestMedicinesCommand {
  readonly prefix: string
  readonly tenantId: TenantId
  readonly limit: number
}

/** Подсказка, привязанная к конкретному медикаменту каталога (порт `SuggestItem`, дедуп на уровне DTJ-186). */
export interface SuggestMedicineItem extends SuggestItem {
  readonly kind: 'medicine'
}

/**
 * Trending-подсказка (пустой `prefix`, `SRS-CAT-030`) — ТОЛЬКО текст запроса, без `medicineId`/
 * `innName`/`matchedVia` (см. JSDoc файла, «Форма ответа»).
 */
export interface SuggestTrendingItem {
  readonly kind: 'trending'
  readonly tradeName: string
}

export type SuggestMedicinesResultItem = SuggestMedicineItem | SuggestTrendingItem

@Injectable()
export class SuggestMedicinesUseCase {
  /* eslint-disable max-params -- NestJS DI: 4 порта в конструкторе — та же обоснованная
     практика, что `postgres-search.adapter.ts`/`SearchMedicinesUseCase`. */
  constructor(
    @Inject(SEARCH_PROVIDER) private readonly searchProvider: SearchProvider,
    @Inject(CACHE_LOCK_PORT) private readonly cacheLock: CacheLockPort,
    @Inject(TRENDING_SEARCHES_PORT) private readonly trendingSearches: TrendingSearchesPort,
    @Inject(SEARCH_CACHE_KEY_BUILDER) private readonly cacheKeyBuilder: SearchCacheKeyBuilder,
  ) {}
  /* eslint-enable max-params */

  async execute(command: SuggestMedicinesCommand): Promise<readonly SuggestMedicinesResultItem[]> {
    const prefix = command.prefix.trim()
    if (prefix === '') {
      // SRS-CAT-030: явный пустой q — фронтенд уже решил, что клиентская история (localStorage)
      // пуста, и просит серверный trending-фолбэк. SearchProvider НЕ вызывается вовсе.
      return this.resolveTrending(command.tenantId)
    }
    return this.resolveByPrefix(prefix, command)
  }

  private async resolveTrending(tenantId: TenantId): Promise<readonly SuggestTrendingItem[]> {
    const trending = await this.trendingSearches.getTrendingSearches(tenantId.value)
    return trending.map((tradeName) => ({ kind: 'trending' as const, tradeName }))
  }

  private async resolveByPrefix(
    prefix: string,
    command: SuggestMedicinesCommand,
  ): Promise<readonly SuggestMedicineItem[]> {
    const cacheKey = this.cacheKeyBuilder.buildSuggestKey(command.tenantId.value, prefix)
    return this.cacheLock.withLock(cacheKey, this.cacheKeyBuilder.suggestionsTtlMs, async () => {
      const items = await this.searchProvider.suggest(prefix, command.tenantId, command.limit)
      return items.map((item) => ({ ...item, kind: 'medicine' as const }))
    })
  }
}
