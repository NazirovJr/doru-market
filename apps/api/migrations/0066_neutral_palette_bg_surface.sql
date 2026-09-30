-- Палитра нейтрального тенанта (0021) записала --brand-bg/--brand-surface наоборот относительно
-- дизайн-референса (bg #f8fafc, surface #ffffff). Рантайм-брендинг применяет её как есть, поэтому
-- фон и карточки поменялись бы местами. Условие по старым значениям: правленую вручную палитру не трогаем.
UPDATE tenant_settings
SET brand_palette = brand_palette || '{"--brand-bg": "#f8fafc", "--brand-surface": "#ffffff"}'::jsonb
WHERE tenant_id = '00000000-0000-4000-8000-000000000001'
  AND brand_palette ->> '--brand-bg' = '#ffffff'
  AND brand_palette ->> '--brand-surface' = '#f8fafc';
