// Фильтр «сеть» — текстовое поле chainId, не Select: эндпоинт списка сетей вне периметра тикета.
import { useEffect, useState, type ChangeEvent, type ReactElement } from 'react'
import { Link } from 'react-router'
import { useT } from '@dorutj/i18n'
import type { PharmacyAccountAdminSummaryDto } from '@dorutj/contracts'
import { useLocale } from '@/shared/config/locale-provider'
import { usePharmacyAccounts, usePharmacyAccountsFilters, type PharmacyAccountsFilters } from '../api/use-pharmacy-accounts'

const STATUS_VALUES = ['draft', 'pending_review', 'changes_requested', 'approved', 'active', 'rejected', 'suspended', 'terminated'] as const

const STATUS_BADGE_STATE: Readonly<Record<(typeof STATUS_VALUES)[number], 'success' | 'warning' | 'danger' | 'neutral'>> = {
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

export const PharmacyAccountsPage = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const { filters, setFilter, resetFilters } = usePharmacyAccountsFilters()
  const [nameDraft, setNameDraft] = useState(filters.name ?? '')
  const [cursor, setCursor] = useState<string | null>(null)
  const [items, setItems] = useState<readonly PharmacyAccountAdminSummaryDto[]>([])

  const query = usePharmacyAccounts(filters, cursor)

  useEffect(() => {
    setCursor(null)
    setItems([])
  }, [filters])

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
    <section data-testid="pharmacy-accounts-page">
      <h1>{t('admin.pharmacy_accounts.title')}</h1>
      <PharmacyAccountsFiltersForm
        filters={filters}
        nameDraft={nameDraft}
        onNameDraftChange={setNameDraft}
        onSetFilter={setFilter}
        onReset={() => {
          setNameDraft('')
          resetFilters()
        }}
      />

      {query.isLoading ? <p role="status">{t('admin.pharmacy_accounts.loading')}</p> : null}
      {query.error !== null ? <p role="alert">{t('admin.pharmacy_accounts.error')}</p> : null}

      <table>
        <thead>
          <tr>
            <th>{t('admin.pharmacy_accounts.column.name')}</th>
            <th>{t('admin.pharmacy_accounts.column.chain')}</th>
            <th>{t('admin.pharmacy_accounts.column.status')}</th>
            <th>{t('admin.pharmacy_accounts.column.license_expiry')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((account) => (
            <PharmacyAccountRow key={account.id} account={account} />
          ))}
        </tbody>
      </table>
      {!query.isLoading && items.length === 0 ? <p>{t('admin.pharmacy_accounts.empty')}</p> : null}
      {query.data?.hasMore === true ? (
        <button type="button" onClick={loadMore}>
          {t('admin.pharmacy_accounts.load_more')}
        </button>
      ) : null}
    </section>
  )
}

interface PharmacyAccountsFiltersFormProps {
  readonly filters: PharmacyAccountsFilters
  readonly nameDraft: string
  readonly onNameDraftChange: (value: string) => void
  readonly onSetFilter: (key: keyof PharmacyAccountsFilters, value: string | undefined) => void
  readonly onReset: () => void
}

const PharmacyAccountsFiltersForm = ({
  filters,
  nameDraft,
  onNameDraftChange,
  onSetFilter,
  onReset,
}: PharmacyAccountsFiltersFormProps): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  return (
    <form
      data-testid="pharmacy-accounts-filters"
      onSubmit={(e) => {
        e.preventDefault()
        onSetFilter('name', nameDraft.trim() === '' ? undefined : nameDraft.trim())
      }}
    >
      <label>
        {t('admin.pharmacy_accounts.filter.status')}
        <select
          value={filters.status ?? ''}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => { onSetFilter('status', e.target.value === '' ? undefined : e.target.value) }}
        >
          <option value="">{t('admin.pharmacy_accounts.filter.status_all')}</option>
          {STATUS_VALUES.map((status) => (
            <option key={status} value={status}>
              {t(`admin.pharmacy_accounts.status.${status}`)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('admin.pharmacy_accounts.filter.chain_id')}
        <input
          value={filters.chainId ?? ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) => { onSetFilter('chainId', e.target.value.trim() === '' ? undefined : e.target.value.trim()) }}
        />
      </label>
      <label>
        {t('admin.pharmacy_accounts.filter.name')}
        <input value={nameDraft} onChange={(e: ChangeEvent<HTMLInputElement>) => { onNameDraftChange(e.target.value) }} />
      </label>
      <button type="submit">{t('admin.pharmacy_accounts.filter.apply')}</button>
      <button type="button" onClick={onReset}>
        {t('admin.pharmacy_accounts.filter.reset')}
      </button>
    </form>
  )
}

const PharmacyAccountRow = ({ account }: { readonly account: PharmacyAccountAdminSummaryDto }): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const state = isKnownStatus(account.status) ? STATUS_BADGE_STATE[account.status] : 'neutral'
  const tokens = BADGE_TOKENS[state]
  return (
    <tr data-testid="pharmacy-account-row">
      <td>
        <Link to={`/admin/onboarding-queue/pharmacy-accounts/${account.id}`}>{account.name}</Link>
      </td>
      <td>{account.chainName ?? '—'}</td>
      <td>
        <span
          data-testid="pharmacy-account-status-badge"
          style={{ backgroundColor: tokens.bg, color: tokens.text, padding: BADGE_PADDING, borderRadius: BADGE_BORDER_RADIUS }}
        >
          {isKnownStatus(account.status) ? t(`admin.pharmacy_accounts.status.${account.status}`) : account.status}
        </span>
      </td>
      <td>{account.licenseExpiryDate ?? '—'}</td>
    </tr>
  )
}

function isKnownStatus(status: string): status is (typeof STATUS_VALUES)[number] {
  return (STATUS_VALUES as readonly string[]).includes(status)
}
