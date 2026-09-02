/**
 * DI-регресс (CTO-дефект 1, обнаружен смежным агентом при работе над DTJ-15x):
 * `DrizzleFullSyncCompletionAdapter` был объявлен провайдером `InventoryModule` (см.
 * `inventory.module.ts`) БЕЗ `@Injectable()` и без `@Inject(DRIZZLE_DB)` на параметре
 * конструктора. Юнит-тесты остальных адаптеров модуля создают их конструктором напрямую
 * и поэтому не ловят такие дефекты — только реальный Nest-инжектор их видит.
 *
 * **Почему тест НЕ поднимает `InventoryModule` целиком.** Было опробовано буквально
 * (`Test.createTestingModule({ imports: [AppConfigModule, LoggerModule, DatabaseModule,
 * InventoryModule] }).compile()`), но компиляция падает РАНЬШЕ, чем доходит до нашего
 * провайдера — на СОВЕРШЕННО ДРУГОМ, независимом дефекте того же класса в том же модуле:
 * `IngestInventoryBatchWithMatchingUseCase` (`application/use-cases/
 * ingest-inventory-batch-with-matching.use-case.ts`) инжектирует `CompositeInventoryMatcherService`
 * БЕЗ `@Inject(...)`, полагаясь на неявный `design:paramtypes` — который, по документированной
 * конвенции этого репозитория (DTJ-001, тот же паттерн, что чинится здесь), esbuild/vitest не
 * эмитит. Это ДРУГОЙ дефект, не входящий в периметр этого тикета (файл не в списке двух
 * дефектов CTO), поэтому он не чинится здесь — см. отчёт по тикету, раздел «Найденные чужие
 * проблемы» — а честный способ проверить резолвинг ИМЕННО `DrizzleFullSyncCompletionAdapter`,
 * не будучи заблокированным ЧУЖИМ дефектом, — собрать для него достаточный, но минимальный
 * тестовый модуль: `AppConfigModule` + `DatabaseModule` (реальный провайдер `DRIZZLE_DB`,
 * тот же токен, что в проде) + сам класс адаптера как единственный провайдер.
 *
 * Это ТА ЖЕ форма DI-резолвинга, что использует Nest при бутстрапе `InventoryModule` внутри
 * `AppModule` (там `DatabaseModule` тоже подключён отдельно, рядом, не изнутри
 * `InventoryModule` — токен `DRIZZLE_DB` глобальный, см. `DatabaseModule` `@Global()`), поэтому
 * тест бьёт именно по дефекту 1, не подделывая результат моком вместо реального DI-графа.
 *
 * Реального Postgres-соединения тест не открывает: `DRIZZLE_DB` — фабрика на `pg.Pool`,
 * конструктор пула не шлёт сетевых команд синхронно при `compile()`.
 */
import { describe, expect, it } from 'vitest'
import { Test } from '@nestjs/testing'
import { AppConfigModule } from '@/config/config.module.js'
import { DatabaseModule } from '@/infrastructure/database/database.module.js'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { DrizzleFullSyncCompletionAdapter } from './infrastructure/adapters/drizzle-full-sync-completion.adapter.js'

describe('DrizzleFullSyncCompletionAdapter — DI-резолвинг (реальный Nest-контейнер)', () => {
  it('компилируется и резолвит зависимость через DRIZZLE_DB, а не оставляет её undefined', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, DatabaseModule],
      providers: [DrizzleFullSyncCompletionAdapter],
    }).compile()

    const adapter = moduleRef.get(DrizzleFullSyncCompletionAdapter)
    expect(adapter).toBeInstanceOf(DrizzleFullSyncCompletionAdapter)

    // Без @Injectable()/@Inject(DRIZZLE_DB) Nest не эмитит design:paramtypes для этого
    // класса (декораторов нет вообще) и тихо вызывает конструктор БЕЗ аргументов — `db`
    // остаётся `undefined`, но никакой ошибки при `compile()` не бросается. Явная проверка
    // тождества с реальным `DRIZZLE_DB`-провайдером — единственный надёжный способ поймать
    // это (падение позже, в `zeroOutMissing`, было бы NPE, не DI-ошибкой).
    const drizzleDb = moduleRef.get<DrizzleDb>(DRIZZLE_DB)
    expect((adapter as unknown as { db: unknown }).db).toBe(drizzleDb)

    await moduleRef.close()
  })
})
