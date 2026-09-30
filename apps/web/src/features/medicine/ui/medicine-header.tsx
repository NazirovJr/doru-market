import type { ReactElement } from 'react'
import { Badge } from '@dorutj/ui'
import type { TranslateFunction } from '@dorutj/i18n'
import type { MedicineDetail } from '../api/use-medicine-detail'

export interface MedicineHeaderProps {
  readonly medicine: MedicineDetail
  readonly t: TranslateFunction
}

export const MedicineHeader = ({ medicine, t }: MedicineHeaderProps): ReactElement => (
  <header data-testid="medicine-header" className="flex flex-col gap-1">
    <div className="flex items-start justify-between gap-2">
      <h1 className="text-lg font-semibold text-ink">{medicine.tradeName}</h1>
      {medicine.isPrescriptionRequired ? (
        <span data-testid="medicine-rx-badge" className="shrink-0">
          <Badge tone="warning">{t('catalog.medicine.rx_badge')}</Badge>
        </span>
      ) : null}
    </div>
    <p className="text-sm text-ink-muted">
      {medicine.innName} · {medicine.dosageForm} {medicine.dosageStrength}
    </p>
    <p className="text-sm text-ink-muted">
      {t('catalog.medicine.manufacturer', {
        manufacturer: medicine.manufacturerName,
        country: medicine.manufacturerCountry,
      })}
    </p>
    {medicine.description === null ? null : <p className="mt-2 text-sm text-ink">{medicine.description}</p>}
  </header>
)
