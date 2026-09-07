// Барель дизайн-токенов (DTJ-401). Подключается точкой входа приложения: import '@dorutj/ui/tokens'.
import './colors.css'
import './typography.css'
import './spacing.css'
import './radii.css'
import './shadows.css'

export { validateBrandingPayload } from './branding-allowlist.js'
export type {
  BrandingValidationError,
  TenantBrandingInput,
  ValidBranding,
} from './branding-allowlist.js'
