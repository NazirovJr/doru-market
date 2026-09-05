-- =====================================================================================
-- 0039_returns_disputes_support.sql — EP-11/EP-14 (DTJ-270), скаффолдинг возвратов/споров/
-- поддержки. Волна 8, тикеты tickets/ep07-returns-disputes/DTJ-270..279.
-- =====================================================================================
-- Номер сверен НЕПОСРЕДСТВЕННО перед созданием файла: `ls apps/api/migrations/` — последняя
-- запись на диске `0036_orders_payment_window_expires_at.sql` (не зажурналирована, параллельный
-- поток Приоритета 1 её ещё не закрыл), следующий свободный — `0037`. Буквальное имя файла из
-- тикета (`0010_returns_disputes_support.sql`) устарело — `0010` занят
-- (`0010_otp_purpose_add_onboarding_contact.sql`) ещё на волне 2 (тот же класс расхождения,
-- что и `reports/EP11-EP14-CTO-BRIEF.md` D-EP11-2 уже фиксировал для номера 0023 на волне 5 —
-- каталог миграций продолжил расти, брифа условие «сверь перед мержем» выполнено заново).
--
-- Что УЖЕ существует (проверено запросом к `information_schema`/`pg_type` этой же БД перед
-- написанием файла, не только чтением миграций) и НЕ создаётся здесь повторно:
--   - таблица `support_tickets` (0034_support_tickets_audit_log.sql, DTJ-247) — минимальный набор
--     колонок для `EscrowReconciliationJob`; SLA-поля добавляет ALTER TABLE тикет DTJ-278
--     (0040_support_ticket_sla_fields.sql).
--   - enum'ы `support_ticket_channel`/`support_ticket_category`/`support_ticket_status`
--     (та же миграция 0034).
--   - таблица `audit_log` и enum `audit_action_category` (та же миграция, для EP-16) — не входит
--     в периметр этой миграции, только к сведению.
--   - таблица `payout_schedule` (0029_payments.sql, EP-10/DTJ-236) — включая колонку
--     `held_by_dispute_id UUID` БЕЗ FK, с комментарием в коде «FK добавлен ALTER TABLE после
--     CREATE TABLE order_disputes (группа F)» — это буквально ждало эту миграцию, FK ниже
--     применяется НЕ отложенно (в отличие от сценария, который описывал
--     `reports/EP11-EP14-CTO-BRIEF.md` D-EP11-1 на волне 5, когда ни `orders`, ни
--     `payout_schedule` ещё не существовали) — обе таблицы физически на месте на момент этой
--     миграции (волна 8, EP-09/EP-10 давно закрыты), прямой `ADD CONSTRAINT` применяется чисто.
--
-- Что создаётся здесь впервые (проверено `grep -rn "CREATE TYPE\|CREATE TABLE"
-- apps/api/migrations/*.sql` — ни разу не встречается ни для одного из следующих объектов):
--   - enum'ы `return_status`, `return_reason`, `return_disposition`, `dispute_status`
--     (`11-database-schema.md` строки 134-148).
--   - таблицы `order_returns`, `order_disputes`, `dispute_status_history` (та же спека,
--     строки 921-1034, «Группа F: Возвраты, споры, поддержка») — 1:1 транскрипция DDL,
--     включая все CONSTRAINT/COMMENT ON.
--   - частичные уникальные индексы `ux_order_returns_one_active`/`ux_order_disputes_one_active`
--     (спека, раздел «§4 Индексы», строки 1612-1620 — вне блока Группы F, но описаны в
--     COMMENT ON самих таблиц как «см. §4», перенесены сюда той же миграцией, а не отдельным
--     файлом, т.к. это тот же логический DDL-юнит).
--   - `ALTER TABLE payout_schedule ADD CONSTRAINT fk_payout_schedule_dispute` — см. абзац выше.
--
-- Осознанно ВНЕ периметра (решение Tech Lead для этого набора тикетов, зафиксировано в самом
-- DTJ-270 «Технический контекст» и подтверждено брифом D-EP11-6): `order_disputes`/
-- `dispute_status_history` заводятся здесь ТОЛЬКО как физический фундамент (правило «ретрофит
-- дороже»), без домена/use case/эндпоинтов поверх них — полный воркфлоу `OrderDispute` размечен
-- `04-SCOPE-DECISION-PIVOT.md` как R3-3 за флагом `disputes_workflow_enabled`. Модуль `disputes`
-- НЕ заводится этим тикетом.
--
-- Идемпотентность (правило 11 AGENTS.md, образец — `0034_support_tickets_audit_log.sql`):
-- `CREATE TYPE` обёрнут в `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
-- `CREATE TABLE IF NOT EXISTS`/`CREATE INDEX IF NOT EXISTS`/`COMMENT ON` идемпотентны нативно.
-- `ALTER TABLE ... ADD CONSTRAINT` НЕ идемпотентен нативно (PostgreSQL бросает `42710
-- duplicate_object` при повторном добавлении constraint с тем же именем) — обёрнут в тот же
-- `DO $$ ... EXCEPTION WHEN duplicate_object` приём, т.к. `42710` — тот же SQLSTATE-класс, что и
-- дубликат `CREATE TYPE`.
-- =====================================================================================

-- === D-09 / REQ-RET-1: возвраты (11-database-schema.md строки 134-142) ===
DO $$ BEGIN
  CREATE TYPE "return_status" AS ENUM (
    'return_requested', 'return_in_transit', 'returned_to_pharmacy',
    'return_confirmed', 'return_rejected'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "return_reason" AS ENUM (
    'defect', 'wrong_item', 'damaged_packaging', 'expired_or_near_expiry', 'undelivered',
    'refused_at_door', 'undeliverable', 'customer_dispute_post_delivery'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "return_disposition" AS ENUM ('restock', 'destroy', 'pending_inspection');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- === D-24 / REQ-DISPUTE: споры (11-database-schema.md строки 145-148) ===
DO $$ BEGIN
  CREATE TYPE "dispute_status" AS ENUM (
    'open', 'awaiting_customer', 'resolved_reject', 'resolved_refund_full',
    'resolved_refund_partial', 'resolved_adjustment'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =====================================================================================
-- order_returns [РАСШИРЕНИЕ D-09/REQ-RET-1..13]
-- =====================================================================================
CREATE TABLE IF NOT EXISTS order_returns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    status return_status NOT NULL DEFAULT 'return_requested',
    reason return_reason NOT NULL,
    disposition return_disposition, -- заполняется на return_confirmed/return_rejected
    initiated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    courier_id UUID, -- FK добавлен ALTER TABLE после CREATE TABLE couriers (группа H), обратный рейс
    courier_return_fee_diram BIGINT NOT NULL DEFAULT 0, -- REQ-RET-7: >0 независимо от вины/причины
    packaging_intact BOOLEAN, -- чек-лист фармацевта при return_confirmed/return_rejected
    checklist_notes TEXT,
    admin_override_reason TEXT, -- REQ-RET-9, обязателен при admin_return_override
    admin_override_by UUID REFERENCES users(id) ON DELETE SET NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    CONSTRAINT chk_order_returns_fee_nonneg CHECK (courier_return_fee_diram >= 0)
);
COMMENT ON TABLE order_returns IS
    'OrderReturn aggregate (SRS-DOM-052..056). Не более одного НЕТЕРМИНАЛЬНОГО возврата на order_id '
    '— см. частичный уникальный индекс ux_order_returns_one_active (§4). return_rejected НЕ '
    'терминален (REQ-RET-13): admin_return_override -> return_confirmed либо retryTransit() -> '
    'return_in_transit (append-only, старые строки не удаляются — новая попытка обновляет status '
    'этой же строки, история переходов — в audit_log, не в отдельной таблице для этой сущности).';
COMMENT ON COLUMN order_returns.disposition IS
    'restock (REQ-RET-3: упаковка цела + expiry_date>today+буфер + не cold_chain_breach_suspected) '
    'ИЛИ destroy (принудительно для control_category!=none — REQ-RET-4, ControlledSubstance'
    'MustBeDestroyedError) ИЛИ pending_inspection (переходное состояние до чек-листа).';

CREATE UNIQUE INDEX IF NOT EXISTS ux_order_returns_one_active
    ON order_returns (order_id)
    WHERE status NOT IN ('return_confirmed', 'return_rejected');

-- =====================================================================================
-- order_disputes [РАСШИРЕНИЕ D-24/REQ-DISPUTE-2..15] — фундамент, без домена/use case (D-EP11-6)
-- =====================================================================================
CREATE TABLE IF NOT EXISTS order_disputes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT, -- RESTRICT: спор переживает заказ юридически
    support_ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE RESTRICT,
    status dispute_status NOT NULL DEFAULT 'open',
    priority SMALLINT NOT NULL DEFAULT 0, -- эскалируется SlaBreachedEvent (REQ-DISPUTE-14)
    resolution_reason TEXT, -- NOT NULL проверяется CHECK при терминальном статусе (см. ниже)
    resolution_amount_diram BIGINT, -- заполнено для resolved_refund_partial/resolved_adjustment
    resolved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_by_role user_role, -- снэпшот роли на момент резолюции (для аудита self-dealing, REQ-DISPUTE-10)
    resolution_due_at TIMESTAMPTZ NOT NULL, -- SLA-таймер, приостанавливается в awaiting_customer (REQ-DISPUTE-15)
    sla_paused_at TIMESTAMPTZ, -- НЕ NULL пока status='awaiting_customer'
    tenant_refund_confirmed_at TIMESTAMPTZ, -- REQ-DISPUTE-11: обязателен для White-Label перед закрытием
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    CONSTRAINT chk_order_disputes_terminal_requires_reason CHECK (
        status NOT IN ('resolved_reject', 'resolved_refund_full', 'resolved_refund_partial', 'resolved_adjustment')
        OR (resolution_reason IS NOT NULL AND resolved_by_user_id IS NOT NULL)
    ) -- REQ-DISPUTE-13, SRS-DOM-060
);
COMMENT ON TABLE order_disputes IS
    'OrderDispute aggregate. Не более одного НЕТЕРМИНАЛЬНОГО спора на order_id — частичный '
    'уникальный индекс ux_order_disputes_one_active (§4, REQ-DISPUTE-3). resolved_adjustment '
    'допустим ТОЛЬКО когда связанный payout_schedule.status=''paid'' (пост-payout, REQ-DISPUTE-8) — '
    'проверяется application (DisputeAfterPayoutRequiresAdjustmentError), не БД-constraint (требует '
    'кросс-табличной проверки в момент перехода, не инвариант строки). Фундамент DTJ-270: домен/'
    'use case/эндпоинты поверх этой таблицы — R3-3 за флагом disputes_workflow_enabled '
    '(D-EP11-6), не входят в эту волну.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_order_disputes_one_active
    ON order_disputes (order_id)
    WHERE status IN ('open', 'awaiting_customer');

-- =====================================================================================
-- dispute_status_history [РАСШИРЕНИЕ REQ-DISPUTE-11/13 — append-only история переходов]
-- =====================================================================================
CREATE TABLE IF NOT EXISTS dispute_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispute_id UUID NOT NULL REFERENCES order_disputes(id) ON DELETE CASCADE,
    status_from dispute_status,
    status_to dispute_status NOT NULL,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE dispute_status_history IS
    'Append-only лог каждого перехода order_disputes.status, включая confirm-tenant-refund '
    '(REQ-DISPUTE-11: White-Label спор не закрывается, пока pharmacy_admin сети не подтвердит через '
    'выделенный эндпоинт — эта запись фиксирует именно момент confirm-tenant-refund отдельной строкой).';

-- =====================================================================================
-- payout_schedule.held_by_dispute_id — FK, отложенный до CREATE TABLE order_disputes (см. header)
-- =====================================================================================
DO $$ BEGIN
  ALTER TABLE payout_schedule
      ADD CONSTRAINT fk_payout_schedule_dispute
      FOREIGN KEY (held_by_dispute_id) REFERENCES order_disputes(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
