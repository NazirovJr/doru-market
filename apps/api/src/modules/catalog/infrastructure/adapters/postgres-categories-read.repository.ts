/**
 * Drizzle-реализация `CategoriesReadRepository` (DTJ-094 follow-up, Волна 5 блок B).
 *
 * DEFECT-FIX (см. `reports/CTO-DECISION-WAVE5.md` §3, блок B): порт был подключён к
 * `InMemoryCategoriesReadRepository` (`initial: readonly CategoryRecord[] = []`) — прод
 * не имел способа её заполнить, `GET /api/v1/categories` отдавал `data: []` независимо
 * от содержимого Postgres.
 *
 * **Не фильтрует `is_active` на уровне SQL.** `GetCategoryTreeUseCase.filterActiveSubtree`
 * (см. `application/use-cases/get-category-tree.use-case.ts`) обязан УВИДЕТЬ неактивные
 * узлы, чтобы скрыть их вместе со всеми потомками (SRS-CAT-004, критерий 2 приёмки DTJ-094)
 * — если бы `WHERE is_active = true` резал их в SQL, use case никогда не узнал бы про
 * `parentId` скрытой ветки и её активные на вид дети остались бы в дереве. Тот же
 * компромисс уже принят `InMemoryCategoriesReadRepository`/тестовым сидом
 * `categories-controller.integration.spec.ts` — этот адаптер сохраняет тот же контракт.
 * (Сравни с `CatalogRepositoryAdapter.findCategoryTree`, DTJ-092 — тот метод СЕЙЧАС не
 * используется ни одним контроллером и фильтрует `is_active` в SQL для СВОЕГО, отдельного
 * потребителя; несогласованность между этими двумя портами — вне блока B, см. отчёт сдачи.)
 *
 * **DEFECT-FOUND (чужой код, НЕ исправлен молча, см. `foundIssues` отчёта сдачи).**
 * `apps/api/src/db/schema/categories.ts` объявляет `is_active` как `integer(...).default(1)`,
 * но реальная миграция `0006_catalog_core.sql` создаёт колонку `is_active BOOLEAN NOT NULL
 * DEFAULT true` (проверено `\d categories` на живом Postgres) — Drizzle-схема и БД разошлись.
 * `pg`-драйвер возвращает РЕАЛЬНЫЙ тип колонки (JS `boolean`), а не тип, заявленный в схеме
 * (`number`), поэтому `row.isActive === 1` был бы ВСЕГДА `false` независимо от данных —
 * дерево категорий пряталось бы целиком. `Boolean(row.isActive)` ниже корректен для ОБОИХ
 * возможных рантайм-значений (текущего `boolean` И гипотетически исправленного `number`
 * 0/1) — защитный костыль, не подмена факта расхождения схема/БД, которое остаётся за
 * пределами файлов этого тикета (`apps/api/src/db/schema/**`).
 */
import { Inject, Injectable } from '@nestjs/common'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { categories } from '@/db/schema/categories.js'
import type {
  CategoriesReadRepository,
  CategoryRecord,
} from '@/modules/catalog/application/ports/categories-read.repository.port.js'

@Injectable()
export class PostgresCategoriesReadRepository implements CategoriesReadRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async listAll(): Promise<readonly CategoryRecord[]> {
    const rows = await this.db.select().from(categories).orderBy(categories.sortOrder, categories.id)
    return rows.map(
      (row): CategoryRecord => ({
        id: row.id,
        parentId: row.parentId,
        slug: row.slug,
        nameTj: row.nameTj,
        nameRu: row.nameRu,
        nameEn: row.nameEn,
        commissionCategory: row.commissionCategory as CategoryRecord['commissionCategory'],
        sortOrder: row.sortOrder,
        // `Boolean(...)`, не `=== 1` — см. DEFECT-FOUND в JSDoc файла (схема/БД разошлись по типу).
        isActive: Boolean(row.isActive),
      }),
    )
  }
}
