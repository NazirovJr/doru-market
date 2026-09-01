-- Down-миграция для 0006_catalog_core (DTJ-091). Удаляет 4 таблицы и 3 enum-типа.
DROP TABLE IF EXISTS medicine_substances;
DROP TABLE IF EXISTS medicines;
DROP TABLE IF EXISTS substances;
DROP TABLE IF EXISTS categories;

DROP TYPE IF EXISTS control_category;
DROP TYPE IF EXISTS dosage_form_class;
DROP TYPE IF EXISTS dosage_unit;
