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

/**
 * Статус заказа (EP-09, DTJ-220, SRS-DB-008/009, D-25). Создан миграцией
 * `0023_orders_cart.sql` (enum `order_status` не существовал в БД ни в одной
 * предыдущей миграции — проверено CTO, `reports/EP09-CTO-BRIEF.md` D-EP09-2).
 * Порядок значений — 1:1 с каноническим DDL (`11-database-schema.md`
 * строки 107-116). `confirmed` [D-25]: `cash_courier`-заказ переходит сюда
 * СИНХРОННО из `Order.create()`, НЕ в `paid_escrow` — `paid_escrow` достижим
 * только из `pending_payment` по подписанному вебхуку банка (EP-10).
 * Порядок значений НЕ переименовывать, только дописывать в конец.
 */
export const orderStatusEnum = pgEnum('order_status', [
  'pending_payment',
  'confirmed',
  'paid_escrow',
  'processing',
  'picked_up',
  'delivered',
  'cancelled',
  'refunded',
  'return_in_progress',
])

/**
 * Escrow-ledger — тип проводки двойной записи (EP-10, DTJ-236, D-02, SRS-DOM-031..035,
 * SRS-PAY-010). Создан миграцией `0029_payments.sql`, DDL 1:1 `11-database-schema.md`
 * строки 824-827. `cash_courier`-заказы НИКОГДА не порождают строк этой таблицы (§4.6
 * `21-module-orders-payments-escrow.md`, REQ-PAY-14) — enum существует независимо от того,
 * достижим ли он для конкретного заказа.
 * Порядок значений НЕ переименовывать, только дописывать в конец.
 */
export const escrowEntryTypeEnum = pgEnum('escrow_entry_type', [
  'hold_created',
  'platform_fee_captured',
  'captured_to_pharmacy',
  'refunded_to_customer',
  'partially_refunded',
  'adjustment',
])

/** Знак проводки эскроу-ledger (EP-10, DTJ-236, SRS-DOM-067) — знак вне `Money`, отдельным полем. */
export const escrowEntryDirectionEnum = pgEnum('escrow_entry_direction', ['debit', 'credit'])

/**
 * Статус строки `payout_schedule` (EP-10, DTJ-236, D-02/D-03/D-24, REQ-PAY-6). `disputed`
 * исключает строку из выборки `PayoutSchedulerJob`/`PayoutExecutionJob` самим фактом другого
 * значения `status` (REQ-DISPUTE-4, §6.2 `21-module-orders-payments-escrow.md`) — без
 * дополнительного `WHERE status != 'disputed'`.
 * Порядок значений НЕ переименовывать, только дописывать в конец.
 */
export const payoutStatusEnum = pgEnum('payout_status', ['pending', 'due', 'disputed', 'paid', 'reversed'])

/**
 * Тип операции `payment_operations` (EP-10, DTJ-236, REQ-PAY-8) — идемпотентность вызовов
 * `PaymentProvider` (createInvoice/refund/partialRefund/capturePreauth/voidPreauth).
 * Порядок значений НЕ переименовывать, только дописывать в конец.
 */
export const paymentOperationTypeEnum = pgEnum('payment_operation_type', [
  'create_bill',
  'refund',
  'partial_refund',
  'capture_preauth',
  'void_preauth',
  // ДОБАВЛЕНО (DTJ-242, миграция `0033_payment_operations_webhook_event_types.sql`) —
  // идемпотентность ВХОДЯЩЕГО вебхука (`payment_operations.idempotency_key = bankEventId`,
  // SRS-DOM-164/SRS-PAY-022) — ДРУГАЯ строка, чем `create_bill`/`refund` (исходящий вызов
  // `PaymentProvider`, DTJ-238/239): значения 1:1 `VerifiedWebhookPayload.type`
  // (`bank-webhook-verifier.port.ts`), дописаны В КОНЕЦ (комментарий выше — не переименовывать).
  'payment_confirmed',
  'payment_failed',
  'refund_confirmed',
  'refund_failed',
])

/** Статус строки `payment_operations` (EP-10, DTJ-236, REQ-PAY-8). */
export const paymentOperationStatusEnum = pgEnum('payment_operation_status', ['pending', 'succeeded', 'failed'])

/**
 * Тип B2B-инвойса `platform_billing_invoices` (EP-10, DTJ-251, REQ-MON-6). Создан миграцией
 * `0038_platform_billing_invoices.sql` — таблица НЕ входила в базовую схему DTJ-236 вопреки
 * тексту тикета DTJ-251 (проверено, см. JSDoc миграции). `whitelabel_license`/
 * `whitelabel_royalty` — заготовки будущих эпиков (R2+), ЭТОТ тикет заполняет ТОЛЬКО
 * `cash_courier_commission`.
 * Порядок значений НЕ переименовывать, только дописывать в конец.
 */
export const billingInvoiceTypeEnum = pgEnum('billing_invoice_type', [
  'cash_courier_commission',
  'whitelabel_license',
  'whitelabel_royalty',
])

/**
 * Статус `platform_billing_invoices` (EP-10, DTJ-251, REQ-MON-6/7). `draft` → `issued`
 * (`CashCommissionAggregationJob`, конец недели) → `paid`/`overdue` (`BillingInvoiceOverdueJob`,
 * DTJ-252, ВНЕ периметра этого тикета) → `void` (ручная отмена, вне периметра R1).
 * Порядок значений НЕ переименовывать, только дописывать в конец.
 */
export const billingInvoiceStatusEnum = pgEnum('billing_invoice_status', ['draft', 'issued', 'paid', 'overdue', 'void'])
