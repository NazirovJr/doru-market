import { bootstrapBranding as applyTenantBrandingOnStart } from '@dorutj/ui'
import { httpGetJson } from '@/shared/api/http-client'

// Браузерный HTTP-кэш сам ревалидирует ответ по ETag, поэтому If-None-Match вручную не шлём.
export function bootstrapBranding(): Promise<void> {
  return applyTenantBrandingOnStart(() => httpGetJson<unknown>('/api/v1/tenant/branding'))
}
