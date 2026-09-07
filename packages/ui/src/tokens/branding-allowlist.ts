/**
 * Валидатор White-Label allowlist для брендинга тенанта (`SRS-TEN-014`, `SRS-UX-011/012`).
 *
 * Чистая функция без побочных эффектов и без зависимостей от React/DOM — переиспользуется и
 * фронтендом (форма настроек бренда), и потенциально бэкендом (`PATCH /tenant-settings`, EP-03/
 * EP-15) как единственный источник истины allowlist-правил (`docs/03-ARCHITECT-DECISIONS.md` D-01:
 * ребрендинг обязан стоить смену конфига, ноль правок кода — включая ноль дублирования правил
 * валидации между фронтом и бэком).
 *
 * `Result<TValue, TErrors>` определён локально (не импортирован из `@dorutj/domain-kernel`), по
 * тому же принципу, что и в `packages/domain-kernel/src/common/result.ts`: пакет не тянет
 * кросс-слойную зависимость ради структурно совместимого типа. Форма отличается от
 * `domain-kernel` сознательно — критерии приёмки тикета DTJ-401 явно фиксируют поле `errors`
 * (не `error`) и требуют, чтобы частичная ошибка одного поля не отбрасывала валидные значения
 * остальных полей — поэтому ветка `ok: false` несёт одновременно `errors` (что не прошло) и
 * `value` (что прошло, `Partial<TValue>`), а не только ошибку.
 */

const HEX_COLOR_FIELDS = [
  'primary',
  'primaryHover',
  'secondary',
  'accent',
  'bg',
  'surface',
  'text',
  'textMuted',
  'border',
] as const

const LOCKED_SEMANTIC_FIELDS = ['success', 'danger', 'warning'] as const

type LockedSemanticField = (typeof LOCKED_SEMANTIC_FIELDS)[number]

const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const RADIUS_PATTERN = /^\d{1,2}px$/

/**
 * Allowlist шрифтовых стеков White-Label (`SRS-UX-015`, `SRS-TEN-014`), ≤10 записей + фолбэк.
 * КАЖДЫЙ стек в этом списке обязан покрывать таджикскую кириллицу (`Ғ ғ Ӣ ӣ Қ қ Ӯ ӯ Ҳ ҳ Ҷ ҷ`) —
 * проверка выполняется ОДИН РАЗ вручную при добавлении шрифта (`SRS-UX-015`), не в рантайме этой
 * функции. На этом тикете список содержит один проверенный стек, структура (массив строк)
 * поддерживает добавление новых записей без изменения логики валидатора.
 */
export const BRAND_FONT_FAMILY_ALLOWLIST: readonly string[] = ["'Inter', system-ui, sans-serif"]

export type BrandingErrorCode =
  | 'INVALID_HEX_FORMAT'
  | 'BRAND_SEMANTIC_TOKEN_LOCKED'
  | 'INVALID_RADIUS_FORMAT'
  | 'INVALID_FONT_FAMILY'

export interface BrandingValidationError {
  readonly field: string
  readonly code: BrandingErrorCode
}

/** Входной payload `PATCH /tenant-settings` (поле палитры). */
export interface TenantBrandingInput {
  readonly primary?: string
  readonly primaryHover?: string
  readonly secondary?: string
  readonly accent?: string
  readonly bg?: string
  readonly surface?: string
  readonly text?: string
  readonly textMuted?: string
  readonly border?: string
  readonly radius?: string
  readonly fontFamily?: string
  /** Присутствие ключа — само по себе ошибка `BRAND_SEMANTIC_TOKEN_LOCKED` (`SRS-UX-012`). */
  readonly success?: string
  readonly danger?: string
  readonly warning?: string
}

/** Прошедшие валидацию поля (семантические токены исключены — тенант их не редактирует). */
export type ValidBranding = Omit<TenantBrandingInput, LockedSemanticField>

export type Result<TValue, TErrors> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly errors: TErrors; readonly value: Partial<TValue> }

interface FieldValidationOutcome {
  readonly errors: readonly BrandingValidationError[]
  readonly value: Readonly<Record<string, string>>
}

function validateLockedFields(payload: TenantBrandingInput): FieldValidationOutcome {
  const errors: BrandingValidationError[] = []
  for (const field of LOCKED_SEMANTIC_FIELDS) {
    if (payload[field] !== undefined) {
      errors.push({ field, code: 'BRAND_SEMANTIC_TOKEN_LOCKED' })
    }
  }
  return { errors, value: {} }
}

function validateHexColorFields(payload: TenantBrandingInput): FieldValidationOutcome {
  const errors: BrandingValidationError[] = []
  const value: Record<string, string> = {}
  for (const field of HEX_COLOR_FIELDS) {
    const raw = payload[field]
    if (raw === undefined) continue
    if (HEX_COLOR_PATTERN.test(raw)) {
      value[field] = raw.toLowerCase()
    } else {
      errors.push({ field, code: 'INVALID_HEX_FORMAT' })
    }
  }
  return { errors, value }
}

function validateRadiusField(payload: TenantBrandingInput): FieldValidationOutcome {
  if (payload.radius === undefined) return { errors: [], value: {} }
  if (RADIUS_PATTERN.test(payload.radius)) {
    return { errors: [], value: { radius: payload.radius } }
  }
  return { errors: [{ field: 'radius', code: 'INVALID_RADIUS_FORMAT' }], value: {} }
}

function validateFontFamilyField(payload: TenantBrandingInput): FieldValidationOutcome {
  if (payload.fontFamily === undefined) return { errors: [], value: {} }
  if (BRAND_FONT_FAMILY_ALLOWLIST.includes(payload.fontFamily)) {
    return { errors: [], value: { fontFamily: payload.fontFamily } }
  }
  return { errors: [{ field: 'fontFamily', code: 'INVALID_FONT_FAMILY' }], value: {} }
}

/**
 * Валидирует payload брендинга тенанта против allowlist. Ошибка одного поля НЕ отбрасывает
 * валидные значения других полей — `value` в ветке `ok: false` содержит все успешно
 * провалидированные поля, `errors` — конкретные отклонённые поля с кодом причины.
 */
export function validateBrandingPayload(
  payload: TenantBrandingInput,
): Result<ValidBranding, readonly BrandingValidationError[]> {
  const outcomes = [
    validateLockedFields(payload),
    validateHexColorFields(payload),
    validateRadiusField(payload),
    validateFontFamilyField(payload),
  ]

  const errors = outcomes.flatMap((outcome) => outcome.errors)
  const value: Record<string, string> = outcomes.reduce<Record<string, string>>(
    (acc, outcome) => ({ ...acc, ...outcome.value }),
    {},
  )

  if (errors.length === 0) {
    return { ok: true, value }
  }
  return { ok: false, errors, value }
}
