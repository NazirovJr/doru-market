import { useSyncExternalStore } from 'react'
import { BRAND_COLOR_KEYS } from '../tokens/branding-allowlist'

export interface TenantBranding {
  readonly brandName: string
  readonly palette: Readonly<Record<string, string>>
  readonly logoUrl: string | null
  readonly faviconUrl: string | null
}

export type BrandingLoader = () => Promise<unknown>

export interface BootstrapBrandingOptions {
  readonly timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 1500
// camelCase-ключи allowlist -> CSS-имена (primaryHover -> --brand-primary-hover); семантические цвета сюда не входят.
const EDITABLE_TOKENS: ReadonlySet<string> = new Set(
  [...BRAND_COLOR_KEYS, 'radius', 'fontFamily'].map((key) => `--brand-${key.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`),
)
// HEX, радиус или шрифтовой стек: то, что сервер и так пропускает через allowlist (defense in depth на клиенте).
const TOKEN_VALUE = /^(#[0-9a-fA-F]{6}|\d{1,2}px|[A-Za-z0-9' ,-]{1,80})$/u
const HTTP_URL = /^https?:\/\//u

let current: TenantBranding | null = null
const listeners = new Set<() => void>()

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const optionalUrl = (value: unknown): string | null => (typeof value === 'string' && HTTP_URL.test(value) ? value : null)

// Принимает тело ответа GET /tenant/branding (уже без конверта); невалидное → null, страница остаётся на дефолтах.
export function parseTenantBranding(raw: unknown): TenantBranding | null {
  if (!isRecord(raw) || typeof raw.brandName !== 'string' || raw.brandName.length === 0 || !isRecord(raw.palette)) {
    return null
  }
  const palette = Object.fromEntries(
    Object.entries(raw.palette).filter(
      (entry): entry is [string, string] => EDITABLE_TOKENS.has(entry[0]) && typeof entry[1] === 'string' && TOKEN_VALUE.test(entry[1]),
    ),
  )
  return { brandName: raw.brandName, palette, logoUrl: optionalUrl(raw.logoUrl), faviconUrl: optionalUrl(raw.faviconUrl) }
}

function applyFavicon(faviconUrl: string): void {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' }))
  link.href = faviconUrl
}

export function applyTenantBranding(branding: TenantBranding): void {
  for (const [key, value] of Object.entries(branding.palette)) {
    document.documentElement.style.setProperty(key, value)
  }
  document.title = branding.brandName
  if (branding.faviconUrl !== null) {
    applyFavicon(branding.faviconUrl)
  }
  current = branding
  listeners.forEach((listener) => {
    listener()
  })
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

// Никогда не отклоняется: сбой сети/формата оставляет нейтральные дефолты; опоздавший ответ применяется позже.
export async function bootstrapBranding(load: BrandingLoader, options: BootstrapBrandingOptions = {}): Promise<void> {
  const applied = Promise.resolve()
    .then(load)
    .then((raw) => {
      const branding = parseTenantBranding(raw)
      if (branding !== null) {
        applyTenantBranding(branding)
      }
    })
    .catch(() => undefined)
  await Promise.race([applied, sleep(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)])
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// null, пока бренд не загружен: потребитель подставляет i18n-фолбэк `brand.name`.
export function useTenantBranding(): TenantBranding | null {
  return useSyncExternalStore(subscribe, () => current, () => null)
}
