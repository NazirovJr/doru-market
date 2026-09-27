import { useEffect, useState, type ChangeEvent, type ReactElement } from 'react'
import { Link } from 'react-router'
import { useT, toIntlLocale } from '@dorutj/i18n'
import { PAYOUT_SCHEDULE_STATUS_VALUES, type FinancePayoutScheduleEntryDto } from '@dorutj/contracts'
import { useLocale } from '@/shared/config/locale-provider'
import { ADMIN_LOCALE } from '@/shared/config/locale'
import { usePayoutSchedule, type PayoutScheduleFilters } from '../api/use-finance-ledger'

const DIRAM_PER_SOMONI = 100
const SOMONI_FRACTION_DIGITS = 2

function formatSomoni(diram: number): string {
  return new Intl.NumberFormat(toIntlLocale(ADMIN_LOCALE), { maximumFractionDigits: SOMONI_FRACTION_DIGITS }).format(diram / DIRAM_PER_SOMONI)
}

const EMPTY_FILTERS: PayoutScheduleFilters = { status: undefined, pharmacyId: undefined }

export const PayoutSchedulePage = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const [filters, setFilters] = useState<PayoutScheduleFilters>(EMPTY_FILTERS)
  const [pharmacyIdDraft, setPharmacyIdDraft] = useState('')
  const [cursor, setCursor] = useState<string | null>(null)
  const [items, setItems] = useState<readonly FinancePayoutScheduleEntryDto[]>([])

  const query = usePayoutSchedule(filters, cursor)

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
    <section data-testid="payout-schedule-page">
      <h1>{t('admin.finance.payout_schedule.title')}</h1>
      <form
        data-testid="payout-schedule-filters"
        onSubmit={(e) => {
          e.preventDefault()
          setFilters((prev) => ({ ...prev, pharmacyId: pharmacyIdDraft.trim() === '' ? undefined : pharmacyIdDraft.trim() }))
        }}
      >
        <label>
          {t('admin.finance.payout_schedule.filter.status')}
          <select
            value={filters.status ?? ''}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => {
              setFilters((prev) => ({ ...prev, status: e.target.value === '' ? undefined : e.target.value }))
            }}
          >
            <option value="">{t('admin.finance.payout_schedule.filter.status_all')}</option>
            {PAYOUT_SCHEDULE_STATUS_VALUES.map((status) => (
              <option key={status} value={status}>
                {t(`admin.finance.payout_schedule.status.${status}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('admin.finance.payout_schedule.filter.pharmacy_id')}
          <input value={pharmacyIdDraft} onChange={(e: ChangeEvent<HTMLInputElement>) => { setPharmacyIdDraft(e.target.value) }} />
        </label>
        <button type="submit">{t('admin.finance.payout_schedule.filter.apply')}</button>
        <button
          type="button"
          onClick={() => {
            setPharmacyIdDraft('')
            setFilters(EMPTY_FILTERS)
          }}
        >
          {t('admin.finance.payout_schedule.filter.reset')}
        </button>
      </form>

      {query.isLoading ? <p role="status">{t('admin.finance.loading')}</p> : null}
      {query.error !== null ? <p role="alert">{t('admin.finance.error')}</p> : null}

      <table>
        <thead>
          <tr>
            <th>{t('admin.finance.payout_schedule.column.order')}</th>
            <th>{t('admin.finance.payout_schedule.column.pharmacy')}</th>
            <th>{t('admin.finance.payout_schedule.column.gross')}</th>
            <th>{t('admin.finance.payout_schedule.column.commission')}</th>
            <th>{t('admin.finance.payout_schedule.column.net')}</th>
            <th>{t('admin.finance.payout_schedule.column.status')}</th>
            <th>{t('admin.finance.payout_schedule.column.due_at')}</th>
            <th>{t('admin.finance.payout_schedule.column.paid_at')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.orderId} data-testid="payout-schedule-row">
              <td>
                <Link to={`/admin/orders/${row.orderId}`}>{row.orderNumber}</Link>
              </td>
              <td>{row.pharmacyId}</td>
              <td>{formatSomoni(row.grossAmountDiram)}</td>
              <td>{formatSomoni(row.commissionDiram)}</td>
              <td>{formatSomoni(row.netAmountDiram)}</td>
              <td>{t(`admin.finance.payout_schedule.status.${row.status}`)}</td>
              <td>{row.dueAt !== null ? new Date(row.dueAt).toLocaleDateString() : '—'}</td>
              <td>{row.paidAt !== null ? new Date(row.paidAt).toLocaleDateString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!query.isLoading && items.length === 0 ? <p>{t('admin.finance.payout_schedule.empty')}</p> : null}
      {query.data?.hasMore === true ? (
        <button type="button" onClick={loadMore}>
          {t('admin.finance.load_more')}
        </button>
      ) : null}
    </section>
  )
}
