-- =====================================================================================
-- 0060_audit_action_category_pharmacy_settings.sql — EP-15 (DTJ-367).
-- =====================================================================================
-- ALTER TYPE audit_action_category ADD VALUE 'pharmacy_settings_change': UpdatePharmacyScheduleUseCase/
-- UpdateDeliveryZoneUseCase пишут audit_log с этой категорией на каждый PATCH расписания/зоны
-- доставки аптеки — 'onboarding_decision' (единственная категория onboarding-модуля в исходном
-- списке) для decision-переходов (approve/reject/suspend), не для рутинного апдейта полей.
--
-- ОТДЕЛЬНЫЙ ФАЙЛ, вне транзакции использования значения (SRS-DB-009) — тот же приём, что 0043/0054/0056/0058.
-- Идемпотентность — `ADD VALUE IF NOT EXISTS` (PG 9.6+), тот же синтаксис, что 0043/0054/0056/0058.
-- =====================================================================================

ALTER TYPE "audit_action_category" ADD VALUE IF NOT EXISTS 'pharmacy_settings_change';
