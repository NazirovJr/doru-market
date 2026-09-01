/**
 * Drizzle-схема `otp_codes` (EP-01, DTJ-015, SRS-DOM-069, SRS-API-021).
 *
 * Хранит ХЕШ OTP-кода, не сам код. Сырой код существует только в стеке
 * `RequestOtpUseCase` (формируется `OtpGeneratorPort` → передаётся в
 * `SmsProvider` → забывается). Соль — `id` строки (UUID, используется как
 * nonce); до записи строки `id` неизвестен, поэтому use case предвычисляет
 * `otpRequestId` ПЕРЕД хешированием (`SRS-API-021`, `DTJ-023` §5.3).
 *
 * Поля:
 *   - `id`          — UUID v7 (выступает солью, см. выше).
 *   - `tenant_id`   — UUID, FK на `tenants(id)` отложен (EP-02).
 *   - `subject_ref` — к чему привязан код (E.164 телефона для `login`,
 *                     `telegram_chat_id` для TWA).
 *   - `purpose`     — `'login' | 'onboarding_contact'` (enum расширяется).
 *   - `code_hash`   — sha256(code + ':' + id), 64 hex.
 *   - `attempts`    — счётчик неудачных попыток verify (lock при превышении).
 *   - `expires_at`  — TTL (300с по умолчанию, `OTP_TTL_SECONDS`).
 *   - `consumed_at` — момент успешного verify, NULL пока не использован.
 *
 * SRS-DB-008: индекс по `(subject_ref, purpose, expires_at)` — hot-path
 * `findActive(subjectRef, purpose)` в `VerifyOtpUseCase` (DTJ-024).
 */
import { sql } from 'drizzle-orm'
import {
  check,
  customType,
  index,
  integer,
  pgTable,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

const TIMESTAMPTZ = customType<{ data: Date; driverData: string }>({
  dataType() {
    return 'timestamp with time zone'
  },
})

export const OTP_CODES_TABLE = 'otp_codes'

export const OTP_PURPOSE_VALUES = ['login', 'onboarding_contact'] as const
export type OtpPurposeDb = (typeof OTP_PURPOSE_VALUES)[number]

// Drizzle ORM 0.45: третий параметр pgTable ещё принимает объект; миграция на
// новый массив — в Drizzle 1.0. Подавляем до апгрейда (конвенция других схем
// проекта, см. `pharmacy-inventory.ts`).
// eslint-disable-next-line @typescript-eslint/no-deprecated -- Drizzle ORM 0.45: третий параметр pgTable ещё принимает объект extras; миграция на новый массив — в Drizzle 1.0. Подавляем до апгрейда (конвенция других схем проекта, см. pharmacy-inventory.ts).
export const otpCodes = pgTable(
  OTP_CODES_TABLE,
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    // FK → tenants(id) добавляется EP-02 эволюционной миграцией.
    tenantId: uuid('tenant_id').notNull(),
    subjectRef: varchar('subject_ref', { length: 64 }).notNull(),
    purpose: varchar('purpose', { length: 32 }).notNull().default('login'),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    issuedAt: TIMESTAMPTZ('issued_at').notNull().default(sql`NOW()`),
    expiresAt: TIMESTAMPTZ('expires_at').notNull(),
    consumedAt: TIMESTAMPTZ('consumed_at'),
  },
  (table) => ({
    activeBySubject: index('ix_otp_codes_active_by_subject').on(
      table.tenantId,
      table.subjectRef,
      table.purpose,
      table.expiresAt,
    ),
    uniqActive: uniqueIndex('ux_otp_codes_uniq_active')
      .on(table.tenantId, table.subjectRef, table.purpose)
      .where(sql`${table.consumedAt} IS NULL`),
    nonNegAttempts: check('chk_otp_codes_attempts_nonneg', sql`${table.attempts} >= 0`),
  }),
)

export type OtpCodeRow = typeof otpCodes.$inferSelect
export type OtpCodeInsert = typeof otpCodes.$inferInsert
