// Обзор своих точек. Без фильтра по сети (chainId резолвится сервером через scope=own) —
// единственный фильтр той же формы, что PharmacyAccountsPage, здесь избыточен.
import { useEffect, useState, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import type { PharmacyAccountAdminSummaryDto } from '@dorutj/contracts'
import { useLocale } from '@/shared/config/locale-provider'
import { useInventorySummary, useOwnPharmacyAccounts } from '../api/use-pharmacy-accounts'

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
const INVENTORY_SUMMARY_COLSPAN = 3

export const OwnPharmaciesPage = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const [cursor, setCursor] = useState<string | null>(null)
  const [items, setItems] = useState<readonly PharmacyAccountAdminSummaryDto[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)

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
            <OwnPharmacyRow
              key={account.id}
              account={account}
              expanded={expandedId === account.id}
              onToggle={() => { setExpandedId((prev) => (prev === account.id ? null : account.id)) }}
            />
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

interface OwnPharmacyRowProps {
  readonly account: PharmacyAccountAdminSummaryDto
  readonly expanded: boolean
  readonly onToggle: () => void
}

const OwnPharmacyRow = ({ account, expanded, onToggle }: OwnPharmacyRowProps): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const state = STATUS_BADGE_STATE[account.status] ?? 'neutral'
  const tokens = BADGE_TOKENS[state]
  const expiringSoon = isLicenseExpiringSoon(account.licenseExpiryDate)
  const expiryTokens = expiringSoon ? BADGE_TOKENS.warning : null

  return (
    <>
      <tr data-testid="own-pharmacy-row">
        <td>
          <button type="button" onClick={onToggle} data-testid="own-pharmacy-name-toggle">
            {account.name}
          </button>
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
      {expanded ? <InventorySummaryRow pharmacyId={account.id} /> : null}
    </>
  )
}

const InventorySummaryRow = ({ pharmacyId }: { readonly pharmacyId: string }): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const query = useInventorySummary(pharmacyId)

  return (
    <tr data-testid="own-pharmacy-inventory-summary-row">
      <td colSpan={INVENTORY_SUMMARY_COLSPAN}>
        {query.isLoading ? <span role="status">{t('admin.own_pharmacies.inventory_summary.loading')}</span> : null}
        {query.error !== null ? <span role="alert">{t('admin.own_pharmacies.inventory_summary.error')}</span> : null}
        {query.data !== undefined ? (
          <span data-testid="own-pharmacy-inventory-summary">
            {t('admin.own_pharmacies.inventory_summary.sku_count', { count: query.data.skuCount })}
            {' · '}
            {t('admin.own_pharmacies.inventory_summary.stale_share', { percent: query.data.staleDataSharePercent })}
            {query.data.staleDataSharePercent > 0 ? (
              <span
                data-testid="own-pharmacy-inventory-stale-warning-badge"
                style={{
                  backgroundColor: BADGE_TOKENS.warning.bg,
                  color: BADGE_TOKENS.warning.text,
                  padding: BADGE_PADDING,
                  borderRadius: BADGE_BORDER_RADIUS,
                  marginLeft: '8px',
                }}
              >
                {t('admin.own_pharmacies.inventory_summary.stale_warning')}
              </span>
            ) : null}
          </span>
        ) : null}
      </td>
    </tr>
  )
}
