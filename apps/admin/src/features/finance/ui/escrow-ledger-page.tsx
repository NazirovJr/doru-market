// packages/ui пуст (тот же приём, что audit-log-page.tsx) — нативная таблица, поиск по orderId
// (единственный практический фильтр, платформенное расследование конкретного заказа).
import { useState, type ChangeEvent, type ReactElement, type SyntheticEvent } from 'react'
import { useT, toIntlLocale } from '@dorutj/i18n'
import type { FinanceEscrowLedgerEntryDto } from '@dorutj/contracts'
import { ADMIN_LOCALE } from '@/shared/config/locale'
import { useEscrowLedger } from '../api/use-finance-ledger'

const DIRAM_PER_SOMONI = 100
const SOMONI_FRACTION_DIGITS = 2

function formatSomoni(diram: number): string {
  return new Intl.NumberFormat(toIntlLocale(ADMIN_LOCALE), { maximumFractionDigits: SOMONI_FRACTION_DIGITS }).format(diram / DIRAM_PER_SOMONI)
}

export const EscrowLedgerPage = (): ReactElement => {
  const { t } = useT(ADMIN_LOCALE)
  const [orderIdDraft, setOrderIdDraft] = useState('')
  const [orderId, setOrderId] = useState<string | undefined>(undefined)
  const query = useEscrowLedger(orderId)

  function handleSearch(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault()
    setOrderId(orderIdDraft.trim() === '' ? undefined : orderIdDraft.trim())
  }

  return (
    <section data-testid="escrow-ledger-page">
      <h1>{t('admin.finance.escrow_ledger.title')}</h1>
      <form data-testid="escrow-ledger-search" onSubmit={handleSearch}>
        <label>
          {t('admin.finance.escrow_ledger.search_label')}
          <input value={orderIdDraft} onChange={(e: ChangeEvent<HTMLInputElement>) => { setOrderIdDraft(e.target.value) }} />
        </label>
        <button type="submit">{t('admin.finance.escrow_ledger.search_submit')}</button>
      </form>

      {orderId === undefined ? <p>{t('admin.finance.escrow_ledger.search_hint')}</p> : null}
      {query.isLoading ? <p role="status">{t('admin.finance.loading')}</p> : null}
      {query.error !== null ? <p role="alert">{t('admin.finance.error')}</p> : null}
      {orderId !== undefined ? <EscrowLedgerResults items={query.data ?? []} isLoading={query.isLoading} /> : null}
    </section>
  )
}

interface EscrowLedgerResultsProps {
  readonly items: readonly FinanceEscrowLedgerEntryDto[]
  readonly isLoading: boolean
}

const EscrowLedgerResults = ({ items, isLoading }: EscrowLedgerResultsProps): ReactElement => {
  const { t } = useT(ADMIN_LOCALE)
  if (!isLoading && items.length === 0) {
    return <p>{t('admin.finance.escrow_ledger.empty')}</p>
  }
  return (
    <table>
      <thead>
        <tr>
          <th>{t('admin.finance.escrow_ledger.column.entry_type')}</th>
          <th>{t('admin.finance.escrow_ledger.column.direction')}</th>
          <th>{t('admin.finance.escrow_ledger.column.amount')}</th>
          <th>{t('admin.finance.escrow_ledger.column.created_at')}</th>
          <th>{t('admin.finance.escrow_ledger.column.order')}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((entry, index) => (
          <EscrowLedgerRow key={index} entry={entry} />
        ))}
      </tbody>
    </table>
  )
}

const EscrowLedgerRow = ({ entry }: { readonly entry: FinanceEscrowLedgerEntryDto }): ReactElement => {
  const { t } = useT(ADMIN_LOCALE)
  return (
    <tr data-testid="escrow-ledger-row">
      <td>{t(`admin.finance.escrow_ledger.entry_type.${entry.entryType}`)}</td>
      <td>{t(`admin.finance.escrow_ledger.direction.${entry.direction}`)}</td>
      <td>{formatSomoni(entry.amountDiram)}</td>
      <td>{new Date(entry.createdAt).toLocaleString()}</td>
      {/* DTJ-355 добавит страницу заказа — до тех пор просто id, не ссылка в никуда. */}
      <td>{entry.orderId}</td>
    </tr>
  )
}
