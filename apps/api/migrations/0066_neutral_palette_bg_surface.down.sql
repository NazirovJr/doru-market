-- Down-миграция для 0066_neutral_palette_bg_surface.sql.
UPDATE tenant_settings
SET brand_palette = brand_palette || '{"--brand-bg": "#ffffff", "--brand-surface": "#f8fafc"}'::jsonb
WHERE tenant_id = '00000000-0000-4000-8000-000000000001'
  AND brand_palette ->> '--brand-bg' = '#f8fafc'
  AND brand_palette ->> '--brand-surface' = '#ffffff';
