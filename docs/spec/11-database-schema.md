# DoruTJ — Схема базы данных (PostgreSQL 16 / Drizzle ORM)

> Владелец: Analyst (SRS). Статус: **BASELINE для фазы Analysis**.
> Приоритет источников при противоречии: `03-ARCHITECT-DECISIONS.md` (D-*) > `00-PROJECT-CHARTER.md`
> (CUJ-*, §) > `research/00-RESEARCH-DIGEST.md` (REQ-*) > `tz.log` (§ТЗ).
> **`docs/spec/10-domain-model.md` — ЗАКОН.** Каждая таблица ниже реализует конкретный агрегат/VO/
> state machine, описанный там; ссылки `SRS-DOM-*` указывают на конкретный инвариант, который эта
> таблица/constraint/индекс обеспечивает физически.
>
> Идентификаторы требований этого документа: **SRS-DB-nnn**. Каждый снабжён ссылкой на источник
> (`REQ-*`, `D-*`, `CUJ-*`, `SRS-DOM-*`, `§ТЗ`) и сформулирован как проверяемое условие (Given/When/
> Then — там, где применимо).
>
> Таблицы `tz.log §II.2` (`pharmacy_chains`, `pharmacies`, `medicines`, `pharmacy_inventory`, `orders`,
> `order_items`) реализованы **1:1 по именам и базовым полям** (Charter §5: «таблицы, ENUM'ы и поля из
> §II.2 ТЗ реализуются 1:1; расширения допускаются»). Расширяющие поля/таблицы помечены явно
> `[РАСШИРЕНИЕ]` со ссылкой на решение архитектора.

---

## Принципы

**SRS-DB-001** [Charter §3.1, D-24 контекст] **Первичные ключи** — `UUID`. Генерация: колонки,
пришедшие из `tz.log` дословно, сохраняют `DEFAULT gen_random_uuid()` (требует расширения
`pgcrypto`, включённого в §5). Все НОВЫЕ таблицы (расширения архитектора) используют **UUID v7**
(монотонно возрастающий, time-ordered) через прикладную генерацию портом `IdGenerator`
(`packages/contracts` → `infrastructure/adapters/uuid-v7-id-generator.adapter.ts`), а не
`gen_random_uuid()` (v4, немонотонный) — UUID v7 даёт лучшую локальность вставки в B-tree индекс
первичного ключа при высокой частоте вставок (`escrow_ledger`, `audit_log`, `outbox`). Колонка
всё равно объявляется `DEFAULT gen_random_uuid()` как **фолбэк на уровне БД** (миграции/сиды,
прямые `INSERT` в консоли), но прикладной код обязан передавать UUID v7 явно через `IdGeneratorPort`.

**SRS-DB-002** [Charter §5] Все временные колонки — `TIMESTAMPTZ` (`TIMESTAMP WITH TIME ZONE`), без
исключений, включая таблицы `tz.log` (там указан `TIMESTAMP WITH TIME ZONE` — уже соответствует).
Хранение — всегда UTC; конвертация в `Asia/Dushanbe` (UTC+5, без перехода на летнее время) —
исключительно на `presentation`-уровне (`Intl.DateTimeFormat` с `timeZone: 'Asia/Dushanbe'`) или в
SQL-запросах отчётности (`AT TIME ZONE 'Asia/Dushanbe'`), никогда не в domain/application.

**SRS-DB-003** [Charter §5, `10-domain-model.md` денежная конвенция] **Деньги, зафиксированные в
`tz.log` §II.2** (`price_tjs`, `items_total_tjs`, `delivery_fee_tjs`, `total_amount_tjs`,
`unit_price_tjs`, `total_price_tjs`) хранятся как `NUMERIC(10,2)` — тип и имя колонки сохранены 1:1.
**Все НОВЫЕ денежные поля** (комиссии, ledger, payout, courier-выплаты) называются с суффиксом
`_dirams` и хранятся как `BIGINT` (целые дирамы, `1 TJS = 100 diram`) — никогда `NUMERIC`, никогда
`FLOAT`/`DOUBLE PRECISION`. Конвертация `NUMERIC(10,2) ↔ BIGINT diram` происходит ИСКЛЮЧИТЕЛЬНО в
`infrastructure`-мапперах через `Money.fromDbDecimalTjs()`/`money.toDbDecimalTjs()`
(`10-domain-model.md` SRS-DOM-064/065) — приложение (domain/application) никогда не видит `NUMERIC`.
Это решает конфликт «схема 1:1 из ТЗ» vs «арифметика в целых дирамах» (Charter §5) без изменения
типов унаследованных колонок.

**SRS-DB-004** [Charter §5, комплаенс] **Soft delete** применяется ТОЛЬКО там, где нужен аудит
уже случившегося бизнес-события или юридическое хранение: `orders`, `order_items`, `prescriptions`,
`escrow_ledger` (append-only — soft delete неприменим, физически никогда не удаляется),
`audit_log` (неизменяем целиком), `medicines` (не удаляются — снимаются с публикации через
`is_published`), `pharmacies`/`pharmacy_chains` (жизненный цикл через `status`, не удаление),
`users` (`deleted_at`, право на удаление персональных данных). Механизм — колонка
`deleted_at TIMESTAMPTZ NULL`; запросы приложения обязаны фильтровать `WHERE deleted_at IS NULL`
через **общий репозиторный миксин** (`infrastructure/base/soft-deletable.repository.ts`), не через
ручной `WHERE` в каждом запросе. Справочные/конфигурационные таблицы (`categories`, `substances`,
`commission_rates`, `tenant_settings`) — БЕЗ soft delete, у них есть `is_active`/даты действия.
Чисто операционные/очередные таблицы (`otp_codes`, `refresh_tokens`, `cart`/`cart_items`,
`inventory_sync_batches`, `outbox`) — hard delete по TTL-джобе, аудит не требуется.

**SRS-DB-005** [Charter §5] Денежные CHECK-constraints пишутся на `NUMERIC`-колонках как `> 0`/`>= 0`
в самой БД (последний рубеж защиты, дублирует доменный инвариант, не заменяет его) — см. §6.

**SRS-DB-006** [Charter §3.4, изоляция тенантов] **Правило ON DELETE**:
- `ON DELETE CASCADE` — только для строгой композиции (child не существует без parent):
  `pharmacies.chain_id → pharmacy_chains.id` (как в `tz.log`), `order_items.order_id → orders.id`,
  `medicine_substances.medicine_id`, `inventory_batches.pharmacy_inventory_id`,
  `escrow_ledger.order_id`… — везде, где child — часть агрегата.
- `ON DELETE RESTRICT` — для справочников, на которые есть активные бизнес-ссылки:
  `pharmacy_inventory.medicine_id → medicines.id` (как в `tz.log` — нельзя удалить медикамент, пока
  на него есть остатки), `order_items.medicine_id → medicines.id` (нельзя удалить медикамент, если
  он упомянут хоть в одном историческом заказе — юридический аудит).
- `ON DELETE SET NULL` — для необязательных ссылок, потеря которых не рвёт целостность:
  `orders.courier_id` (курьер может быть деактивирован, история заказа остаётся),
  `medicines.category_id` не SET NULL (NOT NULL, см. ниже) — но `catalog_match_queue.resolved_by`.
- **Ни одна таблица в системе не использует физический `DELETE` для строк с деньгами или юридическим
  значением** — только табличные статусы/soft delete (SRS-DB-004). `pharmacy_chains`/`pharmacies`
  вообще не поддерживают `DELETE` на уровне прикладного кода (только `status = 'terminated'`);
  ограничение `ON DELETE CASCADE` на `pharmacies.chain_id` — защита от осиротевших строк при ручном
  вмешательстве DBA, не задействуется штатным код-путём.

**SRS-DB-007** [D-07] Расширения PostgreSQL, обязательные к включению в первой миграции (`0001_extensions.sql`):
`pgcrypto` (`gen_random_uuid()`), `pg_trgm` (fuzzy/триграммы, Charter ADR №1), `unaccent`
(нормализация диакритики для поиска), `btree_gin` (композитные GIN-индексы по скалярным + tsvector
колонкам).

---

## ENUM-типы

> Базовые enum'ы `tz.log` §II.2 сохранены дословно (значения не переименовываются — только
> аддитивное расширение списка значений, где это предписано решением архитектора). Каждый enum —
> отдельный `CREATE TYPE ... AS ENUM`, не `VARCHAR + CHECK` (кроме случаев, отмеченных явно, где
> нужна расширяемость без миграции типа — `ALTER TYPE ... ADD VALUE` необратим внутри транзакции
> в PG16, это учтено в §8 «Миграции»).

```sql
-- === Базовые enum'ы tz.log §II.2 (значения сохранены 1:1) ===

CREATE TYPE user_role AS ENUM (
    'customer', 'pharmacist', 'courier', 'pharmacy_admin', 'super_admin',
    'support_agent' -- [РАСШИРЕНИЕ REQ-DISPUTE-18] аддитивно, существующие значения не переименованы
);

CREATE TYPE order_status AS ENUM (
    'pending_payment',
    'confirmed', -- [РАСШИРЕНИЕ D-25] cash_courier: Order.create() синхронно переводит заказ сюда,
                 -- НЕ в paid_escrow (платёжного факта/escrow_ledger ещё не существует, SRS-DB-049/050)
    'paid_escrow', 'processing', 'picked_up', 'delivered', 'cancelled', 'refunded',
    'return_in_progress' -- [РАСШИРЕНИЕ REQ-RET-1, D-09] промежуточный статус до/после доставки
);

CREATE TYPE prescription_status AS ENUM (
    'uploaded', 'verified', 'rejected',
    'ocr_processing', 'auto_matched', 'needs_clarification' -- [РАСШИРЕНИЕ D-14, REQ-OCR]
);

-- === D-08: категория контроля оборота (закон РТ) ===
CREATE TYPE control_category AS ENUM ('none', 'prescription_only', 'potent', 'psychotropic', 'narcotic');

-- === D-02: эскроу-леджер (двойная запись, append-only) ===
CREATE TYPE escrow_entry_type AS ENUM (
    'hold_created', 'platform_fee_captured', 'captured_to_pharmacy',
    'refunded_to_customer', 'partially_refunded', 'adjustment' -- REQ-MON-2, REQ-DISPUTE-6/7/8
);
CREATE TYPE escrow_entry_direction AS ENUM ('debit', 'credit'); -- SRS-DOM-067: знак вне Money

-- === Payout schedule (выплата аптеке) ===
CREATE TYPE payout_status AS ENUM ('pending', 'due', 'disputed', 'paid', 'reversed');

-- === D-09 / REQ-RET-1: возвраты ===
CREATE TYPE return_status AS ENUM (
    'return_requested', 'return_in_transit', 'returned_to_pharmacy',
    'return_confirmed', 'return_rejected'
);
CREATE TYPE return_reason AS ENUM (
    'defect', 'wrong_item', 'damaged_packaging', 'expired_or_near_expiry', 'undelivered',
    'refused_at_door', 'undeliverable', 'customer_dispute_post_delivery'
);
CREATE TYPE return_disposition AS ENUM ('restock', 'destroy', 'pending_inspection');

-- === D-24 / REQ-DISPUTE: споры ===
CREATE TYPE dispute_status AS ENUM (
    'open', 'awaiting_customer', 'resolved_reject', 'resolved_refund_full',
    'resolved_refund_partial', 'resolved_adjustment'
);
CREATE TYPE support_ticket_channel AS ENUM ('in_app', 'telegram_bot', 'phone', 'system_auto');
CREATE TYPE support_ticket_category AS ENUM (
    'order_not_received', 'payment_issue', 'order_item_damaged_or_expired',
    'order_quality_defect', 'courier_conduct', 'other'
);
CREATE TYPE support_ticket_status AS ENUM ('open', 'in_progress', 'resolved', 'closed');

-- === D-06 / REQ-SYNC: очередь модерации матчинга каталога ===
CREATE TYPE catalog_match_queue_status AS ENUM ('pending_review', 'matched', 'created_new', 'rejected');

-- === D-11 / REQ-SYNC-1..12: приём 1С/Excel/ручных выгрузок ===
CREATE TYPE inventory_sync_channel AS ENUM ('rest_api', 'commerce_ml', 'excel_import', 'manual_entry');
CREATE TYPE inventory_sync_type AS ENUM ('full', 'delta');
CREATE TYPE inventory_sync_op AS ENUM ('upsert', 'delete');
CREATE TYPE inventory_sync_batch_status AS ENUM (
    'queued', 'processing', 'completed_full_success', 'completed_partial_success', 'failed_validation'
);
CREATE TYPE inventory_sync_row_error_code AS ENUM (
    'invalid_barcode', 'ambiguous_date_format', 'missing_required_field',
    'unmatched_medicine', 'skipped_stale', 'invalid_price', 'invalid_quantity'
);

-- === D-22 / REQ-ONBOARD: онбординг аптек и сетей ===
CREATE TYPE chain_onboarding_status AS ENUM (
    'draft', 'pending_review', 'changes_requested', 'approved', 'active', 'rejected', 'suspended', 'terminated'
);
CREATE TYPE pharmacy_onboarding_status AS ENUM (
    'draft', 'pending_review', 'changes_requested', 'approved', 'active', 'rejected', 'suspended', 'terminated'
);
CREATE TYPE pharmacy_suspension_reason AS ENUM (
    'license_expired', 'license_revoked', 'fraud_or_safety', 'policy_violation',
    'voluntary_pause', 'unpaid_invoice'
);
CREATE TYPE verification_status AS ENUM (
    'not_started', 'pending_review', 'changes_requested', 'verified', 'rejected'
);

-- === D-21 / REQ-COUR: курьеры ===
CREATE TYPE courier_sourcing_mode AS ENUM ('own_fleet', 'platform_pool', 'hybrid');
CREATE TYPE courier_status AS ENUM ('pending_verification', 'active', 'suspended', 'terminated');
CREATE TYPE courier_tax_status AS ENUM (
    'individual_patent', 'civil_contract_platform_withholds', 'chain_employee'
);
CREATE TYPE courier_vehicle_type AS ENUM ('foot', 'bicycle', 'moped', 'car');
CREATE TYPE courier_payout_batch_status AS ENUM ('draft', 'issued', 'paid', 'failed');
CREATE TYPE delivery_assignment_status AS ENUM (
    'unassigned', 'assigned', 'en_route_to_pharmacy', 'picked_up_from_pharmacy',
    'en_route_to_customer', 'delivered', 'delivery_failed'
);

-- === Платежи / провайдер ===
CREATE TYPE payment_method AS ENUM ('alif_mobi', 'dc_next', 'cash_courier');
CREATE TYPE payment_operation_type AS ENUM ('create_bill', 'refund', 'partial_refund', 'capture_preauth', 'void_preauth');
CREATE TYPE payment_operation_status AS ENUM ('pending', 'succeeded', 'failed');

-- === Billing (B2B) ===
CREATE TYPE billing_invoice_type AS ENUM ('cash_courier_commission', 'whitelabel_license', 'whitelabel_royalty');
CREATE TYPE billing_invoice_status AS ENUM ('draft', 'issued', 'paid', 'overdue', 'void');

-- === Прочее ===
CREATE TYPE notification_channel AS ENUM ('telegram', 'sms', 'web_push', 'email');
CREATE TYPE notification_status AS ENUM ('queued', 'sent', 'delivered', 'failed', 'suppressed_rate_limit');
CREATE TYPE dosage_unit AS ENUM ('mg', 'mcg', 'g', 'ml', 'iu', 'percent', 'mg_per_ml');
CREATE TYPE dosage_form_class AS ENUM (
    'tablet', 'capsule', 'syrup', 'injection', 'ointment', 'drops', 'inhaler', 'suppository', 'other'
);
CREATE TYPE audit_action_category AS ENUM (
    'payment_override', 'return_override', 'dispute_resolution', 'prescription_access',
    'control_category_change', 'onboarding_decision', 'force_cancel_order', 'ledger_adjustment'
);
CREATE TYPE otp_purpose AS ENUM ('login', 'delivery_handover');
CREATE TYPE outbox_status AS ENUM ('pending', 'published', 'failed');
```

**SRS-DB-008** [Charter §5, `02` §2.4] Каждый enum, управляющий state machine (`order_status`,
`prescription_status`, `return_status`, `dispute_status`, `delivery_assignment_status`,
`inventory_sync_batch_status`, `chain_onboarding_status`, `pharmacy_onboarding_status`,
`payout_status`), — это ЕДИНСТВЕННЫЙ источник допустимых значений; сами переходы валидируются в
domain (`10-domain-model.md` §«State machines»), БД лишь исключает попадание произвольной строки в
колонку (первый рубеж защиты).

**SRS-DB-009** [`02` §6, эксплуатация] Добавление нового значения в существующий enum —
`ALTER TYPE ... ADD VALUE 'x'` — выполняется отдельной миграцией ВНЕ транзакции (PostgreSQL
ограничение: новое значение enum нельзя использовать в той же транзакции, где оно добавлено).
Каждая такая миграция — отдельный файл `NNNN_enum_add_value_<name>.sql` с `-- disable-transaction`
пометкой для раннера миграций.
---

## Полный DDL

> Порядок таблиц ниже — топологический (без forward-reference там, где это возможно; там, где
> реальный домен требует цикла — например, `orders.courier_id` до определения `couriers` —
> FK добавляется отдельным `ALTER TABLE` в конце соответствующей группы, что и делает Drizzle-kit
> автоматически при генерации миграций из схемы). Таблицы `tz.log §II.2` помечены **[ТЗ 1:1]**.

### Группа A: Организации и каталог

```sql
-- =====================================================================================
-- 1. pharmacy_chains [ТЗ 1:1, расширено D-01/D-03/D-22/REQ-ONBOARD]
-- =====================================================================================
CREATE TABLE pharmacy_chains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    legal_entity_name VARCHAR(255) NOT NULL,
    tin_inn VARCHAR(20) NOT NULL UNIQUE,
    logo_url TEXT,
    is_whitelabel_active BOOLEAN DEFAULT false,
    custom_domain VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- [РАСШИРЕНИЕ REQ-ONBOARD-1/3, D-22] --
    legal_address TEXT,
    registration_certificate_url TEXT,
    director_full_name VARCHAR(255),
    contact_phone VARCHAR(20), -- формат PhoneNumber VO, +992XXXXXXXXX
    bank_account_ref TEXT, -- непрозрачная ссылка на мерчант-креды (не хранит секрет напрямую)
    payout_merchant_ref TEXT,
    is_whitelabel_requested BOOLEAN NOT NULL DEFAULT false,
    status chain_onboarding_status NOT NULL DEFAULT 'draft', -- REQ-ONBOARD-8
    tenant_id UUID, -- FK добавлен после CREATE TABLE tenants (ниже) — REQ-ONBOARD, Charter §3.4
    submitted_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE pharmacy_chains IS
    'Юрлицо-владелец 1..N аптек (SRS-DOM-047, PharmacyChain aggregate). Соло-аптека без сети '
    'заводится той же парой сущностей (REQ-ONBOARD-2) — отдельной ветки схемы нет.';
COMMENT ON COLUMN pharmacy_chains.status IS
    'chain_onboarding_status: draft->pending_review->(changes_requested)->approved->active->'
    '(suspended|terminated). approved->active — автоматический переход при первой active pharmacies (REQ-ONBOARD-9).';
COMMENT ON COLUMN pharmacy_chains.tin_inn IS
    'ИНН юрлица. Повторная заявка тем же tin_inn после rejected переиспользует запись (REQ-ONBOARD-19), не создаёт дубликат.';

-- =====================================================================================
-- 2. pharmacies [ТЗ 1:1, расширено REQ-ONBOARD/REQ-REG-8/REQ-DELIV-6]
-- =====================================================================================
CREATE TABLE pharmacies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chain_id UUID REFERENCES pharmacy_chains(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    address_text TEXT NOT NULL,
    landmark_tj TEXT, -- Ориентир на таджикском (пеши масчид)
    latitude NUMERIC(10, 8) NOT NULL,
    longitude NUMERIC(11, 8) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    is_24_7 BOOLEAN DEFAULT false,
    opening_time TIME,
    closing_time TIME,
    one_c_endpoint TEXT,
    is_active BOOLEAN DEFAULT true,
    -- [РАСШИРЕНИЕ REQ-ONBOARD-4] --
    license_number VARCHAR(100),
    license_issuing_authority VARCHAR(255),
    license_issue_date DATE,
    license_expiry_date DATE,
    license_scan_url TEXT,
    pharmacist_in_charge_name VARCHAR(255),
    status pharmacy_onboarding_status NOT NULL DEFAULT 'draft', -- REQ-ONBOARD-8
    suspension_reason pharmacy_suspension_reason,
    geo_point GEOGRAPHY(POINT, 4326), -- вычисляемая генерируемая колонка, см. §4 «Индексы»/GiST
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE pharmacies IS
    'Операционная точка (PharmacyAccount aggregate, 10-domain-model.md §«Агрегаты и сущности», '
    'инварианты SRS-DOM-047..051). status не может стать active, если родительская '
    'pharmacy_chains.status не в {approved,active} (SRS-DOM-048).';
COMMENT ON COLUMN pharmacies.license_expiry_date IS
    'Ежедневный скан (30/14/3 дня) эскалирует уведомления; по достижении даты — автоматический '
    'suspended(license_expired) без участия человека (REQ-ONBOARD-16).';
COMMENT ON COLUMN pharmacies.geo_point IS
    'GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) STORED — '
    'см. точное определение и обоснование GiST-индекса в §4.';

-- =====================================================================================
-- 3. categories [РАСШИРЕНИЕ — tz.log ссылается на medicines.category_id INT без определения таблицы]
-- =====================================================================================
CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    parent_id INT REFERENCES categories(id) ON DELETE SET NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    name_tj VARCHAR(255) NOT NULL,
    name_ru VARCHAR(255) NOT NULL,
    name_en VARCHAR(255) NOT NULL,
    commission_category VARCHAR(20) NOT NULL, -- 'rx' | 'otc' | 'parapharma' — база для platform_fee (D-03)
    sort_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true
);
COMMENT ON TABLE categories IS
    'Дерево категорий каталога. commission_category — грубая группировка для резолвинга ставки '
    'комиссии (platform_fee, SRS-DOM-160): rx/otc/parapharma, НЕ тождественна дереву навигации.';

-- =====================================================================================
-- 4. substances [РАСШИРЕНИЕ D-07]
-- =====================================================================================
CREATE TABLE substances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inn_name VARCHAR(255) NOT NULL UNIQUE, -- каноничное МНН одного действующего вещества
    inn_name_en VARCHAR(255), -- для моста INN<->USAN, REQ-CAT-3
    created_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE substances IS
    'Справочник действующих веществ (D-07). Один Medicine ссылается на 1..N substances через '
    'medicine_substances — решает проблему комбинированных препаратов (REQ-SAFETY-2).';

-- =====================================================================================
-- 5. medicines [ТЗ 1:1, расширено D-06/D-07/D-08]
-- =====================================================================================
CREATE TABLE medicines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_name VARCHAR(255) NOT NULL,
    inn_name VARCHAR(255) NOT NULL, -- Международное непатентованное название (денормализовано для отображения/поиска)
    barcode VARCHAR(64) UNIQUE,
    category_id INT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    dosage_form VARCHAR(100) NOT NULL, -- таблетки, сироп, ампулы (исходная строка tz.log, отображение)
    dosage_strength VARCHAR(100) NOT NULL, -- 500 мг, 10 мг/мл (исходная строка tz.log, отображение)
    manufacturer_country VARCHAR(100) NOT NULL,
    manufacturer_name VARCHAR(255) NOT NULL,
    is_prescription_required BOOLEAN DEFAULT false,
    storage_temperature VARCHAR(50),
    description_tj TEXT,
    description_ru TEXT,
    image_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- [РАСШИРЕНИЕ D-06/D-07/D-08] --
    dosage_form_class dosage_form_class NOT NULL DEFAULT 'other', -- SRS-DOM-079, укрупнённый класс для аналогов
    dosage_value NUMERIC(10, 4), -- SRS-DOM-077, парсинг dosage_strength
    dosage_unit dosage_unit, -- SRS-DOM-077
    control_category control_category NOT NULL DEFAULT 'none', -- D-08
    is_globally_identifiable_by_barcode BOOLEAN NOT NULL DEFAULT true, -- SRS-DOM-016 (false для internal-prefix/non-EAN13)
    is_published BOOLEAN NOT NULL DEFAULT false, -- SRS-DOM-013: Medicine.publish() требует substances.length>0
    requires_cold_chain BOOLEAN NOT NULL DEFAULT false, -- REQ-DELIV-6/REQ-REG-8
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('russian', unaccent(coalesce(trade_name, ''))), 'A') ||
        setweight(to_tsvector('russian', unaccent(coalesce(inn_name, ''))), 'A') ||
        setweight(to_tsvector('russian', unaccent(coalesce(manufacturer_name, ''))), 'C')
    ) STORED, -- см. §5 «Полнотекстовый поиск»
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_medicines_control_category_requires_rx
        CHECK (control_category NOT IN ('potent', 'psychotropic', 'narcotic') OR is_prescription_required = true)
        -- SRS-DOM-015: инвариант согласованности, дублирует доменную проверку
);
COMMENT ON TABLE medicines IS
    'Справочник медикаментов (Medicine aggregate). barcode валиден по EAN-13, но НЕ единственный '
    'ключ матчинга (D-06) — см. pharmacy_sku_mapping/catalog_match_queue.';
COMMENT ON COLUMN medicines.control_category IS
    'D-08: none/prescription_only/potent — заказываемы (potent требует Rx); psychotropic/narcotic — '
    'жёсткий запрет дистанционной продажи на уровне API (REQ-REG-4), не только UI.';
COMMENT ON COLUMN medicines.search_vector IS
    'Генерируемая колонка полнотекстового поиска, вес A — trade_name/inn_name, вес C — производитель. '
    'unaccent покрывает русскую диакритику; тадж. кириллица — см. §5 (кастомный unaccent-словарь).';

-- =====================================================================================
-- 6. medicine_substances [РАСШИРЕНИЕ D-07]
-- =====================================================================================
CREATE TABLE medicine_substances (
    medicine_id UUID NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
    substance_id UUID NOT NULL REFERENCES substances(id) ON DELETE RESTRICT,
    strength_value NUMERIC(10, 4) NOT NULL,
    strength_unit dosage_unit NOT NULL,
    PRIMARY KEY (medicine_id, substance_id),
    CONSTRAINT chk_medicine_substances_strength_positive CHECK (strength_value > 0)
);
COMMENT ON TABLE medicine_substances IS
    'Мост многие-ко-многим Medicine<->Substance с дозировкой конкретного вещества в составе '
    '(SRS-DOM-013/017). Множество substances препарата = ключ эквивалентности для аналогов (D-07).';
```
### Группа B: Остатки, партии и 1С-синхронизация

```sql
-- =====================================================================================
-- 7. pharmacy_inventory [ТЗ 1:1 как ключ агрегата, партии вынесены в inventory_batches]
-- =====================================================================================
CREATE TABLE pharmacy_inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID REFERENCES pharmacies(id) ON DELETE CASCADE,
    medicine_id UUID REFERENCES medicines(id) ON DELETE RESTRICT,
    -- price_tjs/stock_quantity/batch_number/expiry_date/last_synced_at из tz.log СОХРАНЕНЫ как
    -- вычисляемые/денормализованные проекции текущего FEFO-состояния (SRS-DOM-019/020), физический
    -- источник истины — inventory_batches (РАСШИРЕНИЕ REQ-SYNC-8: несколько партий на одну пару).
    price_tjs NUMERIC(10, 2) NOT NULL, -- денормализация: цена партии, выбранной по FEFO (триггер, см. §6)
    stock_quantity INT NOT NULL DEFAULT 0, -- денормализация: Σ(batch.quantity) непросроченных партий (триггер)
    batch_number VARCHAR(100), -- денормализация: batch_number партии, выбранной по FEFO
    expiry_date DATE NOT NULL, -- денормализация: expiry_date партии, выбранной по FEFO
    last_synced_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_pharmacy_medicine UNIQUE (pharmacy_id, medicine_id)
);
COMMENT ON TABLE pharmacy_inventory IS
    'Агрегат PharmacyInventory (ключ pharmacy_id+medicine_id, UNIQUE как в tz.log). Денормализованные '
    'price_tjs/stock_quantity/batch_number/expiry_date поддерживаются триггером trg_recompute_fefo '
    'на INSERT/UPDATE/DELETE inventory_batches (§6) — прикладной код НИКОГДА не пишет их напрямую.';

-- =====================================================================================
-- 8. inventory_batches [РАСШИРЕНИЕ REQ-SYNC-8 — множественные партии на одну пару]
-- =====================================================================================
CREATE TABLE inventory_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_inventory_id UUID NOT NULL REFERENCES pharmacy_inventory(id) ON DELETE CASCADE,
    batch_number VARCHAR(100) NOT NULL,
    price_diram BIGINT NOT NULL,
    quantity INT NOT NULL DEFAULT 0,
    expiry_date DATE NOT NULL,
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sync_source inventory_sync_channel NOT NULL DEFAULT 'manual_entry',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_batch_per_inventory UNIQUE (pharmacy_inventory_id, batch_number),
    CONSTRAINT chk_inventory_batches_quantity_nonneg CHECK (quantity >= 0),
    CONSTRAINT chk_inventory_batches_price_positive CHECK (price_diram > 0 OR quantity = 0) -- SRS-DOM-024
);
COMMENT ON TABLE inventory_batches IS
    'Партия товара (batch/lot), REQ-SYNC-8. stock_quantity видимый в каталоге = '
    'Σ(quantity) WHERE quantity>0 AND expiry_date>today (SRS-DOM-019); FEFO-цена/срок — партия с '
    'минимальным expiry_date среди непросроченных с quantity>0 (SRS-DOM-020).';
COMMENT ON COLUMN inventory_batches.last_synced_at IS
    'applyDelta() игнорирует входящую строку, если batchUpsert.sync_timestamp <= last_synced_at '
    '(SRS-DOM-022/169) — не откатывает более свежие данные, помечается skipped_stale, не ошибка.';

-- =====================================================================================
-- 9. pharmacy_sku_mapping [РАСШИРЕНИЕ REQ-SYNC-7 — кэш сопоставления]
-- =====================================================================================
CREATE TABLE pharmacy_sku_mapping (
    pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
    internal_sku VARCHAR(100) NOT NULL,
    medicine_id UUID NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
    matched_via VARCHAR(30) NOT NULL, -- 'exact_sku' | 'barcode' | 'fuzzy_trigram' | 'manual_review'
    matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (pharmacy_id, internal_sku)
);
COMMENT ON TABLE pharmacy_sku_mapping IS
    'Кэш «однажды сматченного» composite-матчинга (D-06): следующая выгрузка с тем же internal_sku '
    'пропускает шаги fuzzy/модерации, идёт напрямую по этому мосту. Обновляется CatalogFacade.'
    'resolveMedicineByComposite() только при первом успешном матчинге строки.';

-- =====================================================================================
-- 10. catalog_match_queue [РАСШИРЕНИЕ D-06]
-- =====================================================================================
CREATE TABLE catalog_match_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
    raw_barcode VARCHAR(64),
    raw_internal_sku VARCHAR(100),
    raw_trade_name VARCHAR(255) NOT NULL,
    raw_dosage_form VARCHAR(100),
    raw_dosage_strength VARCHAR(100),
    raw_manufacturer_name VARCHAR(255),
    raw_price_tjs NUMERIC(10, 2),
    fuzzy_candidate_medicine_id UUID REFERENCES medicines(id) ON DELETE SET NULL,
    fuzzy_similarity_score NUMERIC(4, 3), -- 0.000..1.000, pg_trgm similarity()
    status catalog_match_queue_status NOT NULL DEFAULT 'pending_review',
    resolved_medicine_id UUID REFERENCES medicines(id) ON DELETE SET NULL,
    resolved_by UUID, -- FK на users добавляется после CREATE TABLE users
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE catalog_match_queue IS
    'CatalogMatchQueueItem — неоднозначная строка выгрузки, не сматченная ни точным SKU, ни '
    'штрихкодом, ни fuzzy-порогом (D-06, шаг 4 composite-матчинга). Курируется оператором каталога '
    'в apps/admin (05 §ОВ.7).';

-- =====================================================================================
-- 11. inventory_sync_batches [РАСШИРЕНИЕ REQ-SYNC-1/3/12]
-- =====================================================================================
CREATE TABLE inventory_sync_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- = batch_id контракта (REQ-SYNC-1)
    pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
    channel inventory_sync_channel NOT NULL,
    sync_type inventory_sync_type NOT NULL,
    sync_timestamp TIMESTAMPTZ NOT NULL, -- из тела запроса 1С (не время приёма сервером)
    status inventory_sync_batch_status NOT NULL DEFAULT 'queued',
    total_rows INT NOT NULL,
    accepted_rows INT NOT NULL DEFAULT 0,
    rejected_rows INT NOT NULL DEFAULT 0,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT chk_sync_batches_row_limit CHECK (total_rows <= 1000) -- REQ-SYNC-4
);
COMMENT ON TABLE inventory_sync_batches IS
    'InventorySyncBatch aggregate (SRS-DOM-145..150). batch_id — идемпотентность повторной отправки '
    'того же батча 1С (REQ-SYNC-1, SRS-DOM-168): конфликт по PK возвращает сохранённый ранее ответ.';
COMMENT ON COLUMN inventory_sync_batches.sync_type IS
    'full: после приёма всех страниц выполняется обнуление позиций, отсутствующих в снапшоте '
    '(REQ-SYNC-3). delta: точечное upsert/delete без обнуления остального ассортимента.';

-- =====================================================================================
-- 12. inventory_sync_errors [РАСШИРЕНИЕ REQ-SYNC-9]
-- =====================================================================================
CREATE TABLE inventory_sync_errors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES inventory_sync_batches(id) ON DELETE CASCADE,
    row_index INT NOT NULL, -- позиция строки в исходном payload, для отчёта аптеке
    raw_row JSONB NOT NULL,
    error_code inventory_sync_row_error_code NOT NULL,
    error_detail TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE inventory_sync_errors IS
    'Построчные ошибки батча (REQ-SYNC-9: одна плохая строка не роняет весь батч). '
    'skipped_stale — ОЖИДАЕМЫЙ штатный случай (SRS-DOM-169), не сбой интеграции.';
```
### Группа C: Тенанты и идентичность

```sql
-- =====================================================================================
-- 13. tenants [РАСШИРЕНИЕ Charter §3.4, D-01]
-- =====================================================================================
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(32) NOT NULL UNIQUE, -- TenantSlug VO, ^[a-z0-9-]{3,32}$
    chain_id UUID REFERENCES pharmacy_chains(id) ON DELETE RESTRICT, -- NULL только для 'neutral'
    custom_domain VARCHAR(255) UNIQUE,
    is_neutral BOOLEAN NOT NULL DEFAULT false,
    courier_sourcing_mode courier_sourcing_mode NOT NULL DEFAULT 'platform_pool',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_tenants_neutral_has_no_chain CHECK (is_neutral = false OR chain_id IS NULL)
);
COMMENT ON TABLE tenants IS
    'Tenant aggregate. Ровно одна строка slug=''neutral'', is_neutral=true, chain_id NULL '
    '(SRS-DOM-042) — обеспечивается частичным уникальным индексом ux_tenants_single_neutral (§4). '
    'White-Label тенант ссылается на pharmacy_chains (D-01, Charter §3.4).';

-- =====================================================================================
-- 14. tenant_settings [РАСШИРЕНИЕ D-01/D-03/Charter §3.4]
-- =====================================================================================
CREATE TABLE tenant_settings (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    brand_name VARCHAR(255) NOT NULL, -- НИКОГДА не хардкодится в коде (D-01), только через i18n-ключ brand.name
    brand_logo_url TEXT,
    brand_palette JSONB NOT NULL DEFAULT '{}'::jsonb, -- CSS custom properties: {"--brand-primary": "#..."}
    telegram_bot_username VARCHAR(64),
    merchant_credentials_ref TEXT, -- непрозрачная ссылка в секрет-хранилище, НЕ сам секрет
    cod_limit_diram BIGINT NOT NULL DEFAULT 50000, -- D-16, дефолт 500 TJS
    hold_period_days INT NOT NULL DEFAULT 1, -- D-19, T+1 наличные / переопределяется per payment_method
    pickup_sla_minutes INT NOT NULL DEFAULT 7, -- tz.log Модуль 5, D-19
    pickup_sla_buffer_minutes INT NOT NULL DEFAULT 5, -- D-19
    delivery_sla_city_minutes INT NOT NULL DEFAULT 240, -- D-19, 4 часа
    delivery_sla_remote_minutes INT NOT NULL DEFAULT 1440, -- D-19, 24 часа
    dispute_window_hours INT NOT NULL DEFAULT 24, -- D-19
    inventory_delta_sla_minutes INT NOT NULL DEFAULT 5, -- D-04, диапазон 1..15
    return_restock_min_remaining_days INT NOT NULL DEFAULT 30, -- REQ-RET-3, ASSUMPTION
    default_locale VARCHAR(5) NOT NULL DEFAULT 'tj', -- REQ-UX-19
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_tenant_settings_sla_ranges CHECK (
        inventory_delta_sla_minutes BETWEEN 1 AND 15
        AND pickup_sla_minutes > 0
        AND cod_limit_diram >= 0
    )
);
COMMENT ON TABLE tenant_settings IS
    'TenantSettings value entity — брендинг + все per-tenant SLA/лимиты, редактируется в apps/admin '
    'без деплоя (Charter §3.4). Ставки комиссии/выплаты курьеру — В ОТДЕЛЬНЫХ таблицах platform_fee/ '
    'tenant_courier_payout_rules, здесь только courier_sourcing_mode (на tenants) как ссылка.';

-- =====================================================================================
-- 15. users [РАСШИРЕНИЕ — базовая аутентификация, tz.log подразумевает customer_id/pharmacist/courier без DDL]
-- =====================================================================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT, -- Charter §3.4, обязательный скоуп
    phone_number VARCHAR(20) NOT NULL, -- PhoneNumber VO, канонический вид +992XXXXXXXXX
    role user_role NOT NULL DEFAULT 'customer',
    full_name VARCHAR(255),
    pharmacy_id UUID REFERENCES pharmacies(id) ON DELETE SET NULL, -- заполнено для pharmacist/pharmacy_admin
    chain_id UUID REFERENCES pharmacy_chains(id) ON DELETE SET NULL, -- заполнено для pharmacy_admin сети
    telegram_chat_id BIGINT, -- захватывается при /start TWA (REQ-NOTIF-2)
    preferred_locale VARCHAR(5) NOT NULL DEFAULT 'tj', -- REQ-UX-19, сохраняется между сессиями
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ, -- soft delete (право на удаление ПДн)
    CONSTRAINT unique_phone_per_tenant UNIQUE (tenant_id, phone_number)
);
COMMENT ON TABLE users IS
    'Единая таблица идентичности для всех 6 ролей user_role (не разделена по ролям — различие в '
    'guard/policy application-слоя, не в схеме). Скоуп tenant_id обязателен (Charter §3.4, guard '
    'уровня репозитория запрещает запрос без резолва тенанта).';
COMMENT ON COLUMN users.phone_number IS
    'unique_phone_per_tenant, НЕ глобальный UNIQUE — один номер телефона может представлять разных '
    'людей в разных White-Label тенантах (изоляция арендаторов, Charter §3.4).';

-- =====================================================================================
-- 16. user_addresses [РАСШИРЕНИЕ REQ-GEO-3 — saved_address расширен]
-- =====================================================================================
CREATE TABLE user_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label VARCHAR(100), -- 'дом', 'работа'
    address_text TEXT NOT NULL,
    landmark_text TEXT, -- REQ-GEO-3, REQ-MARKET-10
    landmark_photo_url TEXT, -- REQ-GEO-3
    entrance VARCHAR(20),
    floor VARCHAR(20),
    apartment VARCHAR(20),
    latitude NUMERIC(10, 8) NOT NULL,
    longitude NUMERIC(11, 8) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE user_addresses IS
    'saved_address (REQ-GEO-3). Координаты — пин, поставленный пользователем вручную (REQ-GEO-2: '
    'Nominatim — только подсказка, не источник финальных координат).';

-- =====================================================================================
-- 17. otp_codes [РАСШИРЕНИЕ — OtpCode VO, персистентность]
-- =====================================================================================
CREATE TABLE otp_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purpose otp_purpose NOT NULL,
    subject_ref VARCHAR(255) NOT NULL, -- phone_number (login) или delivery_assignment_id (handover)
    code_hash TEXT NOT NULL, -- sha256(code + otpRequestId)-хеш кода, НЕ plaintext (Charter §5; SRS-API-021 — argon2 избыточен для короткоживущего 6-значного кода с TTL 300с, sha256 с солью otpRequestId достаточен и быстрее при высокой частоте верификации)
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ttl_seconds INT NOT NULL, -- 300 (login) / 900 (delivery_handover) — SRS-DOM-080
    attempts_used INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL, -- без лимита кроме rate-limit (login) / 5 (delivery_handover)
    consumed_at TIMESTAMPTZ, -- SRS-DOM-082: alreadyConsumed — повторное использование невозможно
    locked_at TIMESTAMPTZ -- OtpAttemptsExceededError, требует ReissueHandoverOtpUseCase
);
COMMENT ON TABLE otp_codes IS
    'Персистентность OtpCode VO (SRS-DOM-080..082, TC-DOM-015..018). code_hash — sha256(code + '
    'otpRequestId) (SRS-API-021: argon2 избыточен для короткоживущего 6-значного кода с TTL 300с, '
    'sha256 с солью otpRequestId достаточен и быстрее при высокой частоте верификации), сравнение '
    'через verify(candidate), не SELECT по значению кода. TTL-очистка — фоновая job, hard delete.';

-- =====================================================================================
-- 18. refresh_tokens [РАСШИРЕНИЕ Charter §5 — JWT access 15 мин / refresh 30 дней, ротация]
-- =====================================================================================
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE, -- sha256(refresh_token), НЕ plaintext
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL, -- issued_at + 30 дней
    rotated_from UUID REFERENCES refresh_tokens(id) ON DELETE SET NULL, -- цепочка ротации
    revoked_at TIMESTAMPTZ -- явный logout / обнаружение повторного использования (reuse detection)
);
COMMENT ON TABLE refresh_tokens IS
    'Ротация refresh-токенов (Charter §5). Повторное использование уже ротированного токена '
    '(rotated_from IS NOT NULL AND revoked_at IS NULL при попытке повторного refresh) — сигнал '
    'компрометации: application обязан отозвать ВСЮ цепочку токенов этого user_id.';
```
### Группа D: Заказы, корзина, избранное

```sql
-- =====================================================================================
-- 19. orders [ТЗ 1:1, расширено D-03/D-09/D-16/D-22/REQ-ONBOARD/Charter §3.4]
-- =====================================================================================
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number VARCHAR(20) UNIQUE NOT NULL, -- OrderNumber VO: DTJ-{YYMMDD}-{seq5}, SRS-DOM-085
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    pharmacy_id UUID REFERENCES pharmacies(id),
    status order_status DEFAULT 'pending_payment',
    payment_method VARCHAR(50) NOT NULL, -- 'alif_mobi', 'dc_next', 'cash_courier' (см. также enum payment_method)
    payment_transaction_id VARCHAR(255),
    items_total_tjs NUMERIC(10, 2) NOT NULL,
    delivery_fee_tjs NUMERIC(10, 2) NOT NULL,
    total_amount_tjs NUMERIC(10, 2) NOT NULL,
    delivery_address TEXT NOT NULL,
    delivery_landmark TEXT,
    delivery_latitude NUMERIC(10, 8),
    delivery_longitude NUMERIC(11, 8),
    courier_id UUID, -- FK добавлен ALTER TABLE после CREATE TABLE couriers (группа H)
    courier_eta_minutes INT,
    prescription_image_url TEXT, -- СОХРАНЕНО из tz.log для совместимости; каноничный источник — prescriptions.image_url
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    -- [РАСШИРЕНИЕ Charter §3.4/D-03/D-09/D-22] --
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    prescription_id UUID, -- FK добавлен ALTER TABLE после CREATE TABLE prescriptions (группа G)
    cancel_reason VARCHAR(100),
    cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL,
    sla_deadline_at TIMESTAMPTZ, -- processing_started_at + pickup_sla (SRS-DOM-167: сервер — источник времени)
    processing_started_at TIMESTAMPTZ,
    picked_up_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    handover_otp_id UUID REFERENCES otp_codes(id) ON DELETE SET NULL,
    checkout_attempt_id UUID NOT NULL, -- SRS-DOM-166: idempotency ключ ПОПЫТКИ, не заказа
    deleted_at TIMESTAMPTZ, -- soft delete (юридический аудит, SRS-DB-004)
    CONSTRAINT chk_orders_total_matches_sum
        CHECK (total_amount_tjs = items_total_tjs + delivery_fee_tjs), -- SRS-DOM-003, дублирует домен
    CONSTRAINT chk_orders_amounts_nonnegative
        CHECK (items_total_tjs >= 0 AND delivery_fee_tjs >= 0 AND total_amount_tjs >= 0)
);
COMMENT ON TABLE orders IS
    'Order aggregate root (10-domain-model.md). tenant_id — обязательный скоуп (Charter §3.4). '
    'checkout_attempt_id — идемпотентность ПОПЫТКИ оформления при таймауте платёжного провайдера '
    '(SRS-DOM-166), UNIQUE на (tenant_id, checkout_attempt_id) не задаётся намеренно: одна попытка '
    'может дать РОВНО один заказ, повтор с тем же ключом — идемпотентный возврат уже созданного.';
COMMENT ON COLUMN orders.status IS
    'order_status — переходы см. 10-domain-model.md §«State machines»/1. БД не проверяет граф '
    'переходов (это домен), только допустимость значения enum. confirmed [D-25] — синхронный '
    'результат Order.create() для cash_courier; confirmed<->paid_escrow — запрещённая пара '
    'переходов в обе стороны (SRS-DOM-102), paid_escrow достижим только из pending_payment по '
    'подписанному вебхуку (SRS-DOM-089) либо AdminPaymentOverrideUseCase (SRS-PAY-018).';
COMMENT ON CONSTRAINT chk_orders_total_matches_sum ON orders IS
    'SRS-DOM-003: total_amount = items_total + delivery_fee. Значение пересчитывается СЕРВЕРОМ в '
    'Order.create(), constraint — последний рубеж защиты от рассинхронизации (не источник истины).';

-- =====================================================================================
-- 20. order_items [ТЗ 1:1, расширено REQ-MON-1/2/5 — комиссия снэпшотится]
-- =====================================================================================
CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    medicine_id UUID REFERENCES medicines(id),
    unit_price_tjs NUMERIC(10, 2) NOT NULL,
    quantity INT NOT NULL,
    total_price_tjs NUMERIC(10, 2) NOT NULL,
    -- [РАСШИРЕНИЕ D-03/REQ-MON-1/2/5] --
    commission_bps SMALLINT NOT NULL DEFAULT 0, -- ставка в момент заказа (basis points, 500=5%), SRS-DOM-008
    platform_fee_diram BIGINT NOT NULL DEFAULT 0, -- D-03: снэпшот суммы комиссии от unit_price*qty (items_total), НЕ delivery_fee (SRS-DOM-009)
    inventory_batch_id UUID REFERENCES inventory_batches(id) ON DELETE SET NULL, -- какая партия зарезервирована (FEFO)
    CONSTRAINT chk_order_items_price_positive CHECK (unit_price_tjs > 0), -- SRS-DB-005
    CONSTRAINT chk_order_items_quantity_positive CHECK (quantity > 0),
    CONSTRAINT chk_order_items_total_matches CHECK (total_price_tjs = unit_price_tjs * quantity)
);
COMMENT ON TABLE order_items IS
    'OrderItem entity (жизненный цикл подчинён Order, не отдельный агрегат). commission_bps/'
    'platform_fee_diram — НЕИЗМЕНЯЕМЫ после создания (SRS-DOM-008): последующее изменение ставки в '
    'platform_fee (таблица) не влияет на уже созданные строки — обеспечивается ТОЛЬКО прикладным '
    'кодом (readonly в domain), БД физически позволяет UPDATE, но application никогда его не вызывает.';

-- =====================================================================================
-- 21. cart / cart_items [РАСШИРЕНИЕ — серверная корзина до оформления заказа]
-- =====================================================================================
CREATE TABLE cart (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES users(id) ON DELETE CASCADE, -- NULL для гостевой корзины (session_token)
    session_token VARCHAR(128), -- для гостя без аутентификации (до OTP-логина)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_cart_owner CHECK (customer_id IS NOT NULL OR session_token IS NOT NULL)
);
COMMENT ON TABLE cart IS
    'Серверная персистентная корзина (не отдельный доменный агрегат — простое хранилище выбора '
    'товара; правила сплита по аптекам — SplitCartByPharmacyUseCase, вызывается на checkout, '
    'ДО Order.create(), SRS-DOM-002).';

CREATE TABLE cart_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cart_id UUID NOT NULL REFERENCES cart(id) ON DELETE CASCADE,
    medicine_id UUID NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
    pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE, -- цена/остаток конкретной аптеки
    quantity INT NOT NULL,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_cart_medicine_pharmacy UNIQUE (cart_id, medicine_id, pharmacy_id),
    CONSTRAINT chk_cart_items_quantity_positive CHECK (quantity > 0)
);
COMMENT ON TABLE cart_items IS
    'Позиция корзины привязана к КОНКРЕТНОЙ аптеке (цена/остаток различаются между аптеками, tz.log '
    'Модуль 1) — REQ-UX-4: сплит по аптекам виден пользователю ДО оплаты как N отдельных заказов.';

-- =====================================================================================
-- 22. favorites [РАСШИРЕНИЕ — избранные медикаменты клиента]
-- =====================================================================================
CREATE TABLE favorites (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    medicine_id UUID NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, medicine_id)
);
COMMENT ON TABLE favorites IS
    'Список избранных медикаментов (не отдельный домен — простое M:N, читается в features/favorites '
    'фронта). Поддерживает REQ-UX-18 (реордер) косвенно через историю заказов, не через favorites.';
```
### Группа E: Эскроу, выплаты, комиссия

```sql
-- =====================================================================================
-- 23. escrow_ledger [РАСШИРЕНИЕ D-02 — программный ledger, двойная запись, append-only]
-- =====================================================================================
CREATE TABLE escrow_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    entry_type escrow_entry_type NOT NULL,
    direction escrow_entry_direction NOT NULL, -- SRS-DOM-067: знак кодируется полем, не отрицательным Money
    amount_diram BIGINT NOT NULL,
    payment_transaction_ref VARCHAR(255), -- ссылка на payment_operations.provider_ref для hold/refund записей
    reason TEXT, -- ОБЯЗАТЕЛЕН для entry_type='adjustment' (SRS-DOM-035)
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- ОБЯЗАТЕЛЕН для 'adjustment' (super_admin)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_escrow_ledger_amount_positive CHECK (amount_diram > 0),
    CONSTRAINT chk_escrow_ledger_adjustment_requires_reason
        CHECK (entry_type != 'adjustment' OR (reason IS NOT NULL AND actor_user_id IS NOT NULL))
);
COMMENT ON TABLE escrow_ledger IS
    'EscrowLedgerEntry — append-only, НИКОГДА не UPDATE/DELETE (SRS-DOM-031). Нет UPDATE-триггера-'
    'запрета намеренно избыточного — защита обеспечивается тем, что ни один прикладной репозиторий '
    'не экспонирует update()/delete() для этой таблицы (архитектурная гарантия), а REVOKE UPDATE, '
    'DELETE FROM app_role — операционная гарантия на уровне роли БД (см. §7).';
COMMENT ON COLUMN escrow_ledger.entry_type IS
    'hold_created (при webhook PAID_HOLD) -> platform_fee_captured + captured_to_pharmacy (ОДНОЙ '
    'транзакцией при delivered, SRS-DOM-032) -> опционально refunded_to_customer/partially_refunded/'
    'adjustment. Инвариант реконсиляции: hold_created = platform_fee_captured + captured_to_pharmacy '
    '+ Σ(refund*/adjustment) — проверяется джобой EscrowReconciliationJob (REQ-PAY-9), не constraint''ом '
    '(требует агрегации по всем строкам заказа, невозможно как CHECK на строке).';

-- =====================================================================================
-- 24. payout_schedule [РАСШИРЕНИЕ D-02/D-03/D-24/REQ-PAY-6/REQ-MON-4]
-- =====================================================================================
CREATE TABLE payout_schedule (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE, -- 1:1 c заказом
    pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE RESTRICT,
    status payout_status NOT NULL DEFAULT 'pending',
    gross_amount_diram BIGINT NOT NULL, -- REQ-MON-4: items_total до вычета комиссии
    commission_diram BIGINT NOT NULL, -- Σ(order_items.platform_fee_diram)
    net_amount_diram BIGINT NOT NULL, -- REQ-MON-4: аптеке платится только net = gross - commission
    hold_period_days INT NOT NULL, -- снэпшот tenant_settings.hold_period_days на момент delivered
    due_at TIMESTAMPTZ, -- delivered_at + hold_period_days, вычисляется джобой pending->due
    held_by_dispute_id UUID, -- FK добавлен ALTER TABLE после CREATE TABLE order_disputes (группа F)
    paid_at TIMESTAMPTZ,
    payout_batch_ref VARCHAR(255), -- ссылка на банковский пакетный перевод (вне схемы, внешняя система)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_payout_schedule_net_matches CHECK (net_amount_diram = gross_amount_diram - commission_diram),
    CONSTRAINT chk_payout_schedule_amounts_nonneg
        CHECK (gross_amount_diram >= 0 AND commission_diram >= 0 AND net_amount_diram >= 0)
);
COMMENT ON TABLE payout_schedule IS
    'Один payout_schedule на заказ (REQ-PAY-6/REQ-MON-4). Переходы см. 10-domain-model.md §«State '
    'machines»/2. disputed блокирует payout-джобу без доп. логики фильтрации (REQ-DISPUTE-4): джоба '
    'выбирает WHERE status=''due'', disputed автоматически исключён.';
COMMENT ON COLUMN payout_schedule.held_by_dispute_id IS
    'Заполняется атомарно ОДНОЙ транзакцией с order_disputes.status=''open'' (SRS-DOM-058, '
    'OpenDisputeUseCase внутри unitOfWork.run()).';

-- =====================================================================================
-- 25. platform_fee [РАСШИРЕНИЕ D-03/REQ-MON-8 — конфигурация ставок комиссии, резолвинг по специфичности]
-- =====================================================================================
CREATE TABLE platform_fee (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE, -- NULL = global default
    chain_id UUID REFERENCES pharmacy_chains(id) ON DELETE CASCADE, -- NULL = не специфично к сети
    commission_category VARCHAR(20), -- NULL = не специфично к категории; иначе 'rx'|'otc'|'parapharma'
    commission_bps SMALLINT NOT NULL, -- 500=5%(Rx), 800=8%(ОТС), 1200=12%(парафарм) — ASSUMPTION D-03
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to DATE, -- NULL = бессрочно
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT, -- обязательный аудит изменения ставки
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_platform_fee_bps_range CHECK (commission_bps BETWEEN 0 AND 10000),
    CONSTRAINT chk_platform_fee_date_range CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE platform_fee IS
    'Ставки комиссии платформы (D-03, REQ-MON-8). Резолвинг по специфичности при Order.create() '
    '(SRS-DOM-160): (tenant_id,chain_id,category) > (tenant_id,chain_id) > (tenant_id,category) > '
    '(tenant_id) > global (все NULL). Более узкое правило побеждает независимо от порядка вставки; '
    'effective_from/effective_to — дополнительный фильтр «активно на дату заказа».';
COMMENT ON COLUMN platform_fee.commission_bps IS
    'Basis points (1/100 процента). Изменение ставки НЕ влияет на уже созданные order_items — '
    'значение снэпшотится один раз в order_items.commission_bps/platform_fee_diram (SRS-DOM-008).';

-- =====================================================================================
-- 26. payment_operations [РАСШИРЕНИЕ REQ-PAY-8 — идемпотентность вызовов PaymentProvider]
-- =====================================================================================
CREATE TABLE payment_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    operation_type payment_operation_type NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL UNIQUE, -- явный ключ на вызов (createBill/refund), REQ-PAY-8
    provider VARCHAR(30) NOT NULL, -- 'alif_mobi' | 'dc_next' | 'mock_bank'
    provider_ref VARCHAR(255), -- ID операции на стороне провайдера (invoice_id, refund_id)
    status payment_operation_status NOT NULL DEFAULT 'pending',
    amount_diram BIGINT NOT NULL,
    raw_webhook_payload JSONB, -- сырое тело последнего relevant вебхука (для расследований, PII-маскировано на уровне логов)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE payment_operations IS
    'Локальная идемпотентность вызовов PaymentProvider там, где банк не гарантирует нативную '
    '(REQ-PAY-8). idempotency_key для createBill — checkout_attempt_id заказа; для webhook-обработки '
    'дублирующегося PAID_HOLD — банковский transaction_id (SRS-DOM-164): UNIQUE-конфликт => 200 OK '
    'без повторного выполнения бизнес-логики.';
```
### Группа F: Возвраты, споры, поддержка

```sql
-- =====================================================================================
-- 27. order_returns [РАСШИРЕНИЕ D-09/REQ-RET-1..13]
-- =====================================================================================
CREATE TABLE order_returns (
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

-- =====================================================================================
-- 28. support_tickets [РАСШИРЕНИЕ REQ-DISPUTE-1 — канало-независимое обращение]
-- =====================================================================================
CREATE TABLE support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL, -- NULL для обращений не по заказу
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel support_ticket_channel NOT NULL,
    category support_ticket_category NOT NULL,
    is_escrow_blocking BOOLEAN NOT NULL DEFAULT false, -- true => атомарно порождает order_disputes
    status support_ticket_status NOT NULL DEFAULT 'open',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL, -- NULL для channel='system_auto'
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE support_tickets IS
    'SupportTicket aggregate (REQ-DISPUTE-1). Тикет с is_escrow_blocking=true атомарно порождает '
    'РОВНО ОДИН order_disputes(status=''open'') в той же транзакции (SRS-DOM-058, REQ-DISPUTE-2). '
    'system_auto создаётся автоматически при просрочке delivery_sla (REQ-DISPUTE-16) или '
    'расхождении реконсиляции (REQ-DISPUTE-17).';

-- =====================================================================================
-- 29. order_disputes [РАСШИРЕНИЕ D-24/REQ-DISPUTE-2..15]
-- =====================================================================================
CREATE TABLE order_disputes (
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
    'кросс-табличной проверки в момент перехода, не инвариант строки).';

-- =====================================================================================
-- 30. dispute_status_history [РАСШИРЕНИЕ REQ-DISPUTE-11/13 — append-only история переходов]
-- =====================================================================================
CREATE TABLE dispute_status_history (
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

ALTER TABLE payout_schedule
    ADD CONSTRAINT fk_payout_schedule_dispute
    FOREIGN KEY (held_by_dispute_id) REFERENCES order_disputes(id) ON DELETE SET NULL;
```
### Группа G: Рецепты (AI OCR)

```sql
-- =====================================================================================
-- 31. prescriptions [ТЗ упоминает prescription_status enum; таблица — РАСШИРЕНИЕ D-14/REQ-OCR]
-- =====================================================================================
CREATE TABLE prescriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    status prescription_status NOT NULL DEFAULT 'uploaded',
    image_url TEXT NOT NULL, -- MinIO ключ, доступ — ТОЛЬКО через PrescriptionAccessPolicy (SRS-DOM-030/155)
    consent_given BOOLEAN NOT NULL, -- REQ-REG-9, обязателен ДО конструирования сущности
    consent_given_at TIMESTAMPTZ,
    raw_model_output_ref TEXT, -- object storage key, ОБЯЗАН быть заполнен ДО смены статуса (SRS-DOM-029)
    vlm_confidence NUMERIC(4, 3), -- сырое значение от провайдера, "сырой кандидат", НЕ решение
    image_quality_score NUMERIC(4, 3), -- сигнал 2 из composite_confidence
    lasa_candidate_count SMALLINT NOT NULL DEFAULT 0, -- сигнал 3, REQ-OCR-6
    stamp_present BOOLEAN, -- сигнал 4, is_official_stamp_present из tz.log JSON-контракта
    composite_confidence NUMERIC(4, 3), -- ЕДИНСТВЕННОЕ вычисляемое доменным сервисом поле решения (D-14)
    doctor_name VARCHAR(255),
    verified_by UUID REFERENCES users(id) ON DELETE SET NULL, -- pharmacist, обязателен для 'verified'
    verified_at TIMESTAMPTZ,
    rejection_reason VARCHAR(100), -- в т.ч. 'ocr_provider_unavailable' (SRS-DOM-174)
    revoked_at TIMESTAMPTZ, -- SRS-DOM-171: отзыв ПОСЛЕ verified, отдельно от status (терминален)
    clarification_requested_at TIMESTAMPTZ, -- начало окна clarification_window (ASSUMPTION 24ч)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_prescriptions_verified_requires_verifier
        CHECK (status != 'verified' OR verified_by IS NOT NULL) -- SRS-DOM-118
);
COMMENT ON TABLE prescriptions IS
    'Prescription aggregate (SRS-DOM-025..030). composite_confidence вычисляется ИСКЛЮЧИТЕЛЬНО '
    'CompositeConfidenceCalculator (domain service) из ≥4 сигналов колонок выше — НИКОГДА не '
    'присваивается напрямую из vlm_confidence (SRS-DOM-026, REQ-OCR-3). Переходы — см. '
    '10-domain-model.md §«State machines»/3.';
COMMENT ON COLUMN prescriptions.image_url IS
    'REQ-REG-10/11: доступ audit-логируется для super_admin, разрешён pharmacist только по назначенному '
    'заказу (SRS-DOM-155). pharmacy_admin НЕ имеет доступа к содержимому по умолчанию.';
COMMENT ON COLUMN prescriptions.status IS
    'verified — ТЕРМИНАЛЕН (правка требует НОВОЙ загрузки, новый prescription_id, SRS-DOM-120). '
    'rejected — терминален, "реанимация" запрещена.';

-- Отложенная связь orders -> prescriptions (циклическая по порядку создания таблиц)
ALTER TABLE orders
    ADD CONSTRAINT fk_orders_prescription
    FOREIGN KEY (prescription_id) REFERENCES prescriptions(id) ON DELETE SET NULL;
```
### Группа H: Курьеры и доставка

```sql
-- =====================================================================================
-- 32. couriers [РАСШИРЕНИЕ D-21/REQ-COUR-1..11]
-- =====================================================================================
CREATE TABLE couriers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
    chain_id UUID REFERENCES pharmacy_chains(id) ON DELETE SET NULL, -- NULL = platform_pool (REQ-COUR-1)
    status courier_status NOT NULL DEFAULT 'pending_verification',
    tax_status courier_tax_status NOT NULL,
    tax_status_document_url TEXT, -- подтверждающий документ (патент/ГПХ/справка сети)
    vehicle_type courier_vehicle_type NOT NULL,
    cold_chain_certified BOOLEAN NOT NULL DEFAULT false, -- REQ-COUR-9, допуск к requires_cold_chain
    health_certificate_url TEXT, -- REQ-COUR-11, опционально в MVP
    verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE couriers IS
    'Courier aggregate. chain_id NULL => участник партнёрского пула (доступен любому тенанту в '
    'режиме platform_pool/hybrid, REQ-COUR-1/2); chain_id заполнено => собственный флот, обслуживает '
    'ТОЛЬКО заказы своей сети (guard мультитенантности, SRS-DOM-037). pending_verification не может '
    'быть назначен ни на один заказ (SRS-DOM-137, REQ-COUR-10).';

-- =====================================================================================
-- 33. delivery_assignments [РАСШИРЕНИЕ tz.log Модуль 5, CUJ-3/4]
-- =====================================================================================
CREATE TABLE delivery_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    courier_id UUID REFERENCES couriers(id) ON DELETE SET NULL, -- NULL пока unassigned
    status delivery_assignment_status NOT NULL DEFAULT 'unassigned',
    landmark_text TEXT,
    delivery_geo_point GEOGRAPHY(POINT, 4326),
    handover_otp_id UUID REFERENCES otp_codes(id) ON DELETE SET NULL,
    cash_collected_diram BIGINT, -- REQ-DELIV-4, для payment_method='cash_courier'
    cash_change_diram BIGINT,
    reassign_reason TEXT,
    reassigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ,
    picked_up_from_pharmacy_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    failed_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_delivery_cash_matches
        CHECK (cash_collected_diram IS NULL OR cash_collected_diram >= COALESCE(cash_change_diram, 0))
);
COMMENT ON TABLE delivery_assignments IS
    'DeliveryAssignment aggregate. Только одно НЕТЕРМИНАЛЬНОЕ назначение на order_id одновременно '
    '(SRS-DOM-036) — см. частичный уникальный индекс ux_delivery_assignment_one_active (§4). '
    'markDelivered() для cash_courier требует ПРЕДВАРИТЕЛЬНОГО recordCash() с '
    'collected-change=order.total (SRS-DOM-040, CashAmountMismatchError на уровне application).';

-- =====================================================================================
-- 34. courier_earnings [РАСШИРЕНИЕ REQ-COUR-5 — признание заработка, append-only]
-- =====================================================================================
CREATE TABLE courier_earnings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    courier_id UUID NOT NULL REFERENCES couriers(id) ON DELETE RESTRICT,
    delivery_assignment_id UUID NOT NULL REFERENCES delivery_assignments(id) ON DELETE RESTRICT,
    amount_diram BIGINT NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL UNIQUE, -- REQ-COUR-5: обязателен, дедуп DeliveryCompletedEvent
    is_return_fee BOOLEAN NOT NULL DEFAULT false, -- true => courier_return_fee_diram (REQ-RET-7)
    payout_batch_id UUID, -- FK добавлен ALTER TABLE после CREATE TABLE courier_payouts (ниже)
    recognized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_courier_earnings_amount_positive CHECK (amount_diram > 0)
);
COMMENT ON TABLE courier_earnings IS
    'Признаётся В МОМЕНТ delivered, НЕЗАВИСИМО от hold_period_days выплаты аптеке (SRS-DOM: '
    'DeliveryCompletedEvent -> billing.recordEarning, REQ-COUR-5) — два несвязанных таймлайна. '
    'Только для couriers.chain_id IS NULL (platform_pool) — own_fleet курьеры НЕ имеют записей здесь '
    '(REQ-COUR-3: delivery_fee_tjs целиком выручка тенанта, DoruTJ не ведёт их earnings).';

-- =====================================================================================
-- 35. tenant_courier_payout_rules [РАСШИРЕНИЕ REQ-COUR-4 — формула выплаты пуловому курьеру]
-- =====================================================================================
CREATE TABLE tenant_courier_payout_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE, -- NULL = global default (нейтральный DoruTJ)
    rule_type VARCHAR(20) NOT NULL, -- 'percentage' | 'flat_per_delivery' | 'distance_tiered'
    percentage_bps SMALLINT, -- для 'percentage': ASSUMPTION 7000 (70% от delivery_fee, D-21)
    flat_amount_diram BIGINT, -- для 'flat_per_delivery'
    distance_tiers JSONB, -- для 'distance_tiered': [{"up_to_km":5,"amount_diram":1000}, ...]
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_payout_rules_type_fields CHECK (
        (rule_type = 'percentage' AND percentage_bps IS NOT NULL)
        OR (rule_type = 'flat_per_delivery' AND flat_amount_diram IS NOT NULL)
        OR (rule_type = 'distance_tiered' AND distance_tiers IS NOT NULL)
    )
);
COMMENT ON TABLE tenant_courier_payout_rules IS
    'REQ-COUR-4: формула расчёта courier_earnings.amount_diram НЕ хардкод — резолвится по tenant_id '
    '(NULL=global) на сервере в момент DeliveryCompletedEvent. Точный % — ASSUMPTION 70% (D-21), '
    'подлежит утверждению продуктом.';

-- =====================================================================================
-- 36. courier_payouts [РАСШИРЕНИЕ REQ-COUR-6 — физическая выплата батчами]
-- =====================================================================================
CREATE TABLE courier_payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    courier_id UUID NOT NULL REFERENCES couriers(id) ON DELETE RESTRICT,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    total_amount_diram BIGINT NOT NULL,
    cash_remittance_offset_diram BIGINT NOT NULL DEFAULT 0, -- REQ-COUR-7: вычет за собранный cash_courier
    status courier_payout_batch_status NOT NULL DEFAULT 'draft',
    issued_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_courier_payouts_period CHECK (period_end > period_start),
    CONSTRAINT chk_courier_payouts_amount_nonneg CHECK (total_amount_diram >= 0)
);
COMMENT ON TABLE courier_payouts IS
    'Батч физической выплаты курьеру платформенного пула (REQ-COUR-6, дефолт — раз в неделю, '
    'конфигурируемо). cash_remittance_offset_diram — REQ-COUR-7: сумма наличных, собранных курьером '
    'за cash_courier-заказы, автоматически вычитается из ближайшего батча.';

ALTER TABLE courier_earnings
    ADD CONSTRAINT fk_courier_earnings_payout_batch
    FOREIGN KEY (payout_batch_id) REFERENCES courier_payouts(id) ON DELETE SET NULL;

-- Отложенные связи, зависящие от couriers (циклические по порядку создания)
ALTER TABLE orders
    ADD CONSTRAINT fk_orders_courier
    FOREIGN KEY (courier_id) REFERENCES couriers(id) ON DELETE SET NULL;
ALTER TABLE order_returns
    ADD CONSTRAINT fk_order_returns_courier
    FOREIGN KEY (courier_id) REFERENCES couriers(id) ON DELETE SET NULL;
```
### Группа I: Онбординг, верификация, доступ 1С

```sql
-- =====================================================================================
-- 37. pharmacy_api_keys [РАСШИРЕНИЕ D-11 — доступ 1С-шлюза]
-- =====================================================================================
CREATE TABLE pharmacy_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
    key_prefix VARCHAR(16) NOT NULL, -- отображаемая часть ('sec_live_9f83a2c8'), для UI-идентификации без раскрытия
    key_hash TEXT NOT NULL, -- argon2-хеш полного ключа, X-Pharmacy-API-Key
    hmac_secret_hash TEXT NOT NULL, -- argon2-хеш секрета для HMAC-SHA256 подписи тела (D-11)
    require_mtls BOOLEAN NOT NULL DEFAULT false, -- опционально для крупных сетей (D-11)
    is_active BOOLEAN NOT NULL DEFAULT true,
    rotated_from UUID REFERENCES pharmacy_api_keys(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ
);
COMMENT ON TABLE pharmacy_api_keys IS
    'D-11: X-Pharmacy-API-Key (argon2-хеш) + обязательная HMAC-SHA256 подпись тела с timestamp+nonce '
    '(анти-replay, окно 5 минут, проверяется application, не БД). mTLS — опциональный флаг per-'
    'pharmacy, дефолт false (смягчение буквы tz.log — REQ-SYNC-14).';

-- =====================================================================================
-- 38. pharmacy_verification [РАСШИРЕНИЕ D-22 — состояние верификации лицензии, отдельно от статуса]
-- =====================================================================================
CREATE TABLE pharmacy_verification (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID REFERENCES pharmacies(id) ON DELETE CASCADE, -- ровно одно из двух заполнено
    chain_id UUID REFERENCES pharmacy_chains(id) ON DELETE CASCADE, -- (уровень точки ИЛИ уровень юрлица)
    verification_status verification_status NOT NULL DEFAULT 'not_started',
    checklist_snapshot JSONB, -- REQ-ONBOARD-7: чек-лист, зафиксированный на момент решения
    submitted_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL, -- только super_admin (REQ-ONBOARD-5)
    reviewed_at TIMESTAMPTZ,
    sla_target_at TIMESTAMPTZ, -- submitted_at + 2 рабочих дня (REQ-ONBOARD-18, ориентир, не жёсткий дедлайн)
    CONSTRAINT chk_pharmacy_verification_one_subject
        CHECK ((pharmacy_id IS NOT NULL AND chain_id IS NULL) OR (pharmacy_id IS NULL AND chain_id IS NOT NULL))
);
COMMENT ON TABLE pharmacy_verification IS
    'Текущее СОСТОЯНИЕ верификации (одна активная запись на субъект проверки — точку ИЛИ юрлицо). '
    'Полная история решений — в onboarding_review_log (append-only, ниже). Проверка ИНН/лицензии на '
    'MVP полностью ручная (REQ-ONBOARD-6) — визуальная сверка сканов оператором super_admin.';

-- =====================================================================================
-- 39. onboarding_review_log [РАСШИРЕНИЕ REQ-ONBOARD-7 — append-only журнал решений]
-- =====================================================================================
CREATE TABLE onboarding_review_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID REFERENCES pharmacies(id) ON DELETE CASCADE,
    chain_id UUID REFERENCES pharmacy_chains(id) ON DELETE CASCADE,
    action VARCHAR(30) NOT NULL, -- 'approve'|'reject'|'changes_requested'|'suspend'|'reactivate'|'terminate'
    actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reason TEXT,
    checklist_snapshot JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_onboarding_log_one_subject
        CHECK ((pharmacy_id IS NOT NULL) OR (chain_id IS NOT NULL))
);
COMMENT ON TABLE onboarding_review_log IS
    'Append-only (REQ-ONBOARD-7). Каждое решение super_admin по заявке сети/аптеки — отдельная '
    'строка, включая автоматические (license_expired auto-suspend, actor_user_id=система через '
    'служебного пользователя джобы).';
```
### Группа J: Аудит, надёжность интеграций, биллинг, нотификации

```sql
-- =====================================================================================
-- 40. audit_log [РАСШИРЕНИЕ Часть C п.13 — неизменяемый журнал действий над заказами/деньгами/рецептами]
-- =====================================================================================
CREATE TABLE audit_log (
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
    'Неизменяемый (append-only, НЕТ UPDATE/DELETE в прикладном коде) журнал: admin_payment_override, '
    'admin_return_override, доступ к prescription_image_url (REQ-REG-10, SRS-DOM-155), изменение '
    'control_category (D-08), решения онбординга, ledger.adjustment (REQ-DISPUTE-19). Отдельно от '
    'onboarding_review_log/dispute_status_history — те специализированы под свой домен и содержат '
    'структурные поля для UI-истории; audit_log — универсальный, для комплаенс-выгрузки целиком.';

-- =====================================================================================
-- 41. outbox [РАСШИРЕНИЕ Часть C п.14 — transactional outbox]
-- =====================================================================================
CREATE TABLE outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- = event_id (UUID v7, монотонный, SRS-DOM глоссарий)
    event_type VARCHAR(100) NOT NULL, -- 'OrderPaidEvent' | 'OrderDeliveredEvent' | ...
    aggregate_type VARCHAR(50) NOT NULL, -- 'order' | 'prescription' | ...
    aggregate_id UUID NOT NULL,
    payload JSONB NOT NULL,
    tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
    status outbox_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    publish_attempts INT NOT NULL DEFAULT 0
);
COMMENT ON TABLE outbox IS
    'Строка вставляется В ОДНОЙ транзакции с доменным изменением агрегата (SRS-DOM-151). '
    'OutboxRelayWorker (BullMQ, apps/worker) читает status=''pending'' ORDER BY created_at, '
    'публикует в очередь domain-events, помечает published (at-least-once, SRS-DOM-152).';

-- =====================================================================================
-- 42. processed_events [РАСШИРЕНИЕ надёжность — идемпотентность потребителей outbox-событий]
-- =====================================================================================
CREATE TABLE processed_events (
    consumer_name VARCHAR(100) NOT NULL, -- 'orders.on-delivered' | 'billing.on-delivery-completed' | ...
    event_id UUID NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (consumer_name, event_id)
);
COMMENT ON TABLE processed_events IS
    'Каждый потребитель доменного события обязан быть идемпотентен по event_id (at-least-once '
    'delivery, SRS-DOM-152). INSERT сюда ПЕРЕД обработкой (или в той же транзакции) — конфликт PK '
    'значит «уже обработано», обработчик — no-op.';

-- =====================================================================================
-- 43. platform_billing_invoices [РАСШИРЕНИЕ REQ-MON-6/9/10 — B2B-биллинг]
-- =====================================================================================
CREATE TABLE platform_billing_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chain_id UUID NOT NULL REFERENCES pharmacy_chains(id) ON DELETE RESTRICT,
    invoice_type billing_invoice_type NOT NULL,
    status billing_invoice_status NOT NULL DEFAULT 'draft',
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    subtotal_diram BIGINT NOT NULL, -- сумма до НДС
    vat_diram BIGINT NOT NULL DEFAULT 0, -- REQ-MON-9: НДС 14% отдельной строкой
    total_diram BIGINT NOT NULL, -- subtotal + vat
    issued_at TIMESTAMPTZ,
    due_at TIMESTAMPTZ, -- issued_at + net-7 (08-1 §ОВ.5)
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_billing_invoices_total_matches CHECK (total_diram = subtotal_diram + vat_diram),
    CONSTRAINT chk_billing_invoices_period CHECK (period_end > period_start)
);
COMMENT ON TABLE platform_billing_invoices IS
    'PlatformBillingInvoice aggregate (REQ-MON-6): ежедневная агрегация delivered-заказов '
    'cash_courier сети в draft, конец периода (неделя) -> issued, due_at = +7 дней. Просрочка сверх '
    'due_at+grace_period -> авто-блокировка приёма заказов ВСЕЙ сети (REQ-MON-7, is_active=false на '
    'pharmacy_chains), снятие — только super_admin.';

-- =====================================================================================
-- 44. notifications [РАСШИРЕНИЕ REQ-TG-5/REQ-NOTIF — персистентный лог исходящих уведомлений]
-- =====================================================================================
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel notification_channel NOT NULL,
    event_type VARCHAR(100) NOT NULL, -- соответствует outbox.event_type, породившему уведомление
    status notification_status NOT NULL DEFAULT 'queued',
    payload JSONB NOT NULL,
    throttle_key VARCHAR(255), -- REQ-TG-5: ≤1/сек на chat_id — ключ троттлинга в BullMQ rate-limiter
    sent_at TIMESTAMPTZ,
    failed_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE notifications IS
    'Персистентный ЛОГ (не сама очередь — очередь исполнения в BullMQ/Redis). Отдельная запись на '
    'канал/попытку, читается apps/admin для диагностики недоставленных уведомлений.';

-- =====================================================================================
-- 45. i18n_overrides [РАСШИРЕНИЕ Charter §3.4 — точечные тенант-специфичные переопределения строк]
-- =====================================================================================
CREATE TABLE i18n_overrides (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    locale VARCHAR(5) NOT NULL, -- 'tj' | 'ru' | 'en'
    translation_key VARCHAR(255) NOT NULL, -- напр. 'brand.name', 'checkout.cod_disclaimer'
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (tenant_id, locale, translation_key)
);
COMMENT ON TABLE i18n_overrides IS
    'Точечное переопределение строки словаря packages/i18n для КОНКРЕТНОГО тенанта без редеплоя '
    '(White-Label кастомизация текста, Charter §3.4). Базовые словари tj/ru/en остаются статичными '
    'файлами пакета — эта таблица только для строк, требующих tenant-специфичной правки '
    '(в первую очередь brand.name, D-01: НИКОГДА не хардкод).';
```
### Отложенные внешние ключи (циклы порядка создания)

```sql
-- pharmacy_chains.tenant_id ссылается на tenants, созданную позже (группа C) — тенант White-Label
-- сети создаётся ПОСЛЕ approve заявки сети, обратная связь известна не при первом INSERT.
ALTER TABLE pharmacy_chains
    ADD CONSTRAINT fk_pharmacy_chains_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;

-- catalog_match_queue.resolved_by ссылается на users, созданную позже (группа C)
ALTER TABLE catalog_match_queue
    ADD CONSTRAINT fk_catalog_match_queue_resolved_by
    FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL;
```

**SRS-DB-010** [`02` §1.1, Drizzle-kit] В реальной миграции Drizzle-kit порядок `CREATE TABLE`
разрешается автоматически топологической сортировкой графа FK; циклы (`pharmacy_chains ↔ tenants`,
`orders ↔ couriers`, `orders ↔ prescriptions`) Drizzle-kit разрешает ровно так же — отложенным
`ALTER TABLE ... ADD CONSTRAINT` в конце миграции. Порядок таблиц в этом документе — читаемый
(группировка по контексту), не буквальный порядок файла миграции.

---

## Индексы

> Каждый индекс сопровождается: под какой запрос, из какого юзкейса/CUJ. Индексы, дублирующие
> `UNIQUE`-constraint автоматически созданный PostgreSQL, не перечисляются повторно.

### Полнотекстовый поиск и fuzzy (Charter ADR №1, pg_trgm)

```sql
-- CUJ-1: «цытрамон» -> «Цитрамон». Основной GIN-индекс по сгенерированной колонке search_vector.
CREATE INDEX ix_medicines_search_vector ON medicines USING GIN (search_vector);

-- Fuzzy trigram fallback, когда tsvector не даёт совпадений (сильные опечатки/транслит) — REQ-UX-13.
CREATE INDEX ix_medicines_trade_name_trgm ON medicines USING GIN (trade_name gin_trgm_ops);
CREATE INDEX ix_medicines_inn_name_trgm ON medicines USING GIN (inn_name gin_trgm_ops);

-- D-06 composite-матчинг шаг 3: fuzzy по (trade_name+dosage_form+manufacturer) при 1С-выгрузке.
CREATE INDEX ix_medicines_manufacturer_trgm ON medicines USING GIN (manufacturer_name gin_trgm_ops);
```

### Гео (аптеки, доставка, курьеры)

```sql
-- CUJ-1/4: «аптеки в радиусе N км от точки», сортировка курьеров по близости.
CREATE INDEX ix_pharmacies_geo_point ON pharmacies USING GIST (geo_point);
CREATE INDEX ix_delivery_assignments_geo_point ON delivery_assignments USING GIST (delivery_geo_point);
```

### Каталог / инвентарь

```sql
-- Модуль 1 tz.log: блок аналогов по МНН (переработан на substances, D-07) — JOIN medicine_substances
-- по substance_id для всех medicines, затем фильтр pharmacy_inventory.stock_quantity>0.
CREATE INDEX ix_medicine_substances_substance ON medicine_substances (substance_id);

-- Инвариант soft-publish + фильтр control_category (SRS-DOM-157): поиск ИСКЛЮЧАЕТ psychotropic/narcotic.
CREATE INDEX ix_medicines_control_category ON medicines (control_category) WHERE control_category != 'none';
CREATE INDEX ix_medicines_published ON medicines (id) WHERE is_published = true;

-- Каталог/остатки конкретной аптеки — самый частый JOIN (карточка товара + доступность).
CREATE INDEX ix_pharmacy_inventory_pharmacy ON pharmacy_inventory (pharmacy_id) WHERE stock_quantity > 0;
CREATE INDEX ix_pharmacy_inventory_medicine ON pharmacy_inventory (medicine_id) WHERE stock_quantity > 0;
-- (unique_pharmacy_medicine уже создаёт составной уникальный индекс (pharmacy_id, medicine_id))

-- FEFO-выборка партий: активные (непросроченные, quantity>0) партии одного inventory-агрегата,
-- отсортированные по expiry_date ASC — SRS-DOM-020.
CREATE INDEX ix_inventory_batches_fefo
    ON inventory_batches (pharmacy_inventory_id, expiry_date)
    WHERE quantity > 0;

-- D-06 шаг 2: точное совпадение (pharmacy_id, internal_sku) — быстрый путь без fuzzy.
-- (первичный ключ pharmacy_sku_mapping уже покрывает это)

-- REQ-SYNC-16: понижение приоритета устаревших (>72ч) ручных позиций в поиске.
CREATE INDEX ix_inventory_batches_stale ON inventory_batches (last_synced_at) WHERE quantity > 0;

-- Очередь ручной модерации (apps/admin) — оператор фильтрует по статусу.
CREATE INDEX ix_catalog_match_queue_status ON catalog_match_queue (status, created_at) WHERE status = 'pending_review';

-- История батчей аптеки в apps/admin (REQ-SYNC-10).
CREATE INDEX ix_inventory_sync_batches_pharmacy ON inventory_sync_batches (pharmacy_id, received_at DESC);
CREATE INDEX ix_inventory_sync_errors_batch ON inventory_sync_errors (batch_id);
```

### Заказы (частичные индексы под активные состояния)

```sql
-- Терминал фармацевта (CUJ-3): «мои новые заказы этой аптеки» — исключает терминальные статусы,
-- индекс маленький и «горячий» (постоянно перечитывается), частичный индекс критичен для латентности.
CREATE INDEX ix_orders_pharmacy_active
    ON orders (pharmacy_id, created_at)
    WHERE status IN ('paid_escrow', 'processing', 'picked_up');

-- Курьерское приложение (CUJ-4): «мои активные доставки».
CREATE INDEX ix_orders_courier_active
    ON orders (courier_id, created_at)
    WHERE status IN ('picked_up') AND courier_id IS NOT NULL;

-- Джоба авто-отмены/авто-рефанда по SLA (SRS-DOM-092, REQ-PAY-5): выборка просроченных paid_escrow.
CREATE INDEX ix_orders_sla_deadline
    ON orders (sla_deadline_at)
    WHERE status = 'processing' AND sla_deadline_at IS NOT NULL;

-- История заказов клиента (реордер, REQ-UX-18) — самый частый запрос customer-приложения.
CREATE INDEX ix_orders_customer_history ON orders (customer_id, created_at DESC) WHERE deleted_at IS NULL;

-- Тенант-скоуп (Charter §3.4) — почти каждый запрос orders фильтруется по tenant_id.
CREATE INDEX ix_orders_tenant ON orders (tenant_id, created_at DESC);

-- Идемпотентность попытки checkout (SRS-DOM-166) — заказ по checkout_attempt_id.
CREATE UNIQUE INDEX ux_orders_checkout_attempt ON orders (customer_id, checkout_attempt_id);

CREATE INDEX ix_order_items_order ON order_items (order_id);
CREATE INDEX ix_order_items_medicine ON order_items (medicine_id); -- аналитика продаж по товару
```

### Эскроу / выплаты / комиссия

```sql
-- Реконсиляция (REQ-PAY-9): агрегация всех записей ledger одного заказа.
CREATE INDEX ix_escrow_ledger_order ON escrow_ledger (order_id, created_at);
CREATE INDEX ix_escrow_ledger_entry_type ON escrow_ledger (entry_type);

-- Payout-джоба (REQ-PAY-6): выборка due-выплат для батч-перевода банку.
CREATE INDEX ix_payout_schedule_due ON payout_schedule (due_at) WHERE status = 'due';
CREATE INDEX ix_payout_schedule_pharmacy ON payout_schedule (pharmacy_id, status);
-- (order_id уже UNIQUE — 1:1 с заказом)

-- Резолвинг ставки комиссии по специфичности (SRS-DOM-160) — самый частый путь: (tenant,chain,category).
CREATE INDEX ix_platform_fee_lookup
    ON platform_fee (tenant_id, chain_id, commission_category, effective_from DESC);

-- Идемпотентность вызовов платёжного провайдера (REQ-PAY-8) — уже UNIQUE на idempotency_key.
CREATE INDEX ix_payment_operations_order ON payment_operations (order_id, created_at);
```

### Возвраты / споры / поддержка

```sql
-- REQ-DISPUTE-14/15: джоба эскалации просроченных SLA споров.
CREATE INDEX ix_order_disputes_sla ON order_disputes (resolution_due_at)
    WHERE status IN ('open', 'awaiting_customer');
CREATE INDEX ix_order_disputes_order ON order_disputes (order_id);
CREATE INDEX ix_dispute_status_history_dispute ON dispute_status_history (dispute_id, created_at);

-- REQ-RET-11: джоба просрочки return_transit_sla.
CREATE INDEX ix_order_returns_in_transit ON order_returns (requested_at) WHERE status = 'return_in_transit';
CREATE INDEX ix_order_returns_order ON order_returns (order_id);

CREATE INDEX ix_support_tickets_order ON support_tickets (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX ix_support_tickets_status ON support_tickets (tenant_id, status, created_at);
```

### Курьеры / доставка

```sql
-- Алгоритм подбора «ближайший свободный» (REQ-DELIV-2): активные курьеры пула/сети.
CREATE INDEX ix_couriers_active_pool ON couriers (status) WHERE chain_id IS NULL AND status = 'active';
CREATE INDEX ix_couriers_active_chain ON couriers (chain_id, status) WHERE status = 'active';

CREATE INDEX ix_delivery_assignments_order ON delivery_assignments (order_id);
CREATE INDEX ix_delivery_assignments_courier_active
    ON delivery_assignments (courier_id, status)
    WHERE status NOT IN ('delivered', 'delivery_failed');

-- Батч-выплата курьеру (REQ-COUR-6): незачтённые earnings пула.
CREATE INDEX ix_courier_earnings_courier_unpaid
    ON courier_earnings (courier_id, recognized_at)
    WHERE payout_batch_id IS NULL;
```

### Онбординг / верификация / прочее

```sql
-- Джоба ежедневного скана истечения лицензии (REQ-ONBOARD-16).
CREATE INDEX ix_pharmacies_license_expiry ON pharmacies (license_expiry_date) WHERE status = 'active';
CREATE INDEX ix_pharmacy_chains_status ON pharmacy_chains (status);
CREATE INDEX ix_pharmacies_chain_status ON pharmacies (chain_id, status);

CREATE INDEX ix_onboarding_review_log_pharmacy ON onboarding_review_log (pharmacy_id) WHERE pharmacy_id IS NOT NULL;
CREATE INDEX ix_onboarding_review_log_chain ON onboarding_review_log (chain_id) WHERE chain_id IS NOT NULL;

-- Outbox-релей: выборка необработанных строк по FIFO.
CREATE INDEX ix_outbox_pending ON outbox (created_at) WHERE status = 'pending';

-- Аудит: выборка по сущности (расследование инцидента) и по актору (комплаенс-отчёт).
CREATE INDEX ix_audit_log_entity ON audit_log (entity_type, entity_id, created_at);
CREATE INDEX ix_audit_log_actor ON audit_log (actor_user_id, created_at);

-- OTP: очистка по TTL, поиск по subject_ref при verify().
CREATE INDEX ix_otp_codes_subject ON otp_codes (subject_ref, purpose) WHERE consumed_at IS NULL AND locked_at IS NULL;
CREATE INDEX ix_refresh_tokens_user ON refresh_tokens (user_id) WHERE revoked_at IS NULL;

-- Корзина: восстановление гостевой корзины по session_token.
CREATE INDEX ix_cart_session ON cart (session_token) WHERE session_token IS NOT NULL;
CREATE INDEX ix_cart_customer ON cart (customer_id) WHERE customer_id IS NOT NULL;
```

### Частичные уникальные индексы, реализующие «не более одной активной строки» (домен → БД)

```sql
-- SRS-DOM-036: только одно НЕТЕРМИНАЛЬНОЕ delivery_assignment на order_id.
CREATE UNIQUE INDEX ux_delivery_assignment_one_active
    ON delivery_assignments (order_id)
    WHERE status NOT IN ('delivered', 'delivery_failed');

-- SRS-DOM-052: не более одного НЕТЕРМИНАЛЬНОГО OrderReturn на order_id.
CREATE UNIQUE INDEX ux_order_returns_one_active
    ON order_returns (order_id)
    WHERE status NOT IN ('return_confirmed', 'return_rejected');

-- SRS-DOM-057/REQ-DISPUTE-3: не более одного НЕТЕРМИНАЛЬНОГО OrderDispute на order_id.
CREATE UNIQUE INDEX ux_order_disputes_one_active
    ON order_disputes (order_id)
    WHERE status IN ('open', 'awaiting_customer');

-- D-01/SRS-DOM-042: ровно один нейтральный тенант.
CREATE UNIQUE INDEX ux_tenants_single_neutral ON tenants ((true)) WHERE is_neutral = true;
```

**SRS-DB-011** [`10-domain-model.md` SRS-DOM-036/052/057] Частичные уникальные индексы выше —
физическая гарантия инвариантов «не более одной активной сущности», продублированная в domain как
guard-проверка ПЕРЕД вставкой (домен проверяет через порт до создания — быстрый путь без ожидания
исключения БД); индекс — последний рубеж защиты от гонки (два конкурентных запроса одновременно
проходят доменную проверку до commit друг друга) — конфликт индекса маппится в
`DuplicateActiveReturnError`/`DuplicateNonTerminalDisputeError` через перехват кода ошибки
PostgreSQL `23505` в `infrastructure`-репозитории, не пробрасывается наружу как сырое `23505`.

---

## Полнотекстовый поиск

> Реализация Charter ADR №1 (`00-PROJECT-CHARTER.md` §3.5, №1): PostgreSQL FTS вместо Elasticsearch.
> `SEARCH_DRIVER=postgres` (дефолт) — `PostgresSearchProvider` за интерфейсом `SearchProvider`;
> `SEARCH_DRIVER=elasticsearch` — опциональный адаптер, схема данных не меняется.

### Расширения (§«Принципы» SRS-DB-007)

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gin;
```

**SRS-DB-012** [Charter §3.5 №1] `pg_trgm` даёт триграммное сходство (приближение к расстоянию
Левенштейна для коротких строк аптечных названий) — покрывает REQ-MARKET-3/CUJ-1 («цытрамон» →
«цитрамон») без JVM-зависимости Elasticsearch (~1 ГБ RAM экономии, обоснование ADR).

### Генерируемая колонка `search_vector` (уже объявлена в DDL `medicines`)

```sql
search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('russian', unaccent(coalesce(trade_name, ''))), 'A') ||
    setweight(to_tsvector('russian', unaccent(coalesce(inn_name, ''))), 'A') ||
    setweight(to_tsvector('russian', unaccent(coalesce(manufacturer_name, ''))), 'C')
) STORED;
```

**SRS-DB-013** [REQ-UX-14] Конфигурация словаря — `russian` (встроенный словарь PostgreSQL,
покрывает морфологию русского языка — единственный из трёх языков продукта (tj/ru/en) с
полноценным морфологическим словарём в PG16 «из коробки»). `unaccent` применяется ПЕРЕД
`to_tsvector`, что нормализует диакритику латиницы/кириллицы, но **не решает** проблему таджикской
кириллицы напрямую — см. ниже.

### Обработка таджикской кириллицы (`ӣ ӯ ҳ қ ғ ҷ`) и транслита [REQ-UX-14]

**SRS-DB-014** Стандартный словарь `unaccent` PostgreSQL **не знает** специфичных букв таджикского
алфавита (`ғ, ӣ, қ, ӯ, ҳ, ҷ`) — они не являются диакритическими вариантами кириллических букв в
смысле Unicode NFD-разложения (это отдельные кодовые точки, не «буква + комбинирующий диакритик»),
поэтому `unaccent('ӯ')` возвращает `'ӯ'` без изменений. Решение — **кастомный unaccent-словарь**:

```sql
-- Файл словаря: $SHAREDIR/tsearch_data/tajik_unaccent.rules
-- Формат: <исходный_символ><TAB><символ(ы)_замены>
-- ӣ    и
-- ӯ    у
-- ҳ    х
-- қ    к
-- ғ    г
-- ҷ    ч
-- Заглавные варианты аналогично (Ӣ->И, Ӯ->У, Ҳ->Х, Қ->К, Ғ->Г, Ҷ->Ч).

CREATE TEXT SEARCH DICTIONARY tajik_unaccent (
    TEMPLATE = unaccent,
    RULES = 'tajik_unaccent'
);

-- Композитная конфигурация: сначала снимает тадж. спецбуквы к ближайшим русским эквивалентам,
-- затем обычный unaccent (диакритика), затем russian-словарь.
CREATE TEXT SEARCH CONFIGURATION tajik_ru (COPY = russian);
ALTER TEXT SEARCH CONFIGURATION tajik_ru
    ALTER MAPPING FOR word, hword, hword_part
    WITH tajik_unaccent, unaccent, russian_stem;
```

**SRS-DB-015** [REQ-UX-14] Генерируемая колонка `search_vector` переключается на функциональный
эквивалент `to_tsvector('tajik_ru', ...)` вместо `to_tsvector('russian', ...)` — таблица словаря
разворачивания (`tajik_unaccent.rules`) поставляется как файл миграции
(`infra/postgres/tsearch_data/tajik_unaccent.rules`), устанавливаемый в `share/tsearch_data` образа
Docker (Dockerfile-шаг `COPY` + `docker-entrypoint-initdb.d` скрипт, т.к. файл словаря должен
физически существовать на файловой системе сервера ДО `CREATE TEXT SEARCH DICTIONARY`).

**SRS-DB-016** [Персона «Биби Хосият», research 06 §8.3] Транслит (ввод таджикских слов латиницей
или русскими буквами без спецсимволов на Android-клавиатуре без таджикской раскладки) НЕ решается
словарём `to_tsvector` — это решается на уровне `pg_trgm` fuzzy-фолбэка (ниже): пользователь вводит
`«qalb»` вместо `«калб»` (сердце) — точное текстовое совпадение невозможно ни в одной конфигурации
словаря, только триграммное сходство после нормализации латиницы в кириллицу простой таблицей
транслитерации на уровне `application` (`TransliterationNormalizerService`, ЧИСТАЯ функция без
внешних вызовов, domain-независимая утилита), ПЕРЕД тем как строка передаётся в SQL-запрос ниже.

### Функция `similarity()` и пороги [REQ-UX-13]

**SRS-DB-017** [REQ-UX-13] Порог `pg_trgm.similarity_threshold` — **0.20** (диапазон 0.15–0.25 из
REQ-UX-13, дефолт PostgreSQL 0.3 ПЕРЕОПРЕДЁН как заниженный для коротких аптечных названий):

```sql
-- Устанавливается per-сессию (connection pool init hook, infrastructure) — НЕ глобально в
-- postgresql.conf, чтобы разные типы запросов (поиск vs 1С-матчинг) могли использовать разный порог.
SET pg_trgm.similarity_threshold = 0.20;
```

**SRS-DB-018** [D-06, REQ-SYNC-6] Порог composite-матчинга 1С-выгрузок (`InventoryFacade`) —
**0.35** (строже порога пользовательского поиска, т.к. неверный автоматический матч в каталоге
опаснее нерелевантного результата поиска) — задаётся явно в запросе через `similarity(a, b) >= 0.35`,
не через сессионный GUC.

### Готовые SQL-запросы поиска

```sql
-- 1) Поиск по каталогу (CUJ-1): комбинация полнотекстового ранжирования + триграммный фолбэк,
--    исключение control_category запрещённых к дистанционной продаже (SRS-DOM-157),
--    видимость только опубликованных (is_published) и активных аптек/сетей (REQ-ONBOARD-11).
SELECT
    m.id, m.trade_name, m.inn_name, m.dosage_form, m.dosage_strength,
    ts_rank(m.search_vector, plainto_tsquery('tajik_ru', :query)) AS rank,
    similarity(m.trade_name, :query) AS trgm_score
FROM medicines m
WHERE m.is_published = true
  AND m.control_category NOT IN ('psychotropic', 'narcotic') -- SRS-DOM-157, жёсткий фильтр API
  AND (
        m.search_vector @@ plainto_tsquery('tajik_ru', :query)
        OR m.trade_name % :query   -- % оператор pg_trgm, использует similarity_threshold сессии
        OR m.inn_name % :query
      )
ORDER BY
    (m.search_vector @@ plainto_tsquery('tajik_ru', :query)) DESC, -- точные tsvector-совпадения первыми
    GREATEST(ts_rank(m.search_vector, plainto_tsquery('tajik_ru', :query)), similarity(m.trade_name, :query)) DESC
LIMIT 30;

-- 2) Наличие и цена в конкретном радиусе (JOIN на pharmacy_inventory + гео-фильтр GiST):
SELECT
    m.id AS medicine_id, m.trade_name, pi.price_tjs, ph.name AS pharmacy_name, ph.id AS pharmacy_id,
    ST_Distance(ph.geo_point, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography) AS distance_m
FROM medicines m
JOIN pharmacy_inventory pi ON pi.medicine_id = m.id AND pi.stock_quantity > 0
JOIN pharmacies ph ON ph.id = pi.pharmacy_id
    AND ph.status = 'active'
WHERE m.id = :medicine_id
  AND ST_DWithin(ph.geo_point, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography, :radius_meters)
ORDER BY pi.price_tjs ASC; -- сортировка по цене — REQ-MARKET-3, tz.log Модуль 1

-- 3) Блок аналогов по МНН (SRS-DOM-158, D-07) — через substances, НЕ через inn_name-строку:
WITH target_substances AS (
    SELECT ms.substance_id, ms.strength_value, ms.strength_unit
    FROM medicine_substances ms
    WHERE ms.medicine_id = :current_medicine_id
),
target_form AS (
    SELECT dosage_form_class FROM medicines WHERE id = :current_medicine_id
)
SELECT m.id, m.trade_name, pi.price_tjs, ph.name AS pharmacy_name
FROM medicines m
JOIN pharmacy_inventory pi ON pi.medicine_id = m.id AND pi.stock_quantity > 0
JOIN pharmacies ph ON ph.id = pi.pharmacy_id AND ph.status = 'active'
WHERE m.id != :current_medicine_id
  AND m.dosage_form_class = (SELECT dosage_form_class FROM target_form)
  AND m.control_category NOT IN ('psychotropic', 'narcotic')
  -- множество substances препарата B ИДЕНТИЧНО множеству substances препарата A (не подмножество):
  AND (SELECT array_agg(ms2.substance_id ORDER BY ms2.substance_id) FROM medicine_substances ms2 WHERE ms2.medicine_id = m.id)
      = (SELECT array_agg(ts.substance_id ORDER BY ts.substance_id) FROM target_substances ts)
  -- дозировка каждого совпадающего вещества эквивалентна (упрощённо: точное совпадение после
  -- конвертации в базовую единицу — полная логика в Dosage.isEquivalentTo(), это SQL-приближение
  -- для первичной фильтрации, финальная проверка — в application):
  AND NOT EXISTS (
        SELECT 1 FROM medicine_substances ms3
        JOIN target_substances ts2 ON ts2.substance_id = ms3.substance_id
        WHERE ms3.medicine_id = m.id
          AND ms3.strength_unit = ts2.strength_unit
          AND ms3.strength_value != ts2.strength_value
      )
ORDER BY pi.price_tjs ASC; -- сохраняет формулировку tz.log §II.3 (сортировка по цене возрастанию)

-- 4) D-06 composite-матчинг шаг 3 (fuzzy trigram при 1С-импорте, REQ-SYNC-6), порог 0.35:
SELECT m.id, similarity(m.trade_name, :raw_trade_name) AS score
FROM medicines m
WHERE m.dosage_form = :raw_dosage_form
  AND similarity(m.trade_name, :raw_trade_name) >= 0.35
ORDER BY score DESC
LIMIT 5; -- топ-5 кандидатов -> при неоднозначности (score второго кандидата близок к первому) -> catalog_match_queue
```

**SRS-DB-019** [REQ-UX-12] Автокомплит (debounce 150–300мс на клиенте, вне схемы БД) обязан
использовать `LIMIT 10` и **prefix-first** стратегию (`m.trade_name ILIKE :query || '%'` через
обычный B-tree, не триграммный индекс, для запросов короче 3 символов — триграммы неэффективны на
очень коротких строках) — переключение на триграммный поиск (запрос 1 выше) происходит только при
`length(:query) >= 3`.

---

## Целостность и инварианты на уровне БД

> Философия (Charter §5, `02` §2): БД — ПОСЛЕДНИЙ рубеж защиты, не первый и не единственный. Каждый
> `CHECK`/триггер ниже дублирует доменный инвариант из `10-domain-model.md`, указанный в скобках —
> отсутствие домена-источника для constraint'а было бы запахом (правило появилось «снизу», а не как
> отражение бизнес-правила).

### Сводная таблица CHECK-constraints (уже объявлены в DDL §3, собраны здесь для обзора)

| Таблица | Constraint | Проверяет | Источник |
|---|---|---|---|
| `medicines` | `chk_medicines_control_category_requires_rx` | `control_category IN (potent,psychotropic,narcotic) ⇒ is_prescription_required` | SRS-DOM-015 |
| `medicine_substances` | `chk_medicine_substances_strength_positive` | `strength_value > 0` | Money/Dosage VO инвариант |
| `inventory_batches` | `chk_inventory_batches_quantity_nonneg` | `quantity >= 0` | SRS-DB-005 |
| `inventory_batches` | `chk_inventory_batches_price_positive` | `price_diram > 0 ИЛИ quantity = 0` | SRS-DOM-024 |
| `orders` | `chk_orders_total_matches_sum` | `total_amount_tjs = items_total_tjs + delivery_fee_tjs` | SRS-DOM-003 |
| `orders` | `chk_orders_amounts_nonnegative` | все три поля `>= 0` | SRS-DB-005 |
| `order_items` | `chk_order_items_price_positive` | `unit_price_tjs > 0` | SRS-DB-005, «цена > 0» |
| `order_items` | `chk_order_items_quantity_positive` | `quantity > 0` | — |
| `order_items` | `chk_order_items_total_matches` | `total_price_tjs = unit_price_tjs * quantity` | арифметическая целостность |
| `escrow_ledger` | `chk_escrow_ledger_amount_positive` | `amount_diram > 0` (знак — через `direction`) | SRS-DOM-067 |
| `escrow_ledger` | `chk_escrow_ledger_adjustment_requires_reason` | `adjustment ⇒ reason И actor_user_id NOT NULL` | SRS-DOM-035 |
| `payout_schedule` | `chk_payout_schedule_net_matches` | `net = gross - commission` | REQ-MON-4 |
| `platform_fee` | `chk_platform_fee_bps_range` | `commission_bps BETWEEN 0 AND 10000` | SRS-DOM-160 |
| `platform_fee` | `chk_platform_fee_date_range` | `effective_to > effective_from` (если задан) | — |
| `order_disputes` | `chk_order_disputes_terminal_requires_reason` | терминальный статус ⇒ `resolution_reason` И `resolved_by_user_id` | SRS-DOM-060, REQ-DISPUTE-13 |
| `order_returns` | `chk_order_returns_fee_nonneg` | `courier_return_fee_diram >= 0` | REQ-RET-7 |
| `delivery_assignments` | `chk_delivery_cash_matches` | `cash_collected_diram >= cash_change_diram` | SRS-DOM-040 (полная проверка равенства — в application, см. ниже) |
| `courier_earnings` | `chk_courier_earnings_amount_positive` | `amount_diram > 0` | — |
| `courier_payouts` | `chk_courier_payouts_period` / `_amount_nonneg` | период корректен, сумма `>= 0` | — |
| `platform_billing_invoices` | `chk_billing_invoices_total_matches` / `_period` | `total = subtotal + vat`, период корректен | REQ-MON-9 |
| `tenants` | `chk_tenants_neutral_has_no_chain` | нейтральный тенант не привязан к сети | SRS-DOM-042 |
| `tenant_settings` | `chk_tenant_settings_sla_ranges` | SLA-параметры в допустимых диапазонах | D-04, D-19 |
| `pharmacy_verification` | `chk_pharmacy_verification_one_subject` | ровно один из `pharmacy_id`/`chain_id` | REQ-ONBOARD-1 |
| `onboarding_review_log` | `chk_onboarding_log_one_subject` | хотя бы один из `pharmacy_id`/`chain_id` | REQ-ONBOARD-7 |
| `tenant_courier_payout_rules` | `chk_payout_rules_type_fields` | поля соответствуют `rule_type` | REQ-COUR-4 |
| `cart` | `chk_cart_owner` | хотя бы один из `customer_id`/`session_token` | — |
| `cart_items` | `chk_cart_items_quantity_positive` | `quantity > 0` | — |
| `orders` ⨯ `escrow_ledger` | *нет constraint'а, см. SRS-DB-050* | `orders.status = 'paid_escrow' ⟺ EXISTS(SELECT 1 FROM escrow_ledger WHERE order_id = orders.id)` | D-25 п.4 |

**SRS-DB-050** [D-25 п.4, «новый инвариант, обязателен к покрытию тестом»] **Инвариант
«`orders.status = 'paid_escrow'` ⟺ для заказа существуют строки `escrow_ledger`» НЕ выражается как
`CHECK`-ограничение** — по той же причине, что и реконсиляция `escrow_ledger` (комментарий к
`escrow_ledger.entry_type` выше): PostgreSQL `CHECK` видит только строку своей же таблицы в момент
записи, а этот инвариант — по конструкции кросс-табличный (`orders.status` против существования
строк в ДРУГОЙ таблице, `escrow_ledger`). Декларативно (без триггера) это невыразимо в принципе.

Триггерная альтернатива технически существует (`CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY
DEFERRED` на `orders`, проверяющий на COMMIT транзакции `NOT (NEW.status = 'paid_escrow' AND NOT
EXISTS (SELECT 1 FROM escrow_ledger WHERE order_id = NEW.id))`) — она решала бы проблему порядка
записи внутри одной транзакции (webhook-обработчик сначала обновляет `orders.status`, затем пишет
`escrow_ledger`, или наоборот — DEFERRED триггер увидит финальное состояние на COMMIT). Проект
СОЗНАТЕЛЬНО её не заводит: это добавило бы триггер, который валит COMMIT платёжного вебхука при
любой рассинхронизации инфраструктуры (ретрай, частичная запись), то есть само наличие триггера
стало бы новой точкой отказа критичного платёжного пути — цена выше, чем у джобы-реконсиляции.
Вместо декларативного ограничения инвариант обеспечивается:

1. **Доменом** — `Order.markPaid(webhookPayload)` и `EscrowLedger.recordHold(order)` вызываются
   ТОЛЬКО вместе, одной прикладной транзакцией, внутри одного use case (`ProcessPaymentWebhookUseCase`),
   никогда по отдельности; переход `pending_payment → paid_escrow` вне этого use case запрещён
   доменом (SRS-DOM-089, SRS-PAY-018), а `Order.create()` для `cash_courier` явно уходит в
   `confirmed`, не в `paid_escrow` (D-25 п.2) — то есть код, способный проставить `paid_escrow` без
   параллельной записи `escrow_ledger`, в системе отсутствует по построению.
2. **Интеграционным тестом** `TC-DB-029` (ниже) — прогоняется в CI при каждом изменении
   `ProcessPaymentWebhookUseCase`/`AdminPaymentOverrideUseCase`, а не только на пороге релиза,
   именно потому что инвариант не защищён на уровне схемы.

**SRS-DB-020** [Charter §5, «expiry_date > created_at»] Явного `CHECK (expiry_date > created_at)` на
`inventory_batches`/`pharmacy_inventory` **намеренно нет** как constraint строки: срок годности
партии, поступившей СЕГОДНЯ с уже истёкшим сроком — валидная (хоть и бесполезная для продажи)
запись 1С-выгрузки, которую нельзя ОТКЛОНИТЬ на уровне вставки (иначе аптека не сможет
задокументировать списание просроченной партии через `inventory_sync`). Вместо этого действует
**инвариант продажи** (SRS-DOM-021, REQ-REG-6): `ExpiryDate.isSellable()` фильтрует такие партии из
`stock_quantity`/FEFO-выбора на уровне триггера пересчёта (ниже) и на уровне domain — просроченная
партия не удаляется физически (аудит/возврат/утилизация), но не участвует в продаже.

### Триггеры

**SRS-DB-021** [REQ-SYNC-8, SRS-DOM-019/020] Денормализованные `pharmacy_inventory.price_tjs`/
`stock_quantity`/`batch_number`/`expiry_date` (сохранены 1:1 из `tz.log` для читаемости и обратной
совместимости витрины) пересчитываются триггером при любом изменении `inventory_batches`:

```sql
CREATE OR REPLACE FUNCTION trg_recompute_fefo() RETURNS TRIGGER AS $$
DECLARE
    v_inventory_id UUID := COALESCE(NEW.pharmacy_inventory_id, OLD.pharmacy_inventory_id);
    v_stock INT;
    v_fefo RECORD;
BEGIN
    -- SRS-DOM-019: сумма количества непросроченных партий с quantity > 0.
    SELECT COALESCE(SUM(quantity), 0) INTO v_stock
    FROM inventory_batches
    WHERE pharmacy_inventory_id = v_inventory_id
      AND quantity > 0
      AND expiry_date > CURRENT_DATE;

    -- SRS-DOM-020: партия с минимальным expiry_date среди непросроченных с quantity > 0 (FEFO).
    SELECT batch_number, price_diram, expiry_date INTO v_fefo
    FROM inventory_batches
    WHERE pharmacy_inventory_id = v_inventory_id
      AND quantity > 0
      AND expiry_date > CURRENT_DATE
    ORDER BY expiry_date ASC
    LIMIT 1;

    UPDATE pharmacy_inventory
    SET stock_quantity = v_stock,
        price_tjs = COALESCE(v_fefo.price_diram, 0) / 100.0,
        batch_number = v_fefo.batch_number,
        expiry_date = COALESCE(v_fefo.expiry_date, expiry_date), -- NOT NULL: сохраняет прежнее, если партий нет
        last_synced_at = NOW()
    WHERE id = v_inventory_id;

    RETURN NULL; -- AFTER-триггер, возврат не используется
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventory_batches_recompute
    AFTER INSERT OR UPDATE OF quantity, expiry_date, price_diram OR DELETE ON inventory_batches
    FOR EACH ROW EXECUTE FUNCTION trg_recompute_fefo();
```

**SRS-DB-022** [`02` §2.1, `01` §5] Триггер выполняет ТОЛЬКО механический пересчёт денормализации —
он НЕ содержит бизнес-правил (порог COD, комиссии, авторизацию) — это соответствует правилу Charter
«домен на сервере, БД — не место для бизнес-логики». Триггер — инфраструктурная гарантия
консистентности читаемой проекции, а не замена `PharmacyInventory.applyDelta()`
(`SRS-DOM-022/023`), которая остаётся единственным путём ИЗМЕНЕНИЯ `inventory_batches` из
application-слоя.

**SRS-DB-023** [Charter §5, «updated_at»] Универсальный триггер `set_updated_at()` навешивается на
каждую таблицу с колонкой `updated_at` (`orders`, `pharmacy_chains`, `pharmacies`, `medicines`,
`tenant_settings`, `payout_schedule`, `payment_operations`, `cart`, `dispute...`) — генерируется
Drizzle-миграцией автоматически по списку таблиц, не переписывается вручную на каждую:

```sql
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- Пример навешивания (повторяется для каждой таблицы со столбцом updated_at):
CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

**SRS-DB-024** [SRS-DOM-031, D-02] `escrow_ledger` и `audit_log` — append-only на уровне
ПРИВИЛЕГИЙ роли БД (не через триггер `RAISE EXCEPTION`, что было бы избыточным дублированием):
прикладная роль подключения (`app_role`) получает `GRANT INSERT, SELECT` без `UPDATE, DELETE` на
эти две таблицы (см. §7 «Изоляция тенантов» — там же описана модель ролей БД). `super_admin`-DBA
доступ для расследований — через отдельную роль `dorutj_dba` вне прикладного пула соединений.

---

## Изоляция тенантов

**SRS-DB-025** [Charter §3.4] Модель изоляции — **shared database, обязательный `tenant_id`-скоуп
на уровне репозитория** (не отдельная схема/БД на тенант — операционно неоправданно на
предполагаемом масштабе White-Label в MVP: единицы-десятки тенантов, не тысячи). Каждая таблица с
данными, принадлежащими тенанту прямо или транзитивно, несёт колонку `tenant_id` ЛИБО выводит
тенанта через цепочку FK (`pharmacy_id → pharmacies.chain_id → pharmacy_chains.tenant_id`).

### Прямой vs транзитивный tenant-скоуп

| Механизм | Таблицы | Комментарий |
|---|---|---|
| **Прямая колонка `tenant_id`** | `users`, `orders`, `cart`, `prescriptions`, `support_tickets`, `notifications`, `i18n_overrides`, `outbox`, `audit_log` | Быстрый `WHERE tenant_id = :ctx`, обязателен для таблиц с высокочастотным доступом по тенанту |
| **Транзитивный через `pharmacy_id`/`chain_id`** | `pharmacies` (→`chain_id`→`pharmacy_chains.tenant_id`), `pharmacy_inventory`, `inventory_batches`, `payout_schedule`, `courier_earnings` | Тенант физически ОДИН на аптечную сеть (White-Label = вся сеть под одним тенантом), нет смысла дублировать `tenant_id` в каждой дочерней строке — источник истины один |
| **Глобальные (не тенант-скоупированы)** | `medicines`, `substances`, `categories`, `medicine_substances` | Каталог МНН — ОБЩИЙ для всех тенантов (нейтральный DoruTJ и White-Label сети продают из ОДНОГО справочника медикаментов, различаются только `pharmacy_inventory`/ценами) |

**SRS-DB-026** [Charter §3.4, CUJ-7] Guard уровня `infrastructure`: `TenantScopedRepository`
(базовый класс/примесь) **отказывается выполнить любой запрос**, если `TenantContext` (наполняемый
`TenantResolutionMiddleware` из `Host`/`X-Tenant-Slug`) не резолвлен в текущем request-скоупе —
бросает `TenantContextMissingError` (500, эксплуатационный алерт, не пользовательская ошибка: это
значит, что middleware не была подключена к роуту — дефект конфигурации, не ожидаемый кейс). Прямой
`db.select().from(orders)` без прохождения через `TenantScopedRepository` — нарушение,
обнаруживается `dependency-cruiser`-правилом (`02` §6): импорт `drizzle-orm`-клиента напрямую в
`application`/`presentation`, минуя `infrastructure/repositories/*`, запрещён архитектурно
независимо от тенантности.

**SRS-DB-027** [Charter §3.4] Специальный случай — **платформенный пул курьеров**
(`couriers.chain_id IS NULL`): guard тенантности **сознательно пропускает** такие строки для ЛЮБОГО
tenant-контекста (REQ-COUR-1) — это единственное исключение из строгого скоупа, реализованное явно
условием в репозитории (`WHERE chain_id IS NULL OR chain_id = :currentTenantChainId`), а не отказом
от скоупа целиком.

### Почему НЕ Row-Level Security (RLS) как основной механизм

**SRS-DB-028** [Charter §3.4, обоснование отклонения] RLS (`CREATE POLICY ... USING (tenant_id =
current_setting('app.tenant_id'))`) **не выбран основным механизмом** по трём причинам:
1. Требует установки `SET LOCAL app.tenant_id = ...` в КАЖДОЙ транзакции пула соединений
   (`pg-pool`/Drizzle) — легко забыть в одном из воркеров (`apps/worker`), что даёт ложное чувство
   защищённости («RLS включён — значит, безопасно») при реальной дыре в конкретном пути кода.
2. Транзитивный скоуп (через `pharmacy_id`/`chain_id`, см. таблицу выше) плохо выражается декларативной
   RLS-политикой без дублирования `tenant_id` в каждую дочернюю таблицу (что само по себе
   денормализация, требующая отдельного обоснования).
3. Провайдер платежей/OCR/1С-джобы (`apps/worker`) обслуживают ВСЕ тенанты одним процессом —
   RLS-политика на уровне роли БД плохо сочетается с батчевой межтенантной обработкой
   (`inventory_sync_batches`, `payout_schedule`-джоба).

**SRS-DB-029** [Charter §3.4, компенсирующий контроль] Вместо RLS — **обязательный** guard уровня
`infrastructure` (SRS-DB-026) + **обязательный e2e-тест на утечку данных между тенантами** (CUJ-7,
Charter §3.4: «Обязателен тест на утечку данных между тенантами») как часть `pnpm verify` (см. §10
«Тестовые сценарии», TC-DB-CROSS-TENANT). RLS **разрешён как ДОПОЛНИТЕЛЬНЫЙ, необязательный** рубеж
защиты (defense-in-depth) на продовом окружении для таблиц с прямой колонкой `tenant_id`
(`orders`, `users`, `prescriptions`) — включается отдельной миграцией `NNNN_enable_rls_defense_in_depth.sql`
ПОСЛЕ MVP, не блокирует запуск:

```sql
-- ПОСТ-MVP, опционально (SRS-DB-029): второй, независимый рубеж поверх guard'а приложения.
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_orders ON orders
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

**SRS-DB-030** [Charter §5, роли БД] Прикладной пул соединений (`apps/api`, `apps/worker`)
подключается под ролью `app_role` с правами `SELECT, INSERT, UPDATE, DELETE` на все таблицы, КРОМЕ
`escrow_ledger`/`audit_log` (только `SELECT, INSERT`, SRS-DB-024) — `app_role` НЕ является
суперпользователем и не может выполнить `TRUNCATE`/`DROP` ни на одной таблице (защита от
случайного/скомпрометированного полного стирания данных из прикладного кода). Миграции выполняются
отдельной ролью `migrator_role` с правами DDL, используемой ТОЛЬКО раннером `drizzle-kit migrate` в
CI/деплое, никогда — рантайм-процессом `apps/api`.

---

## Миграции

### Стратегия Drizzle

**SRS-DB-031** [Charter §3.1] `drizzle-kit` в режиме `generate` (schema-first): TypeScript-схема в
`apps/api/src/infrastructure/db/schema/*.schema.ts` — источник истины, `drizzle-kit generate`
производит SQL-миграцию diff'ом от текущего состояния БД (снапшот в
`drizzle/meta/_journal.json`). Ручные миграции (расширения, кастомные типы `GEOGRAPHY`, триггеры,
`tsearch_data`-словарь) добавляются как **custom SQL migration** через `drizzle-kit generate --custom`,
не через попытку выразить их в TS-схеме (Drizzle не умеет декларативно описывать триггеры/
`CREATE TEXT SEARCH CONFIGURATION`).

**SRS-DB-032** [`02` §6, CI] Единственная команда применения — `pnpm db:migrate`
(`drizzle-kit migrate`), запускаемая: (а) локально после `pnpm install` (Charter §2, DoD пункт 2);
(б) в `docker compose up` через `entrypoint`-скрипт `apps/api` перед стартом (Charter §2, пункт 1);
(в) в CI перед `pnpm test:e2e`. Никогда — `drizzle-kit push` (прямая синхронизация схема→БД без
файла миграции) в средах, отличных от локального прототипирования разработчика ДО первого коммита
схемы — `push` не оставляет аудируемого файла миграции.

### Порядок миграций (топологический, соответствует группам §3)

```
0001_extensions.sql              -- pgcrypto, pg_trgm, unaccent, btree_gin, postgis (для GEOGRAPHY)
0002_enums.sql                   -- все CREATE TYPE из §2
0003_tajik_search_config.sql     -- custom: tajik_unaccent словарь + tajik_ru конфигурация (§5)
0004_catalog_base.sql            -- categories, substances, medicines, medicine_substances
0005_org_base.sql                -- pharmacy_chains, pharmacies (без FK на tenants — отложен)
0006_tenancy_identity.sql        -- tenants, tenant_settings, users, user_addresses, otp_codes, refresh_tokens
0007_inventory.sql               -- pharmacy_inventory, inventory_batches, pharmacy_sku_mapping,
                                  --   catalog_match_queue, inventory_sync_batches, inventory_sync_errors
0008_orders_cart.sql             -- orders, order_items, cart, cart_items, favorites (без FK courier/prescription)
0009_payments.sql                -- escrow_ledger, payout_schedule, platform_fee, payment_operations
0010_returns_disputes.sql        -- order_returns, support_tickets, order_disputes, dispute_status_history
0011_prescriptions.sql           -- prescriptions + ALTER orders ADD FK prescription_id
0012_delivery.sql                -- couriers, delivery_assignments, courier_earnings,
                                  --   tenant_courier_payout_rules, courier_payouts
                                  --   + ALTER orders/order_returns ADD FK courier_id
0013_onboarding.sql              -- pharmacy_api_keys, pharmacy_verification, onboarding_review_log
0014_platform.sql                -- audit_log, outbox, processed_events, platform_billing_invoices,
                                  --   notifications, i18n_overrides
0015_deferred_fks.sql            -- pharmacy_chains.tenant_id, catalog_match_queue.resolved_by,
                                  --   payout_schedule.held_by_dispute_id, courier_earnings.payout_batch_id
0016_indexes.sql                 -- все CREATE INDEX из §4 (отдельно от DDL — быстрее первичная загрузка сидов)
0017_triggers_and_checks.sql     -- trg_recompute_fefo, set_updated_at, доп. CHECK, не выразимые в Drizzle TS
0018_search_vector_tajik.sql     -- переключение search_vector на конфигурацию tajik_ru (после 0003)
9999_seed.sql / seed.ts          -- см. ниже, отдельно от схемы, идемпотентно (upsert по natural key)

--- эволюция ПОСЛЕ baseline (не переупорядочивается задним числом, применяется по факту решений) ---
0019_order_status_add_confirmed.sql -- [D-25] ALTER TYPE order_status ADD VALUE 'confirmed'
                                  --   BEFORE 'paid_escrow', вне транзакции (SRS-DB-009/049)
```

**SRS-DB-033** [`02` §6] `0016_indexes.sql` вынесен ОТДЕЛЬНО от DDL-миграций таблиц: массовая
загрузка сидов (0300+ медикаментов, демо-заказы) быстрее без активных вторичных индексов —
`CREATE TABLE` → `seed` (частично, только справочники без FK-зависимости от индексов) не
практикуется намеренно; порядок «все таблицы → все индексы → полный seed» проще для ревью и
достаточен на объёме MVP (индексы на 300 строк создаются мгновенно, оптимизация «сначала данные,
потом индексы» не имеет измеримого эффекта на этом масштабе).

### Обратимость

**SRS-DB-034** [`02` §6, эксплуатация] Drizzle-kit генерирует ТОЛЬКО forward-миграции (`up`) — нет
автоматического `down.sql`. Политика проекта: **каждая миграция, изменяющая существующую таблицу
(не только `CREATE TABLE` новой), обязана иметь sibling-файл** `NNNN_description.down.sql`,
написанный вручную разработчиком в том же PR (проверяется code review чек-листом, не CI — откат
DDL с данными нельзя протестировать автоматически без риска). Миграции чистого `CREATE TABLE`/
`CREATE TYPE` новой сущности имеют тривиальный `down` (`DROP TABLE IF EXISTS ...`), генерируемый
скриптом `pnpm db:generate-down` по журналу `_journal.json`.

**SRS-DB-035** Откат `ALTER TYPE ... ADD VALUE` (SRS-DB-009) **физически необратим** без пересоздания
типа (PostgreSQL не поддерживает `DROP VALUE` для enum) — политика: такие миграции опускают
`down`-файл, сопровождаются явным комментарием `-- IRREVERSIBLE: enum value addition` и требуют
отдельного одобрения архитектора в PR (не блокирует CI, но блокирует merge без ревью человека).

**SRS-DB-036** Продакшн-откат `0017_triggers_and_checks.sql` — тривиален (`DROP TRIGGER`/
`DROP FUNCTION`), включён в `down`-файл этой миграции по умолчанию.

**SRS-DB-049** [D-25, эксплуатация] **Добавление значения `'confirmed'` в `order_status` —
эволюционная миграция ПОСЛЕ baseline** (§8, список 0001..0018 уже развёрнут), отдельным файлом
`0019_order_status_add_confirmed.sql`, не смешанным ни с одной другой DDL- или DML-операцией:

```sql
-- 0019_order_status_add_confirmed.sql
-- disable-transaction  (см. SRS-DB-009 — раннер обязан выполнить ЭТОТ файл вне BEGIN/COMMIT)
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'confirmed' BEFORE 'paid_escrow';
```

Особенности PostgreSQL, обязательные к соблюдению (проект — PostgreSQL 16, `01-TECH-BASELINE.md`):

- До PostgreSQL 12 `ALTER TYPE ... ADD VALUE` вообще запрещалась внутри блока транзакции
  (`25001 active_sql_transaction`). Начиная с PG12 команду разрешили запускать в транзакции, но
  НОВОЕ значение всё ещё нельзя ИСПОЛЬЗОВАТЬ (сравнивать, вставлять, кастовать) в этой же
  транзакции — попытка даёт `55P04 unsafe_use_of_new_value` (это и есть сценарий SRS-DB-046/
  TC-DB-023). Поэтому файл выше остаётся однострочным и помечается `-- disable-transaction`
  (SRS-DB-009): раннер `drizzle-kit migrate` обязан выполнить его отдельным подключением/без общей
  транзакции с соседними миграциями, а не полагаться на то, что «PG16 разрешает» — разрешение
  касается только самой команды `ADD VALUE`, не последующего использования значения.
- `BEFORE 'paid_escrow'` — не косметика: без указания позиции значение добавляется В КОНЕЦ списка
  меток типа, что не ломает корректность (enum сравнивается не по алфавиту и не по позиции для
  равенства), но portит порядок в `\dT+`/интроспекции и в любом коде, который (ошибочно) полагался
  бы на позиционное упорядочивание `pg_enum.enumsortorder`. `ADD VALUE ... BEFORE|AFTER` — синтаксис
  доступен начиная с PostgreSQL 12, применим напрямую без отдельного шага переупорядочивания.
- Drizzle-kit `generate` (schema-first diff, SRS-DB-031) не умеет декларативно выразить
  `ADD VALUE ... BEFORE` — файл пишется вручную как custom-миграция (`drizzle-kit generate --custom`),
  как и прочие ручные миграции проекта (триггеры, `GEOGRAPHY`, `tsearch`-словарь).
- Порядок применения двух правок веден строго: (1) SQL-миграция `0019` катится в БД; (2) ТОЛЬКО
  после её подтверждённого применения — правка `orderStatusEnum` в
  `enums.schema.ts` (добавление литерала `'confirmed'` в TS-массив), отдельным коммитом. Обратный
  порядок означал бы, что рантайм-код уже способен писать/сравнивать `'confirmed'` до того, как это
  значение существует в типе БД — первая же попытка `INSERT/UPDATE` даст `22P02 invalid_input_value`.
  Само по себе `pgEnum(...)` в Drizzle — только список TS-литералов для типизации, оно не создаёт и
  не проверяет тип на стороне БД при `migrate` (в отличие от `push`, который здесь не используется,
  SRS-DB-032), так что окно «в БД есть, в TS ещё нет» безопасно, а обратное — нет.
- **Обратимость.** Как и для любого `ADD VALUE` (SRS-DB-035), `0019` физически необратима штатными
  средствами PostgreSQL — команды `DROP VALUE` для enum не существует. `down`-файл для `0019` НЕ
  создаётся (политика SRS-DB-035): вместо него — комментарий `-- IRREVERSIBLE: enum value addition`
  и обязательное одобрение архитектора в PR. Если когда-либо потребуется ИСТИННЫЙ откат (например,
  полный revert D-25), единственный путь в PostgreSQL — пересоздание типа, а не удаление значения:
  ```sql
  CREATE TYPE order_status_new AS ENUM (
      'pending_payment', 'paid_escrow', 'processing', 'picked_up',
      'delivered', 'cancelled', 'refunded', 'return_in_progress'
  ); -- без 'confirmed'
  ALTER TABLE orders ALTER COLUMN status TYPE order_status_new
      USING status::text::order_status_new; -- падает 22P02, если ЕСТЬ строки со status='confirmed'
  DROP TYPE order_status;
  ALTER TYPE order_status_new RENAME TO order_status;
  ```
  Это ручной запасной план, документированный здесь, а НЕ автоматизированный `down`-скрипт: он
  требует предварительной миграции данных существующих `'confirmed'`-заказов и простоя записи в
  `orders`, что несовместимо с автоматическим прогоном в CI.

### Seed-данные

**SRS-DB-037** [Charter §2 пункт 5, D-13] Скрипт `pnpm db:seed` (`apps/api/src/infrastructure/db/seed/index.ts`,
запускается через `tsx`) — **идемпотентен** (повторный запуск не создаёт дублей: upsert по
`natural key` — `tin_inn` для сетей, `(pharmacy_id, medicine_id)` для остатков, `barcode`/
`(trade_name, dosage_form, manufacturer_name)` для медикаментов без штрихкода). Обязательный
минимальный состав (Charter DoD пункт 5):

| Сущность | Минимум | Детали |
|---|---|---|
| `pharmacy_chains` | **≥3** сети + нейтральный `tenants(slug='neutral')` без сети | 1 сеть с `is_whitelabel_active=true` (демонстрация White-Label палитры/домена), 2 — обычные партнёры |
| `pharmacies` | **≥12** точек | Распределены неравномерно по сетям (напр. 5+4+3), минимум 2 точки со `status != 'active'` (`pending_review`, `suspended`) для проверки REQ-ONBOARD-11/12 |
| `medicines` | **≥300** курируемых позиций | Реальные торговые названия рынка РТ (Цитрамон, Парацетамол, Каптоприл, Омепразол, Азитромицин и др.), с валидными EAN-13 (включая ≥5 с префиксом `2` для теста `isInternalPrefix()`) |
| `substances` + `medicine_substances` | Покрывает ВСЕ 300 медикаментов | **≥15 групп аналогов** — множество медикаментов с идентичным набором `substances` (напр. 3-4 бренда парацетамола 500мг разных производителей) для демонстрации CUJ-1 |
| `categories` | ≥10 | С заполненным `commission_category` (`rx`/`otc`/`parapharma`) |
| `pharmacy_inventory` + `inventory_batches` | Покрывает бо́льшую часть комбинаций «активная аптека × медикамент» | Включает ≥3 медикамента с ценовым разбросом ×8–10 между аптеками (демонстрация REQ-MARKET-3), ≥1 медикамент с просроченной партией (для теста REQ-REG-6) |
| `users` | **Все роли** `user_role` | ≥2 `customer`, ≥1 `pharmacist` на аптеку, ≥1 `pharmacy_admin` на сеть, ≥3 `courier` (1 `own_fleet`, 2 `platform_pool`), 1 `super_admin`, 1 `support_agent` |
| `orders` | **Демо-заказы во всех статусах** `order_status` | Минимум по одному: `pending_payment`, `confirmed` (cash_courier, D-25 — БЕЗ `escrow_ledger`), `paid_escrow`, `processing`, `picked_up`, `delivered`, `cancelled`, `refunded`, `return_in_progress` — с согласованными `escrow_ledger`/`payout_schedule`/`delivery_assignments` строками, где применимо по state machine |
| `order_disputes`/`order_returns` | ≥1 каждого | По одному заказу в `delivered` с открытым спором и с одним `return_confirmed` |
| `platform_fee` | ≥1 global default на категорию | `rx`=500bps, `otc`=800bps, `parapharma`=1200bps (D-03 дефолты) |
| `tenant_settings` | Для всех тенантов, включая `neutral` | Разные `brand_palette`/`brand_name` для демонстрации White-Label переключения |

**SRS-DB-038** [D-13] Число 300 — критерий приёмки ИЗМЕНЁН архитектором относительно `tz.log`
(«8000+ позиций к неделе 3-4» признано нереалистичным, D-13/REQ-CAT-1) — сид-скрипт не пытается
достичь 8000, а курирует качественное ядро с корректными связями МНН, что важнее объёма для
демонстрации CUJ-1.

**SRS-DB-039** Порядок вставки seed внутри одной транзакции по группам (следует топологии §3):
`tenants(neutral)` → `pharmacy_chains` → `tenants(остальные, привязка к chain_id)` →
`tenant_settings` → `categories` → `substances` → `medicines` → `medicine_substances` →
`pharmacies` → `users` → `couriers` → `pharmacy_inventory`+`inventory_batches` → `platform_fee` →
`orders`+`order_items` (с корректным `commission_bps`-снэпшотом по уже вставленным `platform_fee`) →
`escrow_ledger`+`payout_schedule` (согласованно со статусом заказа) → `delivery_assignments` →
`order_returns`/`order_disputes` (для демо-сценариев).

---

## Маппинг на Drizzle

> Файлы — `apps/api/src/infrastructure/db/schema/*.schema.ts`, один файл на bounded context
> (`02` §1: инфраструктурный слой). `domain`/`application` НИКОГДА не импортируют эти файлы напрямую
> (`02` §1.1: «Drizzle-схема импортируется в domain/application» — запрещено) — маппинг
> `DrizzleRow → DomainEntity` живёт в `infrastructure/mappers/*.mapper.ts`.

```typescript
// apps/api/src/infrastructure/db/schema/enums.schema.ts
import { pgEnum } from 'drizzle-orm/pg-core';

export const orderStatusEnum = pgEnum('order_status', [
  // 'confirmed' [D-25] добавлен ПОСЛЕ применения 0019_order_status_add_confirmed.sql в БД,
  // отдельным коммитом (SRS-DB-049) — порядок здесь для типов TS, не создаёт/не проверяет тип в БД.
  'pending_payment', 'confirmed', 'paid_escrow', 'processing', 'picked_up',
  'delivered', 'cancelled', 'refunded', 'return_in_progress',
]);

export const controlCategoryEnum = pgEnum('control_category', [
  'none', 'prescription_only', 'potent', 'psychotropic', 'narcotic',
]);

export const escrowEntryTypeEnum = pgEnum('escrow_entry_type', [
  'hold_created', 'platform_fee_captured', 'captured_to_pharmacy',
  'refunded_to_customer', 'partially_refunded', 'adjustment',
]);

export const escrowEntryDirectionEnum = pgEnum('escrow_entry_direction', ['debit', 'credit']);
```

```typescript
// apps/api/src/infrastructure/db/schema/medicines.schema.ts
import { pgTable, uuid, varchar, text, boolean, numeric, integer,
         timestamp, customType } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { controlCategoryEnum } from './enums.schema';
import { categories } from './categories.schema';

// tsvector не имеет встроенного типа Drizzle — определяем через customType (`02` §1.1: тип БД
// остаётся деталью infrastructure, наружу через мапперы не «протекает»).
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

export const medicines = pgTable('medicines', {
  id: uuid('id').primaryKey().defaultRandom(),
  tradeName: varchar('trade_name', { length: 255 }).notNull(),
  innName: varchar('inn_name', { length: 255 }).notNull(),
  barcode: varchar('barcode', { length: 64 }).unique(),
  categoryId: integer('category_id').notNull().references(() => categories.id, { onDelete: 'restrict' }),
  dosageForm: varchar('dosage_form', { length: 100 }).notNull(),
  dosageStrength: varchar('dosage_strength', { length: 100 }).notNull(),
  manufacturerCountry: varchar('manufacturer_country', { length: 100 }).notNull(),
  manufacturerName: varchar('manufacturer_name', { length: 255 }).notNull(),
  isPrescriptionRequired: boolean('is_prescription_required').default(false),
  storageTemperature: varchar('storage_temperature', { length: 50 }),
  descriptionTj: text('description_tj'),
  descriptionRu: text('description_ru'),
  imageUrl: text('image_url'),
  controlCategory: controlCategoryEnum('control_category').notNull().default('none'),
  isGloballyIdentifiableByBarcode: boolean('is_globally_identifiable_by_barcode').notNull().default(true),
  isPublished: boolean('is_published').notNull().default(false),
  requiresColdChain: boolean('requires_cold_chain').notNull().default(false),
  // Генерируемая колонка — Drizzle-kit НЕ управляет GENERATED ALWAYS AS напрямую (на момент 0.45.x
  // ограниченная поддержка); объявляется как custom SQL default в миграции (§8, 0004_catalog_base.sql),
  // здесь — read-only проекция типа для типобезопасных SELECT.
  searchVector: tsvector('search_vector'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
// NB: money-поля price_tjs здесь отсутствуют — они принадлежат pharmacy_inventory, не medicines.
```

```typescript
// apps/api/src/infrastructure/db/schema/orders.schema.ts
import { pgTable, uuid, varchar, text, numeric, integer, timestamp } from 'drizzle-orm/pg-core';
import { orderStatusEnum } from './enums.schema';
import { pharmacies } from './pharmacies.schema';
import { users } from './users.schema';
import { tenants } from './tenants.schema';

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderNumber: varchar('order_number', { length: 20 }).notNull().unique(),
  customerId: uuid('customer_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  pharmacyId: uuid('pharmacy_id').references(() => pharmacies.id),
  status: orderStatusEnum('status').default('pending_payment'),
  paymentMethod: varchar('payment_method', { length: 50 }).notNull(),
  paymentTransactionId: varchar('payment_transaction_id', { length: 255 }),
  // NUMERIC(10,2) представлен как Drizzle `numeric` -> строка на границе (§1, SRS-DB-003).
  // Infrastructure-маппер обязан вызвать Money.fromDbDecimalTjs(row.itemsTotalTjs), НИКОГДА
  // не приводить строку через Number()/parseFloat в этом слое.
  itemsTotalTjs: numeric('items_total_tjs', { precision: 10, scale: 2 }).notNull(),
  deliveryFeeTjs: numeric('delivery_fee_tjs', { precision: 10, scale: 2 }).notNull(),
  totalAmountTjs: numeric('total_amount_tjs', { precision: 10, scale: 2 }).notNull(),
  deliveryAddress: text('delivery_address').notNull(),
  deliveryLandmark: text('delivery_landmark'),
  deliveryLatitude: numeric('delivery_latitude', { precision: 10, scale: 8 }),
  deliveryLongitude: numeric('delivery_longitude', { precision: 11, scale: 8 }),
  courierEtaMinutes: integer('courier_eta_minutes'),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
  checkoutAttemptId: uuid('checkout_attempt_id').notNull(),
  slaDeadlineAt: timestamp('sla_deadline_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
```

```typescript
// apps/api/src/infrastructure/db/schema/order-items.schema.ts
import { pgTable, uuid, numeric, integer, smallint, bigint } from 'drizzle-orm/pg-core';
import { orders } from './orders.schema';
import { medicines } from './medicines.schema';

export const orderItems = pgTable('order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').references(() => orders.id, { onDelete: 'cascade' }),
  medicineId: uuid('medicine_id').references(() => medicines.id),
  unitPriceTjs: numeric('unit_price_tjs', { precision: 10, scale: 2 }).notNull(),
  quantity: integer('quantity').notNull(),
  totalPriceTjs: numeric('total_price_tjs', { precision: 10, scale: 2 }).notNull(),
  commissionBps: smallint('commission_bps').notNull().default(0),
  // bigint dirams — Drizzle `bigint({ mode: 'bigint' })` возвращает JS BigInt напрямую (не string),
  // соответствует SRS-DB-003: НОВЫЕ денежные поля — BIGINT дирамы, без прохода через NUMERIC/float.
  platformFeeDiram: bigint('platform_fee_diram', { mode: 'bigint' }).notNull().default(0n),
});
```

```typescript
// apps/api/src/infrastructure/db/schema/escrow-ledger.schema.ts
import { pgTable, uuid, bigint, text, timestamp } from 'drizzle-orm/pg-core';
import { orders } from './orders.schema';
import { users } from './users.schema';
import { escrowEntryTypeEnum, escrowEntryDirectionEnum } from './enums.schema';

export const escrowLedger = pgTable('escrow_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  entryType: escrowEntryTypeEnum('entry_type').notNull(),
  direction: escrowEntryDirectionEnum('direction').notNull(),
  amountDiram: bigint('amount_diram', { mode: 'bigint' }).notNull(),
  paymentTransactionRef: text('payment_transaction_ref'),
  reason: text('reason'),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Намеренно НЕТ updatedAt — таблица append-only (SRS-DOM-031), колонка "updated_at" здесь была
  // бы сама по себе архитектурным запахом (приглашает к UPDATE).
});
```

**SRS-DB-040** [`02` §1.1] Ни один файл `*.schema.ts` не экспортирует ничего, кроме
Drizzle-таблицы и её `InferSelectModel`/`InferInsertModel`-типов, используемых ТОЛЬКО внутри
`infrastructure/repositories/*.repository.ts`. Domain-сущность (`Order`, `Medicine`, ...) —
отдельный класс в `domain/*.entity.ts`, не переиспользует и не расширяет Drizzle-тип.

---

## Пограничные случаи и ошибки

> Фокус этого раздела — сбои и гонки НА УРОВНЕ БД (constraint-конфликты, дедлоки, целостность при
> сбое миграции, поведение при недоступности БД), дополняющие (не дублирующие) `10-domain-model.md`
> §«Пограничные случаи и ошибки» (там — доменные политики и бизнес-реакция; здесь — физический
> механизм БД, на который домен опирается).

**SRS-DB-041** [SRS-DOM-036/052/057, §4] **Гонка двух конкурентных запросов на создание активной
сущности** (два запроса одновременно пытаются создать `delivery_assignments`/`order_returns`/
`order_disputes` для одного `order_id`, оба прошли доменную guard-проверку ДО commit друг друга).
Given частичный уникальный индекс (`ux_delivery_assignment_one_active` и др., §4), When второй
`INSERT` коммитится, Then PostgreSQL возвращает `23505 unique_violation`; `infrastructure`-репозиторий
перехватывает КОНКРЕТНО этот код ошибки для ЭТОГО индекса (по имени constraint в
`error.constraint`) и перебрасывает как типизированную `DuplicateActiveReturnError`/
`DuplicateNonTerminalDisputeError` — сырой `23505` НИКОГДА не долетает до `presentation`.

**SRS-DB-042** [SRS-DB-006, финансовая целостность] **Попытка `DELETE` строки `escrow_ledger` или
`audit_log`** (ошибка в скрипте DBA, компрометация учётной записи с превышенными правами). Given
роль подключения `app_role` без `GRANT DELETE` на эти таблицы (SRS-DB-024/030), When выполняется
`DELETE FROM escrow_ledger ...`, Then PostgreSQL возвращает `42501 insufficient_privilege` ДО
попытки затронуть строки — защита на уровне СУБД, не на уровне приложения (не обходится даже
SQL-инъекцией через уязвимый эндпоинт, если таковая случится — недостаточные права роли БД
остаются последним рубежом).

**SRS-DB-043** [SRS-DOM-168, `unique(batch_id)`] **Повторная отправка того же `batch_id` 1С
(сетевой ретрай на стороне 1С)**. Given `inventory_sync_batches.id` (=`batch_id`) уже существует,
When 1С повторяет `POST /inventory/batch-update` с тем же `batch_id` в теле, Then `INSERT` внутри
`IngestInventoryBatchUseCase` конфликтует по PK; `infrastructure` перехватывает `23505` на ЭТОЙ
таблице конкретно и возвращает **сохранённый ранее** HTTP-ответ (запрошенный по `batch_id` из уже
существующей строки `inventory_sync_batches` + агрегированных `inventory_sync_errors`), не
выполняя обработку повторно — сама бизнес-логика построчного апдейта НЕ запускается второй раз.

**SRS-DB-044** [SRS-DOM-170, FEFO-триггер] **Гонка: `restock()` возврата и ночная `full`-
синхронизация той же партии одновременно**. Given обе операции (`UPDATE inventory_batches SET
quantity = quantity + :n` от `restock`, и `UPDATE ... SET quantity = :from_1c` от полной 1С-
синхронизации) целятся в одну строку `inventory_batches`, When обе транзакции стартуют
конкурентно, Then PostgreSQL сериализует их через блокировку строки (`SELECT ... FOR UPDATE`,
обязательный внутри `IngestInventoryBatchUseCase` и `RestockUseCase` — не полагаться на дефолтный
`READ COMMITTED` без явной блокировки, т.к. `UPDATE` без `FOR UPDATE` на предшествующем `SELECT`
не защищает от «потерянного обновления» при read-modify-write вне одного `UPDATE`-выражения);
триггер `trg_recompute_fefo` пересчитывает денормализацию ПОСЛЕ той транзакции, что закоммитилась
второй — итоговое значение соответствует ПОСЛЕДНЕЙ применённой операции, потенциальное расхождение
с ожиданием фармацевта детектируется `InventoryReconciliationJob` (Should), не автоисправляется.

**SRS-DB-045** [Charter §7, отказоустойчивость] **БД временно недоступна** (сетевой сбой,
`ECONNREFUSED`/`ETIMEDOUT` пула `pg`). Given любой запрос `apps/api` к PostgreSQL, When соединение
не устанавливается за `DB_CONNECT_TIMEOUT_MS` (ASSUMPTION 5000), Then `/ready` (readiness probe,
Charter §7) немедленно возвращает `503`, снимая инстанс с ротации Nginx (Charter §3.5 №3) ДО того,
как накопится очередь зависших запросов; уже принятые в обработку запросы получают
`503 DATABASE_UNAVAILABLE` (единый формат ошибок), не зависают до истечения клиентского таймаута.

**SRS-DB-046** [SRS-DB-009, эксплуатация] **Миграция `ALTER TYPE ... ADD VALUE` падает в CI
из-за попытки использовать новое значение в той же транзакции**. Given разработчик по ошибке
объединил `ALTER TYPE order_status ADD VALUE 'x'` и `UPDATE orders SET status='x' WHERE ...` в
одном файле миграции, When раннер выполняет её транзакционно, Then PostgreSQL возвращает `55P04
unsafe_use_of_new_value` — CI-джоба миграций падает ЯВНО на этом шаге (не тихо игнорирует), сообщение
об ошибке содержит имя файла-нарушителя; исправление — разнести на два файла миграции (SRS-DB-009).

**SRS-DB-047** [§5, полнотекстовый поиск] **Запрос содержит только таджикские спецбуквы без
аналогов в `tajik_unaccent.rules`** (гипотетическая новая буква/лигатура, не покрытая словарём).
Given `to_tsvector('tajik_ru', :query)` не находит совпадений из-за необработанного символа, When
пользователь получает пустой результат по `tsvector`-пути, Then запрос ОБЯЗАН одновременно пройти
`pg_trgm`-фолбэк (`%`-оператор, §5 запрос 1) — символ, не покрытый словарём, всё ещё участвует в
триграммном сравнении посимвольно, что даёт частичное совпадение вместо полного нуля результатов.

**SRS-DB-048** [SRS-DOM-085, `OrderNumberSequenceExhaustedError`] **Redis, хранящий счётчик
`order_seq:{YYMMDD}`, недоступен в момент генерации `order_number`**. Given
`OrderNumberGeneratorPort` (инфраструктура, Redis `INCR`) не отвечает, When `Order.create()`
вызывает порт, Then возвращается `503 ORDER_NUMBER_GENERATOR_UNAVAILABLE` — заказ НЕ создаётся с
временным/пустым `order_number` (колонка `NOT NULL UNIQUE`, попытка `NULL` или дублирующегося
плейсхолдера немедленно нарушила бы constraint) — checkout считается неуспешным, клиент видит
явную ошибку, а не «подвисший» заказ.

---

## Тестовые сценарии

> Формат: `TC-DB-nnn`. В отличие от `TC-DOM-*` (`10-domain-model.md`, unit-тесты домена без БД),
> тесты здесь — **интеграционные** (`Vitest` + реальный PostgreSQL 16 в Docker/Testcontainers),
> проверяющие СХЕМУ (constraints, индексы, триггеры), не бизнес-логику доменного слоя повторно.

| TC | Проверяет | Given | When | Then |
|---|---|---|---|---|
| **TC-DB-001** | **CUJ-7 / SRS-DB-025..030** (обязательный тест изоляции тенантов) | Тенант A (`sifat`) и тенант B (`oson`) с непересекающимися `pharmacies`/`orders`/`users`; авторизованный запрос от имени `pharmacy_admin` тенанта A | HTTP-запрос `GET /api/v1/orders/:id` с `id` заказа, принадлежащего тенанту B, при резолвленном `X-Tenant-Slug: sifat` | `404 NOT_FOUND` (не `403` — существование чужого заказа не раскрывается), запись в БД тенанта B физически не читается ни в одной строке SQL-плана (`EXPLAIN` запроса содержит `tenant_id = $1`/JOIN через `chain_id`, не полный скан) |
| TC-DB-002 | SRS-DB-026 | `TenantContext` НЕ резолвлен (тест напрямую вызывает репозиторий, минуя middleware) | Любой метод `TenantScopedRepository` | `TenantContextMissingError`, ни один SQL-запрос не отправлен в БД |
| TC-DB-003 | SRS-DB-027 | Курьер `chain_id = NULL` (platform_pool), тенант `sifat` пытается назначить его на свой заказ | `DeliveryFacade.assign(courierId)` | Назначение УСПЕШНО (пул доступен всем тенантам), в отличие от курьера с `chain_id` другой сети |
| TC-DB-004 | `chk_orders_total_matches_sum` | `items_total_tjs=100.00, delivery_fee_tjs=20.00, total_amount_tjs=125.00` (расхождение) | `INSERT INTO orders (...)` | `23514 check_violation` на `chk_orders_total_matches_sum`, строка не вставлена |
| TC-DB-005 | `chk_order_items_price_positive` | `unit_price_tjs = 0` | `INSERT INTO order_items (...)` | `23514 check_violation`, вставка отклонена (SRS-DB-005: «цена > 0») |
| TC-DB-006 | `chk_medicines_control_category_requires_rx` | `control_category='potent', is_prescription_required=false` | `INSERT/UPDATE medicines` | `23514 check_violation` (SRS-DOM-015) |
| TC-DB-007 | `ux_order_disputes_one_active` | Заказ уже имеет строку `order_disputes` со `status='open'` | Повторный `INSERT order_disputes(order_id=тот же, status='open')` | `23505 unique_violation` на `ux_order_disputes_one_active`, перехвачен как `DuplicateNonTerminalDisputeError` |
| TC-DB-008 | `ux_tenants_single_neutral` | `tenants` уже содержит строку `is_neutral=true` | Повторный `INSERT tenants(is_neutral=true, ...)` | `23505 unique_violation` — вторую нейтральную запись создать невозможно на уровне БД, независимо от прикладной проверки |
| TC-DB-009 | `trg_recompute_fefo` (SRS-DB-021) | `inventory_batches` для одной пары `(pharmacy_id, medicine_id)`: партия A (`qty=5, expiry=+10д, price=1450`), партия B (`qty=3, expiry=+30д, price=1500`) | `SELECT stock_quantity, price_tjs, expiry_date FROM pharmacy_inventory WHERE id=...` | `stock_quantity=8`, `price_tjs=14.50` (FEFO — партия A ближе к истечению), `expiry_date` партии A |
| TC-DB-010 | `trg_recompute_fefo`, REQ-REG-6 | Партия A просрочена (`expiry_date <= CURRENT_DATE`, `qty=5`), партия B валидна (`qty=3`) | Пересчёт после `UPDATE` любой партии | `stock_quantity=3` (просроченная партия ИСКЛЮЧЕНА из суммы, SRS-DOM-021), FEFO-цена — партии B |
| TC-DB-011 | Полнотекстовый поиск, CUJ-1 | `medicines.trade_name='Цитрамон'`, запрос пользователя `'цытрамон'` (опечатка) | Запрос 1 из §5 | Строка `Цитрамон` присутствует в результате с ненулевым `trgm_score` (через `%`-оператор, `tsvector`-путь не совпадает буквально) |
| TC-DB-012 | REQ-UX-14, тадж. кириллица | `medicines.trade_name` содержит `'ширинии дорухона'` с буквой `ӣ`; запрос `'ширини дорухона'` (пользователь ввёл `и` вместо `ӣ`) | `to_tsvector('tajik_ru', ...)` на обеих строках | Совпадение найдено (SRS-DB-014/015: `tajik_unaccent` схлопывает `ӣ→и` в обеих частях сравнения) |
| TC-DB-013 | SRS-DOM-158 SQL-приближение (запрос 3, §5) | Медикамент A: вещества `{парацетамол 500мг}`; медикамент B: вещества `{парацетамол 500мг, кофеин 50мг}` (частичное пересечение, НЕ идентичное множество) | Запрос блока аналогов для A | B НЕ входит в результат (проверка `array_agg`-равенства множеств проваливается на разной кардинальности) |
| TC-DB-014 | D-06, `isInternalPrefix` фильтр в composite-матчинге | Штрихкод `'2001234567890'` (префикс `2`) присутствует в ДВУХ разных сетях на РАЗНЫЕ медикаменты | 1С-выгрузка сети X со штрихкодом `2001234567890` | Composite-матчинг НЕ использует прямой `WHERE barcode = ?` как единственный критерий — переходит к шагу `(chain_id, internal_sku)`/fuzzy, не находит ложного совпадения с медикаментом сети Y |
| TC-DB-015 | `chk_payout_schedule_net_matches` | `gross=10000, commission=800, net=9100` (расхождение на 100) | `INSERT payout_schedule` | `23514 check_violation` |
| TC-DB-016 | `chk_order_disputes_terminal_requires_reason`, REQ-DISPUTE-13 | `status='resolved_reject', resolution_reason=NULL` | `INSERT/UPDATE order_disputes` | `23514 check_violation` — терминальный статус без причины физически невозможен в БД, не только в domain |
| TC-DB-017 | `escrow_ledger` privileges (SRS-DB-024/042) | Подключение под `app_role` | `DELETE FROM escrow_ledger WHERE id=...` | `42501 insufficient_privilege`, строка не удалена |
| TC-DB-018 | `unique_pharmacy_medicine`, SRS-DOM-018 | `pharmacy_inventory` уже содержит строку `(pharmacy_id=X, medicine_id=Y)` | Повторный `INSERT` той же пары (не `UPSERT`) | `23505 unique_violation` — прикладной код обязан использовать `ON CONFLICT (pharmacy_id, medicine_id) DO UPDATE`, не голый `INSERT` |
| TC-DB-019 | `inventory_sync_batches` идемпотентность (SRS-DB-043) | `batch_id = B1` уже обработан (`status='completed_full_success'`) | Повторный `INSERT inventory_sync_batches(id=B1, ...)` | `23505 unique_violation` на PK — обработчик возвращает СОХРАНЁННЫЙ результат по `B1`, не запускает `IngestInventoryBatchUseCase` повторно |
| TC-DB-020 | `chk_sync_batches_row_limit`, REQ-SYNC-4 | `total_rows = 1500` | `INSERT inventory_sync_batches` | `23514 check_violation` (лимит 1000 позиций/запрос) |
| TC-DB-021 | Гео-индекс, GiST | `pharmacies.geo_point` для 12 аптек, точка запроса в центре Душанбе, `radius_meters=3000` | Запрос 2 из §5 (`ST_DWithin`) | `EXPLAIN` показывает `Index Scan using ix_pharmacies_geo_point` (не `Seq Scan`), результат отсортирован по `distance_m` |
| TC-DB-022 | `ix_orders_pharmacy_active` (частичный индекс) | 1000 заказов, из них 50 в активных статусах для аптеки X | `EXPLAIN SELECT * FROM orders WHERE pharmacy_id=X AND status IN (...)` | План использует `ix_orders_pharmacy_active`, не полный скан 1000 строк |
| TC-DB-023 | Миграция необратимого `ALTER TYPE` (SRS-DB-046) | Файл миграции содержит `ALTER TYPE` и `UPDATE` в одной транзакции | `pnpm db:migrate` в CI | Миграция падает с `55P04`, CI-джоба красная, лог указывает конкретный файл |
| TC-DB-024 | `refresh_tokens` reuse detection | Токен `T1` ротирован в `T2` (`T2.rotated_from = T1.id`), `T1.revoked_at` проставлен | Клиент присылает уже отозванный `T1` на `/auth/refresh` | Application детектирует `rotated_from`-цепочку с `revoked_at IS NOT NULL` у предъявленного токена, отзывает ВСЮ цепочку `user_id`, возвращает `401` |
| TC-DB-025 | `otp_codes`, `ix_otp_codes_subject` | 5 использованных попыток (`attempts_used=5`) для `purpose='delivery_handover'` | Запрос `verify()` с верным кодом | `locked_at` уже проставлен приложением при 5-й попытке — строка исключена из `WHERE consumed_at IS NULL AND locked_at IS NULL`, новый OTP не подбирается по старой записи |
| TC-DB-026 | Seed-скрипт идемпотентность (SRS-DB-037) | `pnpm db:seed` уже выполнен один раз | Повторный `pnpm db:seed` | Количество строк в `pharmacy_chains`/`medicines`/`orders` НЕ увеличивается (upsert по natural key), скрипт завершается без ошибок |
| TC-DB-027 | D-13 состав seed | После `pnpm db:seed` | `SELECT count(*) FROM medicines`, `SELECT count(*) FROM pharmacy_chains`, `SELECT count(*) FROM pharmacies` | `medicines >= 300`, `pharmacy_chains >= 3`, `pharmacies >= 12` (Charter DoD пункт 5) |
| TC-DB-028 | Seed — все статусы заказов | После `pnpm db:seed` | `SELECT DISTINCT status FROM orders` | Результат содержит ВСЕ 9 значений `order_status` (включая `return_in_progress` и `confirmed`) |
| **TC-DB-029** | Инвариант `paid_escrow ⟺ escrow_ledger` (SRS-DB-050, D-25 п.4) | (a) Заказ `A` со `status='paid_escrow'`, для него ЕСТЬ строка `escrow_ledger(entry_type='hold_created')`; (b) заказ `B` создан с `payment_method='cash_courier'`, прошёл `Order.create()` (ожидаемо `status='confirmed'`, `escrow_ledger` для него отсутствует) | Интеграционный тест перебирает ВСЕ заказы БД: `SELECT o.id, o.status, EXISTS(SELECT 1 FROM escrow_ledger e WHERE e.order_id=o.id) AS has_ledger FROM orders o` | Для КАЖДОЙ строки `(status='paid_escrow') === has_ledger` (двусторонняя эквивалентность); заказ `B` проходит с `status='confirmed' AND has_ledger=false`, ни один заказ не найден с `status='paid_escrow' AND has_ledger=false` и ни один — с `status != 'paid_escrow' AND has_ledger=true` |
| TC-DB-030 | Запрещённые переходы `confirmed↔paid_escrow` (SRS-DOM-102, D-25 п.6) | Заказ со `status='confirmed'` (cash_courier) | Домен пытается `order.markPaidEscrow(...)` напрямую, минуя `ProcessPaymentWebhookUseCase` | `InvalidOrderStatusTransitionError` — переход отклонён на уровне домена ДО любой попытки записи в БД; аналогично для обратного перехода `paid_escrow → confirmed` |


---

**Итог**: документ вводит 50 требований `SRS-DB-001..050` (принципы, ENUM'ы, 46 таблиц полного DDL,
индексы с обоснованием под конкретный запрос, реализация полнотекстового поиска с учётом таджикской
кириллицы, CHECK-constraints и триггеры, модель изоляции тенантов, стратегия миграций и состав
seed-данных, маппинг на Drizzle) поверх 177 требований `SRS-DOM-*` из `10-domain-model.md`. Каждая
таблица реализует конкретный агрегат/VO/state machine домена; каждое расширение сверх `tz.log`
§II.2 явно помечено `[РАСШИРЕНИЕ]` со ссылкой на решение архитектора (D-*) или требование
исследования (REQ-*). Любое расхождение нижестоящих SRS-документов (Catalog/Search, Orders/
Checkout, Payments/Escrow, Prescriptions/AI, Delivery/Courier, Onboarding/Moderation) с этой схемой
разрешается ТОЛЬКО через ADR, а не молчаливой правкой DDL.
