-- =====================================================================================
-- 0032_payment_operations_invoice_cache.sql — EP-10 (DTJ-241).
-- =====================================================================================
-- Сверено `ls apps/api/migrations/` + журнал непосредственно перед созданием файла
-- (правило из reports/EP09-CTO-BRIEF.md §"Номер миграции DTJ-228..." — последняя занятая 0031).
--
-- `CreatePaymentInvoiceUseCase` (DTJ-241) реализует SRS-PAY-003 («проверить локально, затем
-- вызвать провайдера») ОДНИМ уровнем ВЫШЕ самого `PaymentProvider`-адаптера: перед вызовом
-- `PaymentProvider.createInvoice()` он ЧИТАЕТ `payment_operations` по `idempotency_key` — Given
-- строка уже несёт `provider_ref`/`qr_payload`/`expires_at` (счёт уже выставлен РАНЕЕ тем же
-- ключом), Then возвращает СОХРАНЁННЫЙ `InvoiceRef` БЕЗ повторного сетевого вызова. Столбцы
-- `provider_ref`/`status`/`amount_diram` уже существуют (0029_payments.sql) — этих двух не
-- хватает: `qr_payload`/`expires_at` в исходной схеме НЕ персистились (провайдер строил их на
-- лету при КАЖДОМ вызове, DTJ-238/239), поэтому кэш-хит без повторного сетевого вызова не мог
-- вернуть идентичный `InvoiceRef`.
--
-- Владелец записи: `CreatePaymentInvoiceUseCase` (`UPDATE ... WHERE idempotency_key = ?` СРАЗУ
-- после успешного `PaymentProvider.createInvoice()`) — НЕ сам `PaymentProvider`-адаптер
-- (`MockBankProvider`/`AlifMobiProvider`/`DcNextProvider`, DTJ-238/239 — их собственный
-- INSERT/`ON CONFLICT DO NOTHING` в `payment_operations` НЕ трогается этой миграцией и не
-- знает про эти колонки). Разделение владения намеренное — см. DISPUTED в отчёте сдачи
-- DTJ-241: буквальный текст тикета предписывал INSERT НА УРОВНЕ use case ДО вызова провайдера,
-- что конфликтовало бы с уже принятым `MockBankProvider.insertOrReuseOperation` (DTJ-238,
-- собственный INSERT ПОД ТЕМ ЖЕ idempotency_key) — вместо этого use case ЧИТАЕТ первым
-- (SRS-PAY-003 соблюдён), а пишет уже существующую строку, созданную провайдером.
--
-- Аддитивно: `NULL`-колонки, без backfill, откат тривиален (см. .down.sql).
ALTER TABLE payment_operations
  ADD COLUMN IF NOT EXISTS qr_payload TEXT;

ALTER TABLE payment_operations
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

COMMENT ON COLUMN payment_operations.qr_payload IS
    'DTJ-241, SRS-PAY-001/003: содержимое QR/deeplink счёта — персистится CreatePaymentInvoiceUseCase '
    'СРАЗУ после успешного PaymentProvider.createInvoice(), чтобы повторный вызов с ТЕМ ЖЕ '
    'idempotency_key вернул идентичный InvoiceRef без повторного сетевого вызова к банку. NULL, '
    'пока use case ещё не записал результат (например, провайдер уже вставил строку, но '
    'use case упал ДО собственной UPDATE — самоисцеляется следующим вызовом, см. JSDoc use case).';

COMMENT ON COLUMN payment_operations.expires_at IS
    'DTJ-241, SRS-PAY-001: срок действия QR/deeplink (провайдер-специфичный, '
    'capabilities().maxInvoiceValidityMinutes) — та же семантика, что qr_payload выше.';
