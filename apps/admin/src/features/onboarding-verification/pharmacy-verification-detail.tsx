import type { ReactElement } from 'react'
import { useT, type TranslateFunction } from '@dorutj/i18n'
import { Card } from '@dorutj/ui'
import { useLocale } from '@/shared/config/locale-provider'
import { formatIsoDate, useLicenseScanBlobUrl, usePharmacyVerificationDetail, type PharmacyVerificationDetail } from './use-pharmacy-verification-detail'

const PDF_CONTENT_TYPE = 'application/pdf'
const PREVIEW_HEIGHT_PX = 480

interface ScanPreviewProps {
  readonly scan: PharmacyVerificationDetail['licenseScan']
  readonly t: TranslateFunction
}

const LicenseScanPreview = ({ scan, t }: ScanPreviewProps): ReactElement => {
  const blob = useLicenseScanBlobUrl(scan)
  const title = t('admin.onboarding_detail.scan_title')
  if (scan === null) {
    return <p>{t('admin.onboarding_detail.scan_missing')}</p>
  }
  if (blob.failed) {
    return <p role="alert">{t('admin.onboarding_detail.error')}</p>
  }
  if (blob.url === null) {
    return <p role="status">{t('admin.onboarding_detail.loading')}</p>
  }
  return (
    <div data-testid="onboarding-document-preview">
      {scan.contentType === PDF_CONTENT_TYPE ? (
        <iframe src={blob.url} title={title} width="100%" height={PREVIEW_HEIGHT_PX} />
      ) : (
        <img src={blob.url} alt={t('admin.onboarding_detail.scan_alt')} style={{ maxWidth: '100%' }} />
      )}
    </div>
  )
}

export const PharmacyVerificationDetailView = ({ id }: { readonly id: string }): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const detail = usePharmacyVerificationDetail(id)

  if (detail.isError) {
    return <p role="alert">{t('admin.onboarding_detail.error')}</p>
  }
  if (detail.data === undefined) {
    return <p role="status">{t('admin.onboarding_detail.loading')}</p>
  }
  const data = detail.data
  const fields: readonly (readonly [string, string])[] = [
    [t('admin.onboarding_detail.name'), data.name],
    [t('admin.onboarding_detail.address'), data.addressText],
    [t('admin.onboarding_detail.phone'), data.phone],
    [t('admin.onboarding_detail.license_number'), data.licenseNumber],
    [t('admin.onboarding_detail.license_expiry'), formatIsoDate(data.licenseExpiryDate)],
    [t('admin.onboarding_detail.pharmacist'), data.pharmacistInChargeName ?? ''],
    [t('admin.onboarding_detail.status'), data.status],
  ]
  return (
    <Card>
      <h3>{t('admin.onboarding_detail.section')}</h3>
      <dl>
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <h3>{t('admin.onboarding_detail.scan_title')}</h3>
      <LicenseScanPreview scan={data.licenseScan} t={t} />
    </Card>
  )
}
