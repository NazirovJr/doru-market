-- =====================================================================================
-- 0059_pharmacies_max_delivery_radius_km.sql — EP-15 (DTJ-367), SRS-ADM-050.
-- =====================================================================================
-- [ДОПОЛНЕНИЕ] — колонка отсутствует в исходном DDL `11-database-schema.md` Группы A,
-- вводится этим тикетом дословно по DDL `SRS-ADM-050`
-- (`docs/spec/27-module-admin-moderation-onboarding.md` §10.1): круговая зона доставки
-- аптеки (`PharmacyAccount` aggregate, EP-03), основание для guard'а checkout
-- `DELIVERY_ZONE_EXCEEDED` (реализация guard'а — EP-09, вне этого тикета).
--
-- DEFAULT 10.0 — совпадает с доменным дефолтом `PharmacyAccount.create()`
-- (`domain/pharmacy-account-entity.types.ts`), чтобы существующие строки и новые заявки
-- не расходились в значении по умолчанию.
--
-- Идемпотентность — `ADD COLUMN IF NOT EXISTS` (тот же приём, что 0045/0058).
-- =====================================================================================

ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS max_delivery_radius_km NUMERIC(5, 2) NOT NULL DEFAULT 10.0;

COMMENT ON COLUMN pharmacies.max_delivery_radius_km IS
    'DTJ-367 (SRS-ADM-050): радиус круговой зоны доставки от точки аптеки, км. '
    'Читается guard''ом checkout OrdersFacade.isWithinDeliveryZone (EP-09, DELIVERY_ZONE_EXCEEDED).';
