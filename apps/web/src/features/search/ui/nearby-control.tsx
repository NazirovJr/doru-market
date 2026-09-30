import type { ReactElement } from 'react'
import { Button } from '@dorutj/ui'
import type { TranslateFunction } from '@dorutj/i18n'
import type { GeoStatus } from '@/shared/geo/geo-store'

export interface NearbyControlProps {
  readonly status: GeoStatus
  readonly onRequest: () => void
  readonly t: TranslateFunction
}

const STATUS_MESSAGE_KEY: Readonly<Record<Exclude<GeoStatus, 'idle'>, string>> = {
  pending: 'catalog.geo.pending',
  granted: 'catalog.geo.active',
  denied: 'catalog.geo.denied',
  unavailable: 'catalog.geo.unavailable',
}

const canRequest = (status: GeoStatus): boolean => status === 'idle' || status === 'unavailable'

export const NearbyControl = ({ status, onRequest, t }: NearbyControlProps): ReactElement => (
  <div data-testid="nearby-control" className="flex flex-col items-start gap-2">
    {status === 'idle' ? null : (
      <p role="status" data-testid="nearby-status" data-status={status} className="text-sm text-ink-muted">
        {t(STATUS_MESSAGE_KEY[status])}
      </p>
    )}
    {canRequest(status) ? (
      <Button variant="secondary" onClick={onRequest}>
        {t('catalog.geo.request_cta')}
      </Button>
    ) : null}
  </div>
)
