-- =====================================================================================
-- 0033_payment_operations_webhook_event_types.sql — EP-10 (DTJ-242).
-- =====================================================================================
-- Сверено `ls apps/api/migrations/` + журнал непосредственно перед созданием файла (правило
-- из reports/EP09-CTO-BRIEF.md — последняя занятая 0032, DTJ-241).
--
-- `HandlePaymentWebhookUseCase` (DTJ-242, SRS-DOM-164/SRS-PAY-022) вставляет ОТДЕЛЬНУЮ строку
-- `payment_operations` НА КАЖДЫЙ входящий банковский вебхук, `idempotency_key = bankEventId`
-- (ДРУГОЙ ключ, чем `create_bill`/`refund`-строка, созданная `PaymentProvider.createInvoice()`/
-- `refund()`, DTJ-238/239, `idempotency_key` = checkout-производная) — таблица уже несёт
-- ЭТУ строку по замыслу (`0029_payments.sql` COMMENT ON TABLE payment_operations: «для
-- webhook-обработки дублирующегося PAID_HOLD — банковский transaction_id»), но
-- `payment_operation_type` не нёс значения, ОТЛИЧНОГО ОТ `create_bill`/`refund` для этого
-- случая — переиспользование `create_bill` для строки, означающей «мы ПОЛУЧИЛИ подтверждение»
-- (а не «мы ЗАПРОСИЛИ создание»), было бы семантически неверным в финансовой таблице.
--
-- 4 новых значения — 1:1 `VerifiedWebhookPayload.type` (`bank-webhook-verifier.port.ts`,
-- DTJ-237): `payment_confirmed`/`payment_failed`/`refund_confirmed`/`refund_failed`.
--
-- ИДЕМПОТЕНТНОСТЬ: `ALTER TYPE ... ADD VALUE IF NOT EXISTS` — нативно поддержано PostgreSQL 12+
-- (проект — PostgreSQL 16, `01-TECH-BASELINE.md`), обёртка `DO $$ ... EXCEPTION` (как в
-- `0027`/`0028`) здесь НЕ нужна — `IF NOT EXISTS` уже даёт идемпотентность на уровне SQL.
--
-- ТРАНЗАКЦИОННОСТЬ (SRS-DB-009/11-database-schema.md): PostgreSQL 12+ разрешает `ALTER TYPE
-- ... ADD VALUE` ВНУТРИ транзакции — запрещено лишь ИСПОЛЬЗОВАТЬ новое значение (сравнение/
-- вставка/каст) В ТОЙ ЖЕ транзакции, где оно добавлено (`55P04 unsafe_use_of_new_value`). Этот
-- файл ТОЛЬКО добавляет значения, ничего не вставляет и не сравнивает — раннер проекта
-- (`drizzle-orm/node-postgres/migrator`, `src/infrastructure/database/migrate.ts`) не
-- поддерживает `-- disable-transaction`-пометку (проверено чтением его исходника — ВСЕ
-- ожидающие миграции идут в ОДНОЙ `session.transaction(...)`), поэтому спецификация
-- `11-database-schema.md` про отдельный файл «вне транзакции» — не то, что раннер реально
-- умеет; безопасность здесь обеспечивается тем, что ни СЕЙЧАС, ни в любой другой ожидающей
-- миграции этого прогона новое значение не используется — использование начинается только в
-- рантайме приложения (`HandlePaymentWebhookUseCase`), уже другим подключением/транзакцией,
-- строго ПОСЛЕ commit'а этой миграции.
-- =====================================================================================

ALTER TYPE payment_operation_type ADD VALUE IF NOT EXISTS 'payment_confirmed';
ALTER TYPE payment_operation_type ADD VALUE IF NOT EXISTS 'payment_failed';
ALTER TYPE payment_operation_type ADD VALUE IF NOT EXISTS 'refund_confirmed';
ALTER TYPE payment_operation_type ADD VALUE IF NOT EXISTS 'refund_failed';
