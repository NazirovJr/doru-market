/**
 * DTJ-401 — allowlist-валидация White-Label брендинга (SRS-TEN-014, SRS-UX-012, SRS-UX-015,
 * SRS-UX-017; угроза SRS-NFR-006 / TC-NFR-006 — CSS/HTML-инъекция через палитру).
 *
 * Чистая функция без ввода-вывода и зависимостей от React/DOM: пригодна и для формы брендинга
 * на фронте, и для серверной валидации `PATCH /tenant-settings`.
 *
 * Принцип: значение либо ТОЧНО совпадает с allowlist-форматом, либо отклоняется. Никаких попыток
 * «исправить» или экранировать — отклонённое значение не попадает в результат ни в каком виде.
 * Ошибка по одному полю не отбрасывает остальные валидные поля (частичная валидация).
 */

/** Ключи палитры, которые тенант вправе перекрасить (только HEX). */
export const BRAND_COLOR_KEYS = [
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

/** Семантические токены — смысл фиксирован дизайн-системой, тенант их не переопределяет (SRS-UX-012). */
export const LOCKED_SEMANTIC_KEYS = ['success', 'danger', 'warning'] as const

/**
 * Allowlist шрифтовых стеков (SRS-UX-015): ≤10 Google Fonts-стеков + системный fallback.
 * Добавление шрифта — одна строка в этот массив, валидатор не меняется. ОБЯЗАТЕЛЬНЫЙ ручной шаг
 * перед добавлением: проверить покрытие таджикских глифов `Ғ ғ Ӣ ӣ Қ қ Ӯ ӯ Ҳ ҳ Ҷ ҷ`.
 */
export const BRAND_FONT_FAMILY_ALLOWLIST: readonly string[] = [
  "'Inter', system-ui, sans-serif",
  'system-ui, sans-serif',
]

export type BrandColorKey = (typeof BRAND_COLOR_KEYS)[number]
export type LockedSemanticKey = (typeof LOCKED_SEMANTIC_KEYS)[number]

/** Вход не доверенный (JSON из формы/HTTP-тела), поэтому значения — `unknown`. */
export type TenantBrandingInput = Readonly<Record<string, unknown>>

export type ValidBranding = Partial<Record<BrandColorKey | 'radius' | 'fontFamily', string>>

export type BrandingValidationErrorCode =
  | 'INVALID_HEX_FORMAT'
  | 'BRAND_SEMANTIC_TOKEN_LOCKED'
  | 'INVALID_RADIUS_FORMAT'
  | 'FONT_FAMILY_NOT_ALLOWED'
  | 'UNKNOWN_BRAND_TOKEN'

export interface BrandingValidationError {
  readonly field: string
  readonly code: BrandingValidationErrorCode
}

/**
 * При ошибке `value` содержит только прошедшие allowlist поля — потребитель решает, применять ли
 * их частично (форма подсвечивает конкретные поля) или отклонить запрос целиком (сервер, 400).
 */
export type BrandingValidationResult =
  | { readonly ok: true; readonly value: ValidBranding }
  | {
      readonly ok: false
      readonly value: ValidBranding
      readonly errors: readonly BrandingValidationError[]
    }

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const RADIUS = /^\d{1,2}px$/
const SHORT_HEX_LENGTH = 4

type FieldOutcome = { readonly value: string } | { readonly code: BrandingValidationErrorCode }

const isColorKey = (key: string): key is BrandColorKey =>
  (BRAND_COLOR_KEYS as readonly string[]).includes(key)

const isLockedKey = (key: string): key is LockedSemanticKey =>
  (LOCKED_SEMANTIC_KEYS as readonly string[]).includes(key)

/** `#ABC` → `#aabbcc`: единая каноническая форма `^#[0-9a-f]{6}$` для хранения (SRS-TEN-014). */
function normalizeHex(hex: string): string {
  const lower = hex.toLowerCase()
  if (lower.length !== SHORT_HEX_LENGTH) return lower
  return `#${[...lower.slice(1)].map((digit) => digit + digit).join('')}`
}

function validateColor(raw: unknown): FieldOutcome {
  if (typeof raw !== 'string' || !HEX_COLOR.test(raw)) return { code: 'INVALID_HEX_FORMAT' }
  return { value: normalizeHex(raw) }
}

function validateRadius(raw: unknown): FieldOutcome {
  if (typeof raw !== 'string' || !RADIUS.test(raw)) return { code: 'INVALID_RADIUS_FORMAT' }
  return { value: raw }
}

function validateFontFamily(raw: unknown): FieldOutcome {
  if (typeof raw !== 'string' || !BRAND_FONT_FAMILY_ALLOWLIST.includes(raw)) {
    return { code: 'FONT_FAMILY_NOT_ALLOWED' }
  }
  return { value: raw }
}

function validateField(key: string, raw: unknown): FieldOutcome {
  if (isColorKey(key)) return validateColor(raw)
  if (isLockedKey(key)) return { code: 'BRAND_SEMANTIC_TOKEN_LOCKED' }
  if (key === 'radius') return validateRadius(raw)
  if (key === 'fontFamily') return validateFontFamily(raw)
  return { code: 'UNKNOWN_BRAND_TOKEN' }
}

/**
 * Проверяет каждое поле payload по allowlist. Неизвестные ключи (включая `__proto__`,
 * произвольные CSS-свойства) отклоняются — в результат попадают только известные токены.
 */
export function validateBrandingPayload(payload: TenantBrandingInput): BrandingValidationResult {
  const value: Record<string, string> = {}
  const errors: BrandingValidationError[] = []

  for (const [field, raw] of Object.entries(payload)) {
    const outcome = validateField(field, raw)
    if ('code' in outcome) errors.push({ field, code: outcome.code })
    else value[field] = outcome.value
  }

  const valid = value as ValidBranding
  return errors.length === 0 ? { ok: true, value: valid } : { ok: false, value: valid, errors }
}
