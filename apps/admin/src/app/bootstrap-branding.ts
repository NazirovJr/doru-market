import { bootstrapBranding as applyTenantBrandingOnStart } from '@dorutj/ui'
import { httpGetJson } from '@/shared/api/http-client'

export function bootstrapBranding(): Promise<void> {
  return applyTenantBrandingOnStart(() => httpGetJson<unknown>('/api/v1/tenant/branding'))
}
