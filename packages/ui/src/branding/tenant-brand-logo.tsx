import type { ReactElement } from 'react'
import { BrandLogo } from '../components/brand-logo/brand-logo'
import { useTenantBranding } from './tenant-branding'

export interface TenantBrandLogoProps {
  /** `t('brand.name')` — имя до загрузки брендинга или при недоступном API. */
  readonly fallbackName: string
  readonly size?: number
}

export const TenantBrandLogo = ({ fallbackName, size }: TenantBrandLogoProps): ReactElement => {
  const branding = useTenantBranding()
  return (
    <BrandLogo
      altText={branding?.brandName ?? fallbackName}
      {...(branding?.logoUrl != null && { logoUrl: branding.logoUrl })}
      {...(size !== undefined && { size })}
    />
  )
}
