import { z } from 'zod'

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/u
const RADIUS_PATTERN = /^\d{1,2}px$/u
const MAX_BRAND_NAME_LENGTH = 255

export const BRAND_FONT_FAMILY_ALLOWLIST = ["'Inter', system-ui, sans-serif", 'system-ui, sans-serif'] as const

const hexColor = z.string().regex(HEX_COLOR_PATTERN, 'Expected a 6-digit HEX color')

// Каждый токен — явное поле strict-объекта: неизвестный ключ отклоняется, а не сохраняется молча.
export const BrandPaletteSchema = z.strictObject({
  '--brand-primary': hexColor,
  '--brand-primary-hover': hexColor,
  '--brand-secondary': hexColor,
  '--brand-accent': hexColor,
  '--brand-bg': hexColor,
  '--brand-surface': hexColor,
  '--brand-text': hexColor,
  '--brand-text-muted': hexColor,
  '--brand-border': hexColor,
  '--brand-success': hexColor,
  '--brand-danger': hexColor,
  '--brand-warning': hexColor,
  '--brand-radius': z.string().regex(RADIUS_PATTERN, 'Expected a radius like "8px"'),
  '--brand-font-family': z.enum(BRAND_FONT_FAMILY_ALLOWLIST),
})

export type BrandPalette = z.infer<typeof BrandPaletteSchema>

// Значения обязаны совпадать с :root в index.html приложений (sync-тесты) и палитрой neutral-тенанта в БД.
export const NEUTRAL_FALLBACK_PALETTE: BrandPalette = {
  '--brand-primary': '#64748b',
  '--brand-primary-hover': '#475569',
  '--brand-secondary': '#94a3b8',
  '--brand-accent': '#0ea5e9',
  '--brand-bg': '#f8fafc',
  '--brand-surface': '#ffffff',
  '--brand-text': '#0f172a',
  '--brand-text-muted': '#64748b',
  '--brand-border': '#e2e8f0',
  '--brand-success': '#16a34a',
  '--brand-danger': '#dc2626',
  '--brand-warning': '#d97706',
  '--brand-radius': '8px',
  '--brand-font-family': 'system-ui, sans-serif',
}

// partial() типизирует ключи как `string | undefined`; результат нужен как Record<string, string> (доменный тип палитры).
export const BrandPalettePatchSchema = BrandPaletteSchema.partial().transform(
  (palette): Readonly<Record<string, string>> =>
    Object.fromEntries(Object.entries(palette).filter((entry): entry is [string, string] => entry[1] !== undefined)),
)

export const BrandLogoUrlSchema = z.url({ protocol: /^https?$/u })

export const UpdateBrandingRequestSchema = z.strictObject({
  brandName: z.string().trim().min(1).max(MAX_BRAND_NAME_LENGTH),
  brandPalette: BrandPalettePatchSchema,
  logoUrl: BrandLogoUrlSchema.nullable().optional(),
})

export type UpdateBrandingRequestDto = z.infer<typeof UpdateBrandingRequestSchema>

export interface TenantBrandingDto {
  readonly slug: string
  readonly brandName: string
  readonly palette: Readonly<Record<string, string>>
  readonly logoUrl: string | null
  readonly faviconUrl: string | null
  readonly supportPhone: string | null
}
