-- =============================================================================
-- 0011_pharmacy_chains_add_contact_phone_verified.sql — EP-03 (DTJ-064)
-- =============================================================================
-- [ДОПОЛНЕНИЕ] `pharmacy_chains.contact_phone_verified` — флаг успешной
-- OTP-верификации контактного телефона заявки (SRS-ADM-004,
-- VerifyChainContactPhoneUseCase). Поле не предусмотрено ни базовой
-- DDL 0008, ни §10.1 module-27; введено как минимально необходимое
-- для фиксации результата верификации (поле CHECK-валидации
-- `pharmacy_chains.contact_phone` не имеет прямой связи с
-- `contact_phone_verified`).
-- =============================================================================

ALTER TABLE pharmacy_chains
    ADD COLUMN IF NOT EXISTS contact_phone_verified BOOLEAN NOT NULL DEFAULT false;
