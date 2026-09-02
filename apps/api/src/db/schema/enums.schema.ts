/**
 * `enums.schema.ts` (EP-01, DTJ-013, SRS-DB-008/009) — ЕДИНЫЙ файл
 * `pgEnum` для всей БД.
 *
 * **ПРАВИЛО ДЛЯ ПОСЛЕДУЮЩИХ ЭПИКОВ:**
 * Дописывайте свои `pgEnum(...)` В ЭТОТ ФАЙЛ, не создавайте отдельный
 * `enums-{module}.schema.ts`. Конфликты при параллельной разработке
 * решаются rebase — файл только растёт вниз (только `export const ...Enum`).
 *
 * Источник: `10-domain-model.md` (роли), `SRS-DOM-080` (otp purposes),
 * `12-api-conventions-auth-tenancy.md` §4.1. Порядок значений — порядок
 * `CREATE TYPE`, для `user_role`/`otp_purpose` семантики не несёт
 * (в отличие от, например, `order_status`, см. `SRS-DB-049` — будущий
 * эпик, добавляющий `order_status` СЮДА ЖЕ, ОБЯЗАН прочитать `SRS-DB-049`/D-25).
 *
 * Добавление НОВОГО значения в СУЩЕСТВУЮЩИЙ enum (`ALTER TYPE ... ADD VALUE`)
 * — отдельная миграция ВНЕ транзакции, не редактирование этого файла.
 */
import { pgEnum } from 'drizzle-orm/pg-core'

/**
 * Роли пользователя (DTJ-013, EP-01). Расширение `support_agent` —
 * аддитивное для REQ-DISPUTE-18, не заменяет существующие.
 * Порядок значений НЕ переименовывать, только дописывать в конец.
 */
export const userRoleEnum = pgEnum('user_role', [
  'customer',
  'pharmacist',
  'courier',
  'pharmacy_admin',
  'super_admin',
  'support_agent',
])

/**
 * Назначение OTP-кода (DTJ-013, EP-01, SRS-DOM-080). `'onboarding_contact'`
 * добавлен в миграции `0010_otp_purpose_add_onboarding_contact.sql`
 * (DTJ-016 follow-up) — см. файлы миграций.
 */
export const otpPurposeEnum = pgEnum('otp_purpose', [
  'login',
  'delivery_handover',
  'onboarding_contact',
])

/**
 * Канал приёма остатков (EP-05, DTJ-142, SRS-INV-005). Используется в
 * `inventory_sync_batch.channel` для различения источника пачки синхронизации.
 * - `manual` — точечный ввод через UI кабинета аптеки.
 * - `excel`  — загрузка Excel/CSV файла.
 * - `rest`   — push от 1С/ERP через REST+HMAC.
 * Порядок значений НЕ переименовывать, только дописывать в конец.
 */
export const inventorySyncChannelEnum = pgEnum('inventory_sync_channel', [
  'manual',
  'excel',
  'rest',
])

/**
 * Тип синхронизации (EP-05, DTJ-142, SRS-INV-027). `delta` — добавочные
 * изменения (upsert конкретных партий), `full` — полный снапшот остатков
 * (с пагинацией по `page_number`/`is_last_page`, см. миграцию `0015a`).
 * Порядок значений НЕ переименовывать, только дописывать в конец.
 */
export const inventorySyncTypeEnum = pgEnum('inventory_sync_type', ['delta', 'full'])

/**
 * Статус пачки синхронизации (EP-05, DTJ-144, SRS-DOM-145..150). FSM:
 *   queued → processing → (completed_full_success | completed_partial_success | failed_validation)
 * Три терминальных статуса (`completed_*`, `failed_validation`) необратимы
 * (см. `inventory-sync-batch.entity.ts` `ALLOWED_TRANSITIONS`, SRS-DOM-150).
 * Переход `queued → completed_*` напрямую ЗАПРЕЩЁН (обязателен
 * `processing`).
 *
 * Реализация в Drizzle-схеме `inventory_sync_batch.status` — через
 * `varchar(32)` с TS-литералами (`{ enum: [...] }` в Drizzle), а НЕ
 * через `pgEnum` на уровне БД. CHECK `chk_inventory_sync_batch_status`
 * (см. миграцию 0012) уже ограничивает значения на стороне Postgres;
 * дополнительный `pgEnum` создал бы расхождение с уже применённой
 * `0012_inventory_foundation.sql`, где колонка `status VARCHAR(16)`.
 */

/**
 * Источник истины по кодам ошибок строк синхронизации — TS-юнион
 * `InventorySyncRowError['errorCode']` в
 * `inventory-sync-batch.repository.port.ts`. Таблица `inventory_sync_errors`
 * появится вместе с drizzle-адаптером `appendErrors` (DTJ-145) и должна
 * следовать конвенции `0012_inventory_foundation.sql` — `VARCHAR` + `CHECK`,
 * а не `pgEnum`.
 */
