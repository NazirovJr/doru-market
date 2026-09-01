/**
 * Drizzle-схема `pharmacy_reliability_scores` (EP-06, DTJ-181, `SRS-CAT-066`,
 * `docs/spec/20-module-catalog-search.md` §14.1). Read-модель операционной
 * надёжности аптеки — единственный входной сигнал `reliabilityScore` формулы
 * ранжирования поиска (`SRS-CAT-018`, §3 того же документа). НЕ доменный
 * агрегат `PharmacyAccount`, НЕ публичный рейтинг с отзывами покупателей
 * (такой системы нет в scope R1) — UI-виджета звёзд для этой таблицы нет и
 * не планируется.
 *
 * **Владение записью (важно для код-ревью):** строки пишет ИСКЛЮЧИТЕЛЬНО
 * ежесуточная джоба `RecomputePharmacyReliabilityJob` (BullMQ repeatable,
 * 04:00 `Asia/Dushanbe`, `SRS-CAT-067`) — она принадлежит контексту
 * `analytics` (EP-17, волна 11) и НЕ входит в этот тикет. До её появления
 * (все волны 5-10) таблица пуста — это ОЖИДАЕМОЕ состояние, не баг
 * ранжирования: `PostgresSearchProvider` (DTJ-185) обязан читать эту
 * таблицу через `LEFT JOIN` + `COALESCE(prs.score, 3.5)` (`TC-CAT-028`),
 * дефолт `3.50` уже зашит в колонку ниже как нейтральное значение для
 * аптеки без истории/статистически недостоверной выборки
 * (`totalProcessingOrders < RELIABILITY_MIN_SAMPLE_SIZE = 20`).
 *
 * `score` — `NUMERIC(3,2)` в диапазоне `[0.00, 5.00]`, обеспечено
 * CHECK `chk_reliability_score_range` на уровне БД (не только приложения).
 */
import { sql } from 'drizzle-orm'
import { check, integer, numeric, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core'
import { pharmacies } from './pharmacies.js'

export const PHARMACY_RELIABILITY_SCORES_TABLE = 'pharmacy_reliability_scores'

export const pharmacyReliabilityScores = pgTable(
  PHARMACY_RELIABILITY_SCORES_TABLE,
  {
    pharmacyId: uuid('pharmacy_id')
      .primaryKey()
      .references(() => pharmacies.id, { onDelete: 'cascade' }),
    // Дефолт '3.50' — нейтральная надёжность для новой/безданных аптеки (SRS-CAT-067, TC-CAT-028).
    score: numeric('score', { precision: 3, scale: 2 }).notNull().default('3.50'),
    ordersConsidered: integer('orders_considered').notNull().default(0),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('chk_reliability_score_range', sql`${table.score} BETWEEN 0 AND 5`),
  ],
)

export type PharmacyReliabilityScoreRow = typeof pharmacyReliabilityScores.$inferSelect
export type PharmacyReliabilityScoreInsert = typeof pharmacyReliabilityScores.$inferInsert
