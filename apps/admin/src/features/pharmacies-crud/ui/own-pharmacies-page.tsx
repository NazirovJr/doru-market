// Обзор своих точек. Без фильтра по сети (chainId резолвится сервером через scope=own) —
// единственный фильтр той же формы, что PharmacyAccountsPage, здесь избыточен.
import { useEffect, useState, type ReactElement } from 'react'
import { Link } from 'react-router'
import { useT } from '@dorutj/i18n'
import type { PharmacyAccountAdminSummaryDto } from '@dorutj/contracts'
import { ADMIN_LOCALE } from '@/shared/config/locale'
import { useOwnPharmacyAccounts } from '../api/use-pharmacy-accounts'

const STATUS_BADGE_STATE: Readonly<Record<string, 'success' | 'warning' | 'danger' | 'neutral'>> = {
  draft: 'neutral',
  pending_review: 'warning',
  changes_requested: 'warning',
  approved: 'success',
  active: 'success',
  rejected: 'danger',
  suspended: 'danger',
  terminated: 'danger',
}

const BADGE_TOKENS: Readonly<Record<'success' | 'warning' | 'danger' | 'neutral', { readonly bg: string; readonly text: string }>> = {
  success: { bg: 'var(--color-status-success-bg)', text: 'var(--color-status-success-text)' },
  warning: { bg: 'var(--color-status-warning-bg)', text: 'var(--color-status-warning-text)' },
  danger: { bg: 'var(--color-status-danger-bg)', text: 'var(--color-status-danger-text)' },
  neutral: { bg: 'var(--color-status-neutral-bg)', text: 'var(--color-status-neutral-text)' },
}

const BADGE_PADDING = '2px 8px'
const BADGE_BORDER_RADIUS = '4px'
const LICENSE_EXPIRY_WARNING_DAYS = 30
const HOURS_PER_DAY = 24
const MINUTES_PER_HOUR = 60
const SECONDS_PER_MINUTE = 60
const MS_PER_SECOND = 1000
const MS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND

export const OwnPharmaciesPage = (): ReactElement => {
  const { t } = useT(ADMIN_LOCALE)
  const [cursor, setCursor] = useState<string | null>(null)
  const [items, setItems] = useState<readonly PharmacyAccountAdminSummaryDto[]>([])

  const query = useOwnPharmacyAccounts(cursor)

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
    <section data-testid="own-pharmacies-page">
      <h1>{t('admin.own_pharmacies.title')}</h1>

      {query.isLoading ? <p role="status">{t('admin.own_pharmacies.loading')}</p> : null}
      {query.error !== null ? <p role="alert">{t('admin.own_pharmacies.error')}</p> : null}

      <table>
        <thead>
          <tr>
            <th>{t('admin.own_pharmacies.column.name')}</th>
            <th>{t('admin.own_pharmacies.column.status')}</th>
            <th>{t('admin.own_pharmacies.column.license_expiry')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((account) => (
            <OwnPharmacyRow key={account.id} account={account} />
          ))}
        </tbody>
      </table>
      {!query.isLoading && items.length === 0 ? <p>{t('admin.own_pharmacies.empty')}</p> : null}
      {query.data?.hasMore === true ? (
        <button type="button" onClick={loadMore}>
          {t('admin.own_pharmacies.load_more')}
        </button>
      ) : null}
    </section>
  )
}

function isLicenseExpiringSoon(licenseExpiryDate: string | null): boolean {
  if (licenseExpiryDate === null) return false
  const daysLeft = (new Date(licenseExpiryDate).getTime() - Date.now()) / MS_PER_DAY
  return daysLeft < LICENSE_EXPIRY_WARNING_DAYS
}

const OwnPharmacyRow = ({ account }: { readonly account: PharmacyAccountAdminSummaryDto }): ReactElement => {
  const { t } = useT(ADMIN_LOCALE)
  const state = STATUS_BADGE_STATE[account.status] ?? 'neutral'
  const tokens = BADGE_TOKENS[state]
  const expiringSoon = isLicenseExpiringSoon(account.licenseExpiryDate)
  const expiryTokens = expiringSoon ? BADGE_TOKENS.warning : null

  return (
    <tr data-testid="own-pharmacy-row">
      <td>
        <Link to={`/admin/my-pharmacies/${account.id}`}>{account.name}</Link>
      </td>
      <td>
        <span
          data-testid="own-pharmacy-status-badge"
          style={{ backgroundColor: tokens.bg, color: tokens.text, padding: BADGE_PADDING, borderRadius: BADGE_BORDER_RADIUS }}
        >
          {t(`admin.pharmacy_accounts.status.${account.status}`)}
        </span>
      </td>
      <td>
        {account.licenseExpiryDate ?? '—'}
        {expiryTokens !== null ? (
          <span
            data-testid="own-pharmacy-license-warning-badge"
            style={{ backgroundColor: expiryTokens.bg, color: expiryTokens.text, padding: BADGE_PADDING, borderRadius: BADGE_BORDER_RADIUS, marginLeft: '8px' }}
          >
            {t('admin.own_pharmacies.license_expiring_soon')}
          </span>
        ) : null}
      </td>
    </tr>
  )
}
