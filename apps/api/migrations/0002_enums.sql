-- 0002_enums.sql (EP-01, DTJ-013, SRS-DB-008/009).
--
-- Создаёт общие enum'ы (`user_role`, `otp_purpose`) — первый рубеж защиты
-- (SRS-DB-008): Postgres отвергает INSERT/UPDATE со значением, не входящим
-- в enum. Бизнес-правила переходов валидируются в domain, не на уровне БД.
--
-- Применяется ПОСЛЕ 0001_extensions.sql (расширения не зависят от enum'ов
-- напрямую, но нумерация — по порядку создания файлов).

CREATE TYPE "user_role" AS ENUM (
  'customer',
  'pharmacist',
  'courier',
  'pharmacy_admin',
  'super_admin',
  'support_agent'
);

CREATE TYPE "otp_purpose" AS ENUM (
  'login',
  'delivery_handover'
);
