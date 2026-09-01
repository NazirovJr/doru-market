-- Обратная миграция 0018_search_schema_additions.
DROP INDEX IF EXISTS ix_medicines_trade_name_prefix;
DROP TABLE IF EXISTS search_query_log;
DROP TABLE IF EXISTS pharmacy_reliability_scores;
