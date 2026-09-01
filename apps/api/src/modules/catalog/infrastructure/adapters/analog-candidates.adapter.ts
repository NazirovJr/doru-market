/**
 * Drizzle-реализация `AnalogCandidatesRepository` (DTJ-100, EP-07, R1).
 *
 * SQL-предфильтр кандидатов аналогов по МНОЖЕСТВУ действующих веществ,
 * форме выпуска и фильтрам видимости/безопасности. Это первый (быстрый)
 * рубеж защиты перед тяжёлым доменным решением `AnalogEquivalenceService.
 * isAnalog()` (DTJ-099), которое уточняет дозировку для каждого кандидата
 * в памяти.
 *
 * **Семантика SQL (SRS-CAT-043).** Множество `substance_id` сравнивается
 * через `array_agg(... ORDER BY)` с обеих сторон — это кардинальное
 * равенство множеств (НЕ пересечение, НЕ подмножество). Например:
 *   - `{парацетамол}` ≠ `{парацетамол, кофеин}` (разная длина массива);
 *   - `{парацетамол, кофеин}` vs `{кофеин, парацетамол}` после
 *     `ORDER BY substance_id` дают одинаковый массив → совпадают.
 *
 * **Расхождение с DTJ-099 — не дефект.** SQL-предфильтр работает ТОЛЬКО
 * с таблицами `medicines`/`medicine_substances` (catalog-owned) и не делает
 * межмодульных JOIN'ов. Доменное решение DTJ-099 дополнительно проверяет
 * эквивалентность дозировки через `Dosage.isEquivalentTo`. Это сознательное
 * разделение «быстрая грубая выборка на SQL» / «точное решение в памяти».
 *
 * **Фильтры безопасности на уровне SQL (defense-in-depth, SRS-DOM-157).**
 *   - `is_published = true` — черновики не утекают в публичные API;
 *   - `control_category NOT IN ('psychotropic', 'narcotic')` — defense-in-depth
 *     на случай, если use case пропустит фильтр (TC-CAT-055).
 *
 * **Бюджет.** Возвращает ≤ `limit` записей (SRS-CAT-061 «O(50), не O(N)»).
 * Типичный вызов: `ANALOG_CANDIDATES_LIMIT = 50`, объявляется вызывающим
 * (DTJ-101). Адаптер НЕ клампит `limit` сверху — это политика вызывающего;
 * клампит только снизу (`limit < 1` → `1`), чтобы избежать `LIMIT 0`
 * (бессмысленно) и `LIMIT -1` (синтаксическая ошибка Postgres).
 *
 * **Drizzle-инстанс.** Использует общий `DRIZZLE_DB` из
 * `infrastructure/database/drizzle.provider.ts` (DTJ-051 follow-up).
 * Конструктор не открывает соединение — реальный коннект устанавливает
 * `DrizzleDb` lazy при первом запросе. Это позволяет резолвить адаптер в
 * DI-графе unit-тестов без БД.
 *
 * **Сложность запроса.** Корреллированный `array_agg` по `medicine_substances`
 * может быть медленным без индекса `ix_medicine_substances_substance_id`
 * (создан в миграции DTJ-091). При превышении бюджета `p95 < 300мс`
 * потребуется материализованная колонка «substance set hash» или
 * `EXISTS`-переформулировка (см. «Риски» в тикете DTJ-100).
 */
import { Inject, Injectable } from '@nestjs/common'
import { sql, type SQL } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { medicines } from '@/db/schema/medicines.js'
import { medicineSubstances } from '@/db/schema/medicine-substances.js'
import {
  ANALOG_CANDIDATES_REPOSITORY,
  type AnalogCandidatesRepository,
} from '@/modules/catalog/application/ports/analog-candidates.port.js'

/**
 * Минимально допустимое значение `limit`. Меньшие значения бесполезны
 * (`LIMIT 0` → пустой результат) или невалидны (`LIMIT -1` → синтаксическая
 * ошибка Postgres). Именованная константа (C6).
 */
const MIN_VALID_LIMIT = 1

@Injectable()
export class AnalogCandidatesAdapter implements AnalogCandidatesRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async findCandidates(
    referenceMedicineId: string,
    limit: number,
  ): Promise<readonly string[]> {
    const effectiveLimit = clampLimit(limit)
    const query = buildCandidatesQuery(referenceMedicineId, effectiveLimit)
    const rows = await this.db.execute<{ readonly id: string }>(query)
    return extractIdRows(rows)
  }
}

/**
 * Нормализация результата `db.execute<T>` для разных драйверов Drizzle.
 * `node-postgres` возвращает `{ rows: T[] }`; Drizzle оборачивает в
 * `{ rows: T[] }` независимо от драйвера, но для устойчивости к будущим
 * изменениям API проверяем оба варианта.
 */
function extractIdRows(result: unknown): readonly string[] {
  if (Array.isArray(result)) {
    return result.map((row) => (row as { readonly id: string }).id)
  }
  if (result !== null && typeof result === 'object' && 'rows' in result) {
    const rows: unknown = (result as Record<string, unknown>).rows
    if (Array.isArray(rows)) {
      return rows.map((row) => (row as { readonly id: string }).id)
    }
  }
  return []
}

/**
 * Нижний клампинг `limit`: `limit < 1` → `1`. Верхняя граница —
 * политика вызывающего (DTJ-101 передаёт `ANALOG_CANDIDATES_LIMIT = 50`).
 */
function clampLimit(limit: number): number {
  return limit >= MIN_VALID_LIMIT ? limit : MIN_VALID_LIMIT
}

/**
 * SQL из SRS-CAT-043 (запрос 3, модифицированный — без JOIN на
 * `pharmacy_inventory`/`pharmacies`, эта часть ответственности DTJ-101).
 *
 * Drizzle 0.45 `${param}` в `sql`-шаблонах параметризует примитивы через
 * pg-протокол, НЕ интерполирует в строку SQL — безопасно от инъекций.
 *
 *   SELECT id
 *   FROM medicines
 *   WHERE id != :ref AND is_published
 *     AND control_category NOT IN ('psychotropic','narcotic')
 *     AND dosage_form_class = (SELECT dosage_form_class FROM medicines WHERE id = :ref)
 *     AND (SELECT array_agg(substance_id ORDER BY substance_id)
 *          FROM medicine_substances WHERE medicine_id = medicines.id)
 *         = (SELECT array_agg(substance_id ORDER BY substance_id)
 *            FROM medicine_substances WHERE medicine_id = :ref)
 *   LIMIT :limit;
 */
function buildCandidatesQuery(referenceMedicineId: string, effectiveLimit: number): SQL {
  return sql`
    SELECT ${medicines.id} AS id
    FROM ${medicines}
    WHERE ${medicines.id} != ${referenceMedicineId}
      AND ${medicines.isPublished} = true
      AND ${medicines.controlCategory} NOT IN ('psychotropic', 'narcotic')
      AND ${medicines.dosageFormClass} = (
        SELECT ${medicines.dosageFormClass}
        FROM ${medicines} AS m_ref
        WHERE m_ref.id = ${referenceMedicineId}
      )
      AND (
        SELECT array_agg(ms2.substance_id ORDER BY ms2.substance_id)
        FROM ${medicineSubstances} AS ms2
        WHERE ms2.medicine_id = ${medicines.id}
      ) = (
        SELECT array_agg(ms.substance_id ORDER BY ms.substance_id)
        FROM ${medicineSubstances} AS ms
        WHERE ms.medicine_id = ${referenceMedicineId}
      )
    LIMIT ${effectiveLimit}
  `
}

/**
 * DI-привязка: провайдер для `ANALOG_CANDIDATES_REPOSITORY` (D-27).
 */
export const ANALOG_CANDIDATES_REPOSITORY_PROVIDER = {
  provide: ANALOG_CANDIDATES_REPOSITORY,
  useClass: AnalogCandidatesAdapter,
} as const