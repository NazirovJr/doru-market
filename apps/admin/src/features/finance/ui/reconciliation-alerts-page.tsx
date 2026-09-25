// SRS-ADM-034 — единственный экран платформы, помеченный «требует немедленного расследования»
// в самом UI. Badge danger — CSS-переменные `--color-status-danger-*` (тот же приём, что SlaBadge).
import { useEffect, useState, type ReactElement } from 'react'
import { useT, toIntlLocale } from '@dorutj/i18n'
import type { FinanceReconciliationAlertDto } from '@dorutj/contracts'
import { ADMIN_LOCALE } from '@/shared/config/locale'
import { useReconciliationAlerts } from '../api/use-finance-ledger'

const DIRAM_PER_SOMONI = 100
const SOMONI_FRACTION_DIGITS = 2
const BADGE_PADDING = '2px 8px'
const BADGE_BORDER_RADIUS = '4px'

function formatSomoni(diram: number): string {
  return new Intl.NumberFormat(toIntlLocale(ADMIN_LOCALE), { maximumFractionDigits: SOMONI_FRACTION_DIGITS }).format(diram / DIRAM_PER_SOMONI)
}

export const ReconciliationAlertsPage = (): ReactElement => {
  const { t } = useT(ADMIN_LOCALE)
  const [cursor, setCursor] = useState<string | null>(null)
  const [items, setItems] = useState<readonly FinanceReconciliationAlertDto[]>([])
  const query = useReconciliationAlerts(cursor)

  useEffect(() => {
    if (query.data === undefined) return
    setItems((prev) => (cursor === null ? query.data.items : [...prev, ...query.data.items]))
  }, [query.data])

  function loadMore(): void {
    if (query.data?.nextCursor != null) {
      setCursor(query.data.nextCursor)
    }
  }

  return (
    <section data-testid="reconciliation-alerts-page">
      <h1>{t('admin.finance.reconciliation_alerts.title')}</h1>
      <p
        role="alert"
        data-testid="reconciliation-alert-warning"
        style={{
          backgroundColor: 'var(--color-status-danger-bg)',
          color: 'var(--color-status-danger-text)',
          padding: BADGE_PADDING,
          borderRadius: BADGE_BORDER_RADIUS,
        }}
      >
        {t('admin.finance.reconciliation_alert_warning')}
      </p>

      {query.isLoading ? <p role="status">{t('admin.finance.loading')}</p> : null}
      {query.error !== null ? <p role="alert">{t('admin.finance.error')}</p> : null}

      <table>
        <thead>
          <tr>
            <th>{t('admin.finance.reconciliation_alerts.column.order')}</th>
            <th>{t('admin.finance.reconciliation_alerts.column.discrepancy')}</th>
            <th>{t('admin.finance.reconciliation_alerts.column.repeat_count')}</th>
            <th>{t('admin.finance.reconciliation_alerts.column.detected_at')}</th>
            <th>{t('admin.finance.reconciliation_alerts.column.status')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((alert) => (
            <tr key={alert.orderId} data-testid="reconciliation-alert-row">
              <td>
                <a href={`/admin/orders/${alert.orderId}`}>{alert.orderId}</a>
              </td>
              <td>{formatSomoni(alert.discrepancyDiram)}</td>
              <td>{alert.repeatDetectionCount}</td>
              <td>{new Date(alert.detectedAt).toLocaleString()}</td>
              <td>
                <span
                  data-testid="reconciliation-alert-badge"
                  style={{ backgroundColor: 'var(--color-status-danger-bg)', color: 'var(--color-status-danger-text)', padding: BADGE_PADDING, borderRadius: BADGE_BORDER_RADIUS }}
                >
                  {t('admin.finance.reconciliation_alerts.badge_danger')}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!query.isLoading && items.length === 0 ? <p>{t('admin.finance.reconciliation_alerts.empty')}</p> : null}
      {query.data?.hasMore === true ? (
        <button type="button" onClick={loadMore}>
          {t('admin.finance.load_more')}
        </button>
      ) : null}
    </section>
  )
}
