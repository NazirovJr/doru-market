-- =====================================================================================
-- 0038_support_ticket_sla_fields.sql — EP-14 (DTJ-278), SLA первого ответа + приоритет
-- support_tickets, append-only переписка по тикету. Волна 8, депендс на DTJ-270 (0037).
-- =====================================================================================
-- Номер сверен НЕПОСРЕДСТВЕННО перед созданием файла: `ls apps/api/migrations/` — последняя
-- запись на диске `0037_returns_disputes_support.sql` (эта же волна, DTJ-270), следующий
-- свободный — `0038`. Буквальное имя файла из тикета (`0011_support_ticket_sla_fields.sql`)
-- устарело — `0011` занят (`0011_pharmacy_chains_add_contact_phone_verified.sql`) с волны 2.
--
-- Источник — `docs/spec/27-module-admin-moderation-onboarding.md`, раздел «РАСШИРЕНИЕ
-- support_tickets [ДОПОЛНЕНИЕ §9 SRS-ADM-075/076 — SLA первого ответа, приоритет]» (строки
-- 986-994) — 1:1 транскрипция трёх `ALTER TABLE support_tickets ADD COLUMN`.
--
-- `tenant_settings.support_first_response_sla_minutes` — ДОПОЛНЕНИЕ сверх буквального текста
-- 27-module (та секция спеки не содержит эту колонку явно), но прямо предписано DTJ-278 «Что
-- сделать» п.1 и DTJ-279 «Риски»: SRS-ADM-075 упоминает 60 минут как ASSUMPTION-константу
-- (`SUPPORT_FIRST_RESPONSE_SLA_MINUTES`), но «конфигурация без деплоя» (Charter §3.4) требует
-- per-tenant поля, не константы в коде — используется `CreateSupportTicketUseCase` (DTJ-279,
-- эта же миграционная группа по прямому указанию обоих тикетов).
--
-- `support_ticket_messages` — ДОПОЛНЕНИЕ сверх буквы спецификации (ни один документ
-- `docs/spec/` не определяет таблицу для хранения переписки по тикету — DTJ-278 «Риски»
-- явно фиксирует это как осознанное расширение, необходимое для физической реализуемости
-- SRS-ADM-075 «первый комментарий support_agent фиксирует first_responded_at» — нужен
-- физический источник события «комментарий», не только смена статуса). `author_role` —
-- существующий enum `user_role` (0002_enums.sql, EP-01), новый тип не создаётся.
--
-- Идемпотентность (правило 11 AGENTS.md): `ADD COLUMN IF NOT EXISTS` — нативно идемпотентно
-- (PostgreSQL 9.6+, доступно на любой версии этого проекта), `CREATE TABLE IF NOT EXISTS` —
-- то же самое, `COMMENT ON` — идемпотентно нативно.
-- =====================================================================================

ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS first_response_due_at TIMESTAMPTZ;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS first_responded_at TIMESTAMPTZ;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS priority SMALLINT NOT NULL DEFAULT 0;
COMMENT ON COLUMN support_tickets.first_response_due_at IS
    'SRS-ADM-075: SLA тикета, НЕЗАВИСИМЫЙ от order_disputes.resolution_due_at (тот существует только '
    'для is_escrow_blocking=true, недостижимо в R1 согласно SRS-ADM-053).';

ALTER TABLE tenant_settings
    ADD COLUMN IF NOT EXISTS support_first_response_sla_minutes INT NOT NULL DEFAULT 60;
COMMENT ON COLUMN tenant_settings.support_first_response_sla_minutes IS
    'SRS-ADM-075: ASSUMPTION-константа SUPPORT_FIRST_RESPONSE_SLA_MINUTES=60 из спеки, вынесена в '
    'per-tenant конфигурацию (Charter §3.4 — конфигурация без деплоя), не захардкожена в коде. '
    'Читается CreateSupportTicketUseCase (DTJ-279).';

-- =====================================================================================
-- support_ticket_messages [ДОПОЛНЕНИЕ — append-only переписка по тикету, см. header выше]
-- =====================================================================================
CREATE TABLE IF NOT EXISTS support_ticket_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    author_role user_role NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE support_ticket_messages IS
    'Append-only история переписки по тикету — физический источник «первый комментарий '
    'support_agent» для support_tickets.first_responded_at (SRS-ADM-075). Не входит в буквальный '
    'DDL 11-database-schema.md — осознанное дополнение DTJ-278 (см. header-комментарий миграции).';

CREATE INDEX IF NOT EXISTS ix_support_ticket_messages_ticket_created
    ON support_ticket_messages (ticket_id, created_at);
