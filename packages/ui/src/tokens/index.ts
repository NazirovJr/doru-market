/**
 * DTJ-401 — единая точка подключения дизайн-токенов: `import '@dorutj/ui/tokens'`
 * в точке входа каждого приложения (SRS-UX-011..018). Барьерный файл (D-27):
 * правится только добавлением строки.
 */
import './colors.css'
import './typography.css'
import './spacing.css'
import './radii.css'
import './shadows.css'

export {
  BRAND_COLOR_KEYS,
  BRAND_FONT_FAMILY_ALLOWLIST,
  LOCKED_SEMANTIC_KEYS,
  validateBrandingPayload,
} from './branding-allowlist'
export type {
  BrandColorKey,
  BrandingValidationError,
  BrandingValidationErrorCode,
  BrandingValidationResult,
  LockedSemanticKey,
  TenantBrandingInput,
  ValidBranding,
} from './branding-allowlist'
