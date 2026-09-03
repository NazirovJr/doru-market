-- =====================================================================================
-- 0034_support_tickets_audit_log.sql — EP-10 (DTJ-247), физическое основание для
-- `EscrowReconciliationJob` (`apps/worker/src/jobs/payout/escrow-reconciliation.job.ts`).
-- =====================================================================================
-- НЕ буквальный `files_owned` DTJ-247 (тикет называет только `escrow-reconciliation.job.ts` и
-- `escrow-ledger-imbalance.metric.ts`) — правка того же владельца по необходимости (правило 11
-- AGENTS.md, тот же приём, что DTJ-240 добавил `escrow-ledger-repository.port.ts` сверх
-- буквального списка): джоба обязана писать `support_tickets`/`audit_log`
-- (`21-module-orders-payments-escrow.md` §4.3, SRS-PAY-013), НИ ОДНА из этих таблиц не
-- существует ни в одной предыдущей миграции — обнаружено при реализации, не домыслено (см.
-- `migrations/0031_app_role_privileges.sql` строка 24: «audit_log ЕЩЁ НЕ СУЩЕСТВУЕТ, придёт с
-- EP-16»). Полный набор обеих сущностей (`order_disputes`, `dispute_status_history`,
-- `onboarding_review_log`-подобная специфика споров) — ВНЕ периметра: создаются ТОЛЬКО две
-- таблицы, реально нужные ЭТОЙ джобе, не весь Группы I/J каталог разом (правило 7 AGENTS.md —
-- не работа другого тикета/эпика).
--
-- Номер сверен НЕПОСРЕДСТВЕННО перед созданием файла: `ls apps/api/migrations/` и
-- `meta/_journal.json` — последняя запись `0033_payment_operations_webhook_event_types`
-- (приземлилась параллельно, DTJ-242/243, другой исполнитель, во время ЭТОЙ сессии), следующий
-- свободный — `0034`.
--
-- DDL — 1:1 транскрипция `docs/spec/11-database-schema.md`:
--   - enum'ы `support_ticket_channel`/`support_ticket_category`/`support_ticket_status`
--     (строки 149-154), `audit_action_category` (строки 221-224).
--   - `support_tickets` (строки 966-978) — БЕЗ `order_disputes`-специфичных полей (та таблица
--     вне периметра, см. выше).
--   - `audit_log` (строки 1287-1299).
--
-- ПРИВИЛЕГИИ РОЛИ (SRS-DB-024, буквальное указание `0031_app_role_privileges.sql` строки 24-29):
-- `audit_log` — append-only, ОБЯЗАНА сразу после `CREATE TABLE` явно `REVOKE UPDATE, DELETE
-- FROM app_role` (общий `ALTER DEFAULT PRIVILEGES` из 0031 иначе выдал бы ей полный CRUD, как
-- любой обычной таблице). `support_tickets` — ОБЫЧНАЯ таблица (не append-only: статус
-- открыт→закрыт мутирует существующую строку, REQ-DISPUTE-1) — получает штатный полный CRUD
-- через уже действующий `ALTER DEFAULT PRIVILEGES FOR ROLE dorutj_migrator`, здесь ничего
-- дополнительно не нужно.
--
-- ИНДЕКС `escrow_ledger.created_at` (тикет DTJ-247, раздел «Риски», буквальное указание —
-- «проверить, что индекс уже есть в базовой миграции DTJ-236; если отсутствует — добавить в
-- рамках этого тикета»): проверено (`grep -rn "CREATE INDEX.*escrow_ledger" migrations/*.sql`)
-- — индекса НЕТ ни в `0029_payments.sql`, ни где-либо ещё. `EscrowReconciliationJob` сканирует
-- `WHERE created_at >= NOW() - INTERVAL '1 day'` ежедневно — добавлен здесь.
--
-- Идемпотентность (правило 11 AGENTS.md): `CREATE TYPE` обёрнут в `DO $$ ... EXCEPTION WHEN
-- duplicate_object THEN NULL; END $$;` (тот же приём, что `0029_payments.sql`). `CREATE TABLE
-- IF NOT EXISTS`/`CREATE INDEX IF NOT EXISTS`/`COMMENT ON` идемпотентны нативно. `REVOKE`
-- идемпотентен нативно (повторный REVOKE непривилегии — no-op, не ошибка).
-- =====================================================================================

DO $$ BEGIN
  CREATE TYPE "support_ticket_channel" AS ENUM ('in_app', 'telegram_bot', 'phone', 'system_auto');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "support_ticket_category" AS ENUM (
    'order_not_received', 'payment_issue', 'order_item_damaged_or_expired',
    'order_quality_defect', 'courier_conduct', 'other'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "support_ticket_status" AS ENUM ('open', 'in_progress', 'resolved', 'closed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "audit_action_category" AS ENUM (
    'payment_override', 'return_override', 'dispute_resolution', 'prescription_access',
    'control_category_change', 'onboarding_decision', 'force_cancel_order', 'ledger_adjustment'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =====================================================================================
-- support_tickets [РАСШИРЕНИЕ REQ-DISPUTE-1 — канало-независимое обращение]
-- =====================================================================================
CREATE TABLE IF NOT EXISTS support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL, -- NULL для обращений не по заказу
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel support_ticket_channel NOT NULL,
    category support_ticket_category NOT NULL,
    is_escrow_blocking BOOLEAN NOT NULL DEFAULT false, -- true => атомарно порождает order_disputes (вне периметра этой миграции)
    status support_ticket_status NOT NULL DEFAULT 'open',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL, -- NULL для channel='system_auto'
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE support_tickets IS
    'SupportTicket aggregate (REQ-DISPUTE-1). system_auto создаётся автоматически при просрочке '
    'delivery_sla (REQ-DISPUTE-16) или расхождении реконсиляции ledger (REQ-DISPUTE-17, '
    'EscrowReconciliationJob, DTJ-247). order_disputes (атомарное порождение при '
    'is_escrow_blocking=true) — вне периметра этой миграции, заводится тикетом EP-11/14.';

CREATE INDEX IF NOT EXISTS ix_support_tickets_order_category_status
    ON support_tickets (order_id, category, status);

-- =====================================================================================
-- audit_log [РАСШИРЕНИЕ Часть C п.13 — неизменяемый журнал действий над заказами/деньгами/рецептами]
-- =====================================================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category audit_action_category NOT NULL,
    entity_type VARCHAR(50) NOT NULL, -- 'order' | 'prescription' | 'escrow_ledger' | ...
    entity_id UUID NOT NULL,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL, -- 'admin_payment_override' | 'view_prescription_image' | ...
    reason TEXT, -- ОБЯЗАТЕЛЕН для payment_override/return_override/ledger_adjustment (application-уровень)
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb, -- requestId, tenantId, до/после значения (без PII в открытом виде)
    request_id UUID, -- корреляция с pino-логами (Charter §5)
    tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE audit_log IS
    'Неизменяемый (append-only, НЕТ UPDATE/DELETE — ни в прикладном коде, ни на уровне роли БД, '
    'см. REVOKE ниже) журнал: admin_payment_override, admin_return_override, доступ к '
    'prescription_image_url, изменение control_category, решения онбординга, '
    'ledger.adjustment/ledger_adjustment (REQ-DISPUTE-19, EscrowReconciliationJob DTJ-247 — '
    'повторное обнаружение ТОГО ЖЕ расхождения добавляет НОВУЮ строку с инкрементированным '
    'metadata.repeatDetectionCount, не UPDATE существующей — append-only исключает UPDATE в '
    'принципе, SRS-PAY-042).';

CREATE INDEX IF NOT EXISTS ix_audit_log_entity ON audit_log (entity_type, entity_id, created_at);

-- Append-only на уровне привилегий роли (SRS-DB-024) — буквальное указание
-- `0031_app_role_privileges.sql` строки 24-29 (эта миграция была написана ЗАРАНЕЕ в ожидании
-- именно этого шага). `escrow_ledger` уже сужен той миграцией; `audit_log` сужается здесь —
-- `to_regclass` не нужен (таблица только что создана ВЫШЕ в этом же файле).
REVOKE UPDATE, DELETE ON audit_log FROM app_role;

-- SRS-PAY-013/DTJ-247 «Риски»: `EscrowReconciliationJob` сканирует
-- `WHERE created_at >= NOW() - INTERVAL '1 day'` ежедневно — без индекса полное сканирование
-- растёт линейно с объёмом ledger. Индекс на `escrow_ledger.created_at` отсутствовал в
-- `0029_payments.sql`/во всех последующих миграциях (проверено `grep`, см. header файла).
CREATE INDEX IF NOT EXISTS ix_escrow_ledger_created_at ON escrow_ledger (created_at);
