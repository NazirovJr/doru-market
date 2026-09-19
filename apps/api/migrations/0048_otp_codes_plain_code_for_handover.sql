-- =====================================================================================
-- 0048_otp_codes_plain_code_for_handover.sql — EP-12 (DTJ-306), plain_code для
-- purpose='delivery_handover' (SRS-PHT-028).
--
-- ДОПОЛНЕНИЕ, найденное при реализации DTJ-306: `otp_codes.code_hash` — необратимый
-- sha256-хеш (см. JSDoc `db/schema/otp-codes.ts`), из него нельзя восстановить код для
-- повторного показа фармацевту (`GetHandoverOtpUseCase`, «просмотр» — буквальное требование
-- тикета). Для `login`/`onboarding_contact` это правильно (учётные данные для входа —
-- хранить в открытом виде нельзя). Для `delivery_handover` — код НЕ учётные данные для входа,
-- а код, который фармацевт и так устно называет клиенту при вручении; секретность важна от
-- посторонних (кто НЕ участвует в вручении), а не от самого фармацевта/курьера/клиента.
-- Отдельная nullable-колонка, а не переиспользование `code_hash`, — чтобы не путать два разных
-- назначения одного столбца и не расширять поверхность атаки на login/onboarding: они этой
-- колонки никогда не заполняют (см. CompletePickingUseCase/RegenerateHandoverOtpUseCase —
-- единственные вызывающие с purpose='delivery_handover').
--
-- Идемпотентность (правило 11 AGENTS.md): `ADD COLUMN IF NOT EXISTS` — нативно идемпотентно.
-- =====================================================================================

ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS plain_code VARCHAR(16);
COMMENT ON COLUMN otp_codes.plain_code IS
    'DTJ-306: код в открытом виде, ТОЛЬКО для purpose=''delivery_handover''. NULL для '
    'login/onboarding_contact — те остаются хеш-только (учётные данные для входа).';
