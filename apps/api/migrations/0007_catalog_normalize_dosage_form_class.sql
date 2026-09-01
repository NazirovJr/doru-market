-- =====================================================================================
-- 0007_catalog_normalize_dosage_form_class.sql — EP-04 (DTJ-097)
-- SQL-зеркало `DosageFormNormalizerService` (TS). Логика СИНХРОНИЗИРОВАНА с
-- TypeScript-функцией `catalogNormalizeDosageFormClass`. Parity-тест
-- `dosage-form-normalizer.parity.spec.ts` гоняет ОБА пути и сверяет результат.
-- Используется внутри SQL-запроса fuzzy-матчинга (SRS-INV-024) — производительность
-- на полной таблице medicines важна, чем оправдано дублирование.
-- =====================================================================================

CREATE OR REPLACE FUNCTION catalog_normalize_dosage_form_class(raw text) RETURNS dosage_form_class
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN raw IS NULL OR btrim(raw) = '' THEN 'other'::dosage_form_class
    WHEN lower(btrim(raw)) IN (
      'таблетки', 'таблетка', 'табл.', 'таб', 'tabs', 'tablets', 'tablet', 'pill', 'pills'
    ) THEN 'tablet'::dosage_form_class
    WHEN lower(btrim(raw)) IN (
      'капсулы', 'капсула', 'капс.', 'caps', 'capsules', 'capsule'
    ) THEN 'capsule'::dosage_form_class
    WHEN lower(btrim(raw)) IN (
      'сироп', 'sir.', 'syrup', 'sirup', 'syrups'
    ) THEN 'syrup'::dosage_form_class
    WHEN lower(btrim(raw)) IN (
      'ампулы', 'ампула', 'инъекция', 'инъекции', 'раствор', 'injection', 'inj', 'ampoules', 'ampoule', 'solution'
    ) THEN 'injection'::dosage_form_class
    WHEN lower(btrim(raw)) IN (
      'мазь', 'ointment', 'cream', 'unguentum'
    ) THEN 'ointment'::dosage_form_class
    WHEN lower(btrim(raw)) IN (
      'капли', 'drops'
    ) THEN 'drops'::dosage_form_class
    WHEN lower(btrim(raw)) IN (
      'ингалятор', 'ингаляторы', 'inhaler', 'inhalers', 'inhalation'
    ) THEN 'inhaler'::dosage_form_class
    WHEN lower(btrim(raw)) IN (
      'свечи', 'суппозитории', 'суппозиторий', 'suppository', 'suppositories'
    ) THEN 'suppository'::dosage_form_class
    ELSE 'other'::dosage_form_class
  END;
$$;

COMMENT ON FUNCTION catalog_normalize_dosage_form_class(text) IS
  'EP-04/DTJ-097: SQL-зеркало TS-функции `catalogNormalizeDosageFormClass`. '
  'Источник истины — TS-версия, SQL синхронизирован (parity-тест). '
  'Используется в SQL-запросе fuzzy-матчинга (SRS-INV-024).';
