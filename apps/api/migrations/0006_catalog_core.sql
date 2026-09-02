-- =====================================================================================
-- 0006_catalog_core.sql — EP-04 (DTJ-091), DDL 1:1 из 11-database-schema.md
-- =====================================================================================
-- Содержит: enum'ы (dosage_unit, dosage_form_class, control_category, D-07/D-08) +
-- 4 таблицы (categories, substances, medicines, medicine_substances) + индексы.
-- Все CHECK-constraints соответствуют SRS-DOM-013/015.
-- =====================================================================================

-- === Enum'ы (SRS-DB-008, переиспользуются модулем inventory EP-05) ===
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dosage_unit') THEN
    CREATE TYPE dosage_unit AS ENUM ('mg','mcg','g','ml','iu','percent','mg_per_ml');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dosage_form_class') THEN
    CREATE TYPE dosage_form_class AS ENUM (
      'tablet','capsule','syrup','injection','ointment','drops','inhaler','suppository','other'
    );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'control_category') THEN
    CREATE TYPE control_category AS ENUM (
      'none','prescription_only','potent','psychotropic','narcotic'
    );
  END IF;
END$$;

-- === 1. categories ===
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  parent_id INT REFERENCES categories(id) ON DELETE SET NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  name_tj VARCHAR(255) NOT NULL,
  name_ru VARCHAR(255) NOT NULL,
  name_en VARCHAR(255) NOT NULL,
  commission_category VARCHAR(20) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT chk_categories_commission_category
    CHECK (commission_category IN ('rx','otc','parapharma'))
);
COMMENT ON TABLE categories IS
  'Дерево категорий каталога (DTJ-091, EP-04). commission_category — грубая группировка для '
  'резолвинга ставки комиссии (D-03, SRS-DOM-160): rx/otc/parapharma, НЕ тождественна '
  'дереву навигации (SRS-CAT-003).';

-- === 2. substances ===
CREATE TABLE IF NOT EXISTS substances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inn_name VARCHAR(255) NOT NULL UNIQUE,
  inn_name_en VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_substances_inn_name_en ON substances (inn_name_en);
COMMENT ON TABLE substances IS
  'Справочник действующих веществ (D-07). Один Medicine ссылается на 1..N substances через '
  'medicine_substances — решает проблему комбинированных препаратов (REQ-SAFETY-2).';

-- === 3. medicines ===
CREATE TABLE IF NOT EXISTS medicines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_name VARCHAR(255) NOT NULL,
  inn_name VARCHAR(255) NOT NULL,
  barcode VARCHAR(64),
  category_id INT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  dosage_form VARCHAR(100) NOT NULL,
  dosage_strength VARCHAR(100) NOT NULL,
  manufacturer_country VARCHAR(100) NOT NULL,
  manufacturer_name VARCHAR(255) NOT NULL,
  is_prescription_required BOOLEAN NOT NULL DEFAULT false,
  storage_temperature VARCHAR(50),
  description_tj TEXT,
  description_ru TEXT,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- [РАСШИРЕНИЕ D-06/D-07/D-08] --
  dosage_form_class dosage_form_class NOT NULL DEFAULT 'other',
  dosage_value NUMERIC(10, 4),
  dosage_unit dosage_unit,
  control_category control_category NOT NULL DEFAULT 'none',
  is_globally_identifiable_by_barcode BOOLEAN NOT NULL DEFAULT true,
  is_published BOOLEAN NOT NULL DEFAULT false,
  requires_cold_chain BOOLEAN NOT NULL DEFAULT false,
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('russian', immutable_unaccent(coalesce(trade_name, ''))), 'A') ||
    setweight(to_tsvector('russian', immutable_unaccent(coalesce(inn_name, ''))), 'A') ||
    setweight(to_tsvector('russian', immutable_unaccent(coalesce(manufacturer_name, ''))), 'C')
  ) STORED,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_medicines_control_category_requires_rx
    CHECK (control_category NOT IN ('potent','psychotropic','narcotic')
           OR is_prescription_required = true)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_medicines_barcode
  ON medicines (barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_medicines_category_id ON medicines (category_id);
CREATE INDEX IF NOT EXISTS ix_medicines_control_category
  ON medicines (control_category)
  WHERE control_category IN ('psychotropic','narcotic');
CREATE INDEX IF NOT EXISTS ix_medicines_published
  ON medicines (is_published)
  WHERE is_published = true;
COMMENT ON TABLE medicines IS
  'Справочник медикаментов (Medicine aggregate, EP-04, DTJ-091). barcode валиден по EAN-13, '
  'но НЕ единственный ключ матчинга (D-06) — см. pharmacy_sku_mapping/catalog_match_queue.';
COMMENT ON COLUMN medicines.control_category IS
  'D-08: none/prescription_only/potent — заказываемы (potent требует Rx); psychotropic/narcotic — '
  'жёсткий запрет дистанционной продажи на уровне API (REQ-REG-4), не только UI.';

-- === 4. medicine_substances ===
CREATE TABLE IF NOT EXISTS medicine_substances (
  medicine_id UUID NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
  substance_id UUID NOT NULL REFERENCES substances(id) ON DELETE RESTRICT,
  strength_value NUMERIC(10, 4) NOT NULL,
  strength_unit dosage_unit NOT NULL,
  PRIMARY KEY (medicine_id, substance_id),
  CONSTRAINT chk_medicine_substances_strength_positive CHECK (strength_value > 0)
);
CREATE INDEX IF NOT EXISTS ix_medicine_substances_substance_id
  ON medicine_substances (substance_id);
COMMENT ON TABLE medicine_substances IS
  'Мост многие-ко-многим Medicine<->Substance с дозировкой конкретного вещества в составе '
  '(SRS-DOM-013/017). Множество substances препарата = ключ эквивалентности для аналогов (D-07).';
