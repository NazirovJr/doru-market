/**
 * Drizzle-схема `pharmacy_api_keys` (EP-05, DTJ-142, п.4 + EP-03 SRS-ADM-043..046).
 *
 * API-ключи для 1С/ERP-интеграций, HMAC-аутентификация push-канала
 * синхронизации остатков (EP-05, `PharmacyApiKeyGuard`, DTJ-156).
 *
 * **ВНИМАНИЕ — КООРДИНАЦИЯ С EP-03 (onboarding):**
 * Этот файл создан EP-05, потому что DTJ-142 (EP-05) требует таблицу для
 * `pharmacy_id`/`chain_id`/`chk_pharmacy_api_keys_exactly_one_scope`. EP-03
 * (DTJ-064+) владЕЕТ CRUD-эндпоинтами ключей (`POST/GET/PATCH /api-keys`,
 * SRS-ADM-043..046) и UI выдачи. EP-03 при интеграции:
 *   - НЕ пересоздаёт таблицу (этот файл уже создаст её миграцией 0015a).
 *   - ДОПОЛНЯЕТ поля (например, `description`, `expires_at`, `last_used_at`,
 *     `created_by_admin_id`) своими последующими миграциями.
 *   - Реализует CRUD на уровне presentation/application.
 *
 * **Скоуп ключа (EP-05, DTJ-142):**
 *   - Либо `pharmacy_id` заполнен, `chain_id` NULL — ключ для конкретной аптеки.
 *   - Либо `chain_id` заполнен, `pharmacy_id` NULL — ключ для ВСЕЙ сети
 *     (используется сетью, отправляющей остатки сразу за несколько аптек).
 *   - РОВНО одно из двух заполнено — CHECK `chk_pharmacy_api_keys_exactly_one_scope`.
 *
 * **Хеш ключа:** `key_hash` хранит HMAC-вход (argon2 или SHA-256(bcrypt)),
 * НЕ сам секрет. Секрет возвращается клиенту ОДНОКРАТНО при создании
 * (SRS-ADM-043). Сравнение — constant-time на уровне адаптера (DTJ-156).
 */
import { sql } from 'drizzle-orm'
import { boolean, check, index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { pharmacies } from './pharmacies.js'
import { pharmacyChains } from './pharmacy-chains.js'

export const PHARMACY_API_KEYS_TABLE = 'pharmacy_api_keys'

// Drizzle ORM 0.45: третий параметр pgTable принимает массив; объектная форма остаётся
// доступной до 1.0, но в этой схеме используем массив ради тип-чека.
export const pharmacyApiKeys = pgTable(
  PHARMACY_API_KEYS_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    // DTJ-142, п.4: `pharmacy_id` БЕЗ `NOT NULL` (может быть NULL, если
    // ключ — на уровне сети). `chain_id` — без `NOT NULL` (может быть NULL,
    // если ключ — на уровне аптеки). CHECK ниже гарантирует «ровно одно».
    pharmacyId: uuid('pharmacy_id').references(() => pharmacies.id, { onDelete: 'cascade' }),
    chainId: uuid('chain_id').references(() => pharmacyChains.id, { onDelete: 'cascade' }),
    // Хеш секрета. `key_prefix` хранит первые 8 символов секрета (для
    // отображения оператору: `dorutj_xxxx...1234`). Полный секрет
    // НИКОГДА не хранится — только его необратимый хеш.
    keyHash: varchar('key_hash', { length: 255 }).notNull(),
    keyPrefix: varchar('key_prefix', { length: 16 }).notNull(),
    // `is_active` — `false` после отзыва (SRS-ADM-046). Мягкое удаление,
    // хеш остаётся в БД для аудита. Захардкоженный `default: true`.
    isActive: boolean('is_active').notNull().default(true),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Lookup при `PharmacyApiKeyGuard` (DTJ-156): `key_prefix` ищется
    // быстро, потом — `key_hash` (точный матч). `key_prefix` — короткий
    // префикс, индекс по нему НЕ даст выигрыша — индекс по `isActive`
    // отсекает отозванные ключи.
    index('ix_pharmacy_api_keys_active').on(table.isActive),
    index('ix_pharmacy_api_keys_pharmacy').on(table.pharmacyId),
    index('ix_pharmacy_api_keys_chain').on(table.chainId),
    // DTJ-142, п.4: CHECK «ровно один скоуп заполнен». XOR двух условий:
    // (pharmacy_id IS NOT NULL AND chain_id IS NULL) OR
    // (pharmacy_id IS NULL AND chain_id IS NOT NULL).
    check(
      'chk_pharmacy_api_keys_exactly_one_scope',
      sql`(${table.pharmacyId} IS NOT NULL AND ${table.chainId} IS NULL) OR (${table.pharmacyId} IS NULL AND ${table.chainId} IS NOT NULL)`,
    ),
  ],
)

export type PharmacyApiKeyRow = typeof pharmacyApiKeys.$inferSelect
export type PharmacyApiKeyInsert = typeof pharmacyApiKeys.$inferInsert
