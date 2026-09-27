-- Down-миграция для 0059_pharmacies_max_delivery_radius_km.sql (DTJ-367).

ALTER TABLE pharmacies DROP COLUMN IF EXISTS max_delivery_radius_km;
