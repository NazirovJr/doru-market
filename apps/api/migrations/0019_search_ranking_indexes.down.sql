-- Обратная миграция 0019_search_ranking_indexes.
DROP TEXT SEARCH CONFIGURATION IF EXISTS tajik_ru;
DROP INDEX IF EXISTS ix_pharmacy_inventory_medicine_instock;
DROP INDEX IF EXISTS ix_medicines_inn_name_trgm;
DROP INDEX IF EXISTS ix_medicines_trade_name_trgm;
DROP INDEX IF EXISTS ix_medicines_search_vector;
