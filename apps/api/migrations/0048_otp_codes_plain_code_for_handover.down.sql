-- Down-миграция для 0048_otp_codes_plain_code_for_handover.sql (DTJ-306).

ALTER TABLE otp_codes DROP COLUMN IF EXISTS plain_code;
