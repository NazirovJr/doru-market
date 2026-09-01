-- 0002_enums.down.sql (EP-01, DTJ-013).
-- Обратный откат 0002_enums.sql.
-- ВНИМАНИЕ: DROP TYPE упадёт, если в схеме есть колонки этого типа.
-- Удалять только если вы СОЗДАЁТЕ всю БД с нуля или уверены, что
-- зависимых колонок нет.

DROP TYPE IF EXISTS "otp_purpose";
DROP TYPE IF EXISTS "user_role";
