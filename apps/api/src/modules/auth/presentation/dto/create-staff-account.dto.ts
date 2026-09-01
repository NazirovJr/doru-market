/**
 * Zod-схема `create-staff-account.dto.ts` (EP-01, DTJ-030, SRS-API-035).
 *
 * Контракт `POST /api/v1/staff-accounts`:
 *   - `phone`     — E.164 формат, валидируется через `PhoneNumber.parse`
 *                    в use case (не в Zod, чтобы правило формата имело ОДИН
 *                    источник, DTJ-008).
 *   - `fullName`  — отображаемое имя (1..255 символов).
 *   - `role`      — `pharmacist` | `courier` | `pharmacy_admin` |
 *                    `support_agent` | `super_admin`. `customer` НЕ допустим:
 *                    customer-flow — это самостоятельная OTP-регистрация
 *                    (DTJ-022/023/024), а не staff-аккаунт.
 *   - `pharmacyId` — опционально (UUID). Семантика для конкретной роли
 *                    проверяется в use case (для `pharmacist` — обязателен,
 *                    для `courier` — null, для `super_admin` — null).
 *   - `chainId`   — опционально (UUID). Семантика: для `pharmacist` и
 *                    `courier` (собственный флот) — обязателен. Для
 *                    `courier` платформенного пула и `super_admin` — null.
 *                    Проверяется в `StaffAccountPolicy` (DTJ-030).
 */
import { z } from 'zod'

const STAFF_ROLES = ['pharmacist', 'courier', 'pharmacy_admin', 'support_agent', 'super_admin'] as const

export const createStaffAccountDtoSchema = z.object({
  phone: z.string().min(1, 'phone is required'),
  fullName: z.string().min(1, 'fullName is required').max(255, 'fullName too long'),
  role: z.enum(STAFF_ROLES, { message: `role must be one of: ${STAFF_ROLES.join(', ')}` }),
  // `.nullish()` (не только `.optional()`): `CreateStaffAccountCommand.pharmacyId/chainId`
  // уже типизированы как `string | null | undefined` (см. use case) — для `courier`/
  // `super_admin` клиент по документированному контракту шлёт явный `null`, а не
  // опускает поле. Схема без `.nullable()` отклоняла такой запрос `400 VALIDATION_ERROR`
  // ещё до use case — обнаружено интеграционным тестом `cross-tenant-leakage` (сценарий
  // super_admin) и `create-staff-account` (сценарий C, `pharmacyId: null`).
  pharmacyId: z.uuid().nullish(),
  chainId: z.uuid().nullish(),
})

export type CreateStaffAccountDto = z.infer<typeof createStaffAccountDtoSchema>
