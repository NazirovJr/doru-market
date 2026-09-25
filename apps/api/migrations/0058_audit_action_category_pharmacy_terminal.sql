-- =====================================================================================
-- 0058_audit_action_category_pharmacy_terminal.sql — EP-12 (DTJ-309, foundIssue на DTJ-306).
-- =====================================================================================
-- ALTER TYPE audit_action_category ADD VALUE 'pharmacy_terminal': GetHandoverOtpUseCase/
-- RegenerateHandoverOtpUseCase (apps/api/.../orders/application/pharmacy-terminal/) пишут
-- audit_log с этой категорией на КАЖДЫЙ успешный вызов (SRS-PHT-028/029) — значение
-- отсутствовало в исходном списке (0034) и во всех расширениях (0043/0054/0056), INSERT падал
-- `22P02 invalid input value for enum audit_action_category` на любом успешном запросе.
--
-- ОТДЕЛЬНЫЙ ФАЙЛ, вне транзакции использования значения (SRS-DB-009) — тот же приём, что
-- 0043/0054/0056.
--
-- Идемпотентность — `ADD VALUE IF NOT EXISTS` (PG 9.6+), тот же синтаксис, что 0043/0054/0056.
-- =====================================================================================

ALTER TYPE "audit_action_category" ADD VALUE IF NOT EXISTS 'pharmacy_terminal';
