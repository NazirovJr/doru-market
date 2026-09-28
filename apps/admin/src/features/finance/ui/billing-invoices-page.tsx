// "Снять блокировку" показан только при status='overdue' — эвристика, экран не несёт отдельно pharmacy_chains.status.
import { useEffect, useState, type ChangeEvent, type ReactElement } from 'react'
import { useT, toIntlLocale } from '@dorutj/i18n'
import { BILLING_INVOICE_STATUS_VALUES, DEFAULT_BILLING_INVOICE_TYPE_FILTER, type BillingInvoiceDto } from '@dorutj/contracts'
import { Badge, Button, Input, Modal } from '@dorutj/ui'
import { useLocale } from '@/shared/config/locale-provider'
import { ADMIN_LOCALE } from '@/shared/config/locale'
import { useBillingInvoices, useLiftInvoiceBlock, useMarkInvoicePaid, type BillingInvoicesFilters } from '../api/use-billing-invoices'

const DIRAM_PER_SOMONI = 100
const SOMONI_FRACTION_DIGITS = 2
const LIFT_BLOCK_ELIGIBLE_STATUS = 'overdue'
const PAYABLE_STATUSES = new Set(['issued', 'overdue'])

function formatSomoni(diram: number): string {
  return new Intl.NumberFormat(toIntlLocale(ADMIN_LOCALE), { maximumFractionDigits: SOMONI_FRACTION_DIGITS }).format(diram / DIRAM_PER_SOMONI)
}

function statusTone(status: string): 'success' | 'danger' | 'warning' | 'neutral' {
  if (status === 'paid') return 'success'
  if (status === 'overdue') return 'danger'
  if (status === 'issued') return 'warning'
  return 'neutral'
}

const EMPTY_FILTERS: BillingInvoicesFilters = { chainId: undefined, invoiceType: DEFAULT_BILLING_INVOICE_TYPE_FILTER, status: undefined }

export const BillingInvoicesPage = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const [filters, setFilters] = useState<BillingInvoicesFilters>(EMPTY_FILTERS)
  const [chainIdDraft, setChainIdDraft] = useState('')
  const [cursor, setCursor] = useState<string | null>(null)
  const [items, setItems] = useState<readonly BillingInvoiceDto[]>([])
  const [liftBlockInvoiceId, setLiftBlockInvoiceId] = useState<string | null>(null)

  const query = useBillingInvoices(filters, cursor)

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
    <section data-testid="billing-invoices-page">
      <h1>{t('admin.finance.billing_invoices.title')}</h1>
      <form
        data-testid="billing-invoices-filters"
        onSubmit={(e) => {
          e.preventDefault()
          setFilters((prev) => ({ ...prev, chainId: chainIdDraft.trim() === '' ? undefined : chainIdDraft.trim() }))
        }}
      >
        <label>
          {t('admin.finance.billing_invoices.filter.chain_id')}
          <input value={chainIdDraft} onChange={(e: ChangeEvent<HTMLInputElement>) => { setChainIdDraft(e.target.value) }} />
        </label>
        <label>
          {t('admin.finance.billing_invoices.filter.status')}
          <select
            value={filters.status ?? ''}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => {
              setFilters((prev) => ({ ...prev, status: e.target.value === '' ? undefined : e.target.value }))
            }}
          >
            <option value="">{t('admin.finance.billing_invoices.filter.status_all')}</option>
            {BILLING_INVOICE_STATUS_VALUES.map((status) => (
              <option key={status} value={status}>
                {t(`admin.finance.billing_invoices.status.${status}`)}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="primary">{t('admin.finance.billing_invoices.filter.apply')}</Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setChainIdDraft('')
            setFilters(EMPTY_FILTERS)
          }}
        >
          {t('admin.finance.billing_invoices.filter.reset')}
        </Button>
      </form>

      {query.isLoading ? <p role="status">{t('admin.finance.loading')}</p> : null}
      {query.error !== null ? <p role="alert">{t('admin.finance.error')}</p> : null}

      <table>
        <thead>
          <tr>
            <th>{t('admin.finance.billing_invoices.column.chain')}</th>
            <th>{t('admin.finance.billing_invoices.column.period')}</th>
            <th>{t('admin.finance.billing_invoices.column.total')}</th>
            <th>{t('admin.finance.billing_invoices.column.status')}</th>
            <th>{t('admin.finance.billing_invoices.column.due_at')}</th>
            <th>{t('admin.finance.billing_invoices.column.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <InvoiceRow key={item.id} item={item} onLiftBlock={() => { setLiftBlockInvoiceId(item.id) }} />
          ))}
        </tbody>
      </table>
      {!query.isLoading && items.length === 0 ? <p>{t('admin.finance.billing_invoices.empty')}</p> : null}
      {query.data?.hasMore === true ? (
        <button type="button" onClick={loadMore}>
          {t('admin.finance.load_more')}
        </button>
      ) : null}

      <LiftInvoiceBlockModal invoiceId={liftBlockInvoiceId} onClose={() => { setLiftBlockInvoiceId(null) }} />
    </section>
  )
}

interface InvoiceRowProps {
  readonly item: BillingInvoiceDto
  readonly onLiftBlock: () => void
}

const InvoiceRow = ({ item, onLiftBlock }: InvoiceRowProps): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const markPaidMutation = useMarkInvoicePaid()

  return (
    <>
      <tr data-testid="billing-invoice-row">
        <td>{item.chainName ?? item.chainId}</td>
        <td>
          {new Date(item.periodStart).toLocaleDateString()} — {new Date(item.periodEnd).toLocaleDateString()}
        </td>
        <td>{formatSomoni(item.totalDiram)}</td>
        <td>
          <Badge tone={statusTone(item.status)}>{t(`admin.finance.billing_invoices.status.${item.status}`)}</Badge>
        </td>
        <td>{item.dueAt !== null ? new Date(item.dueAt).toLocaleDateString() : '—'}</td>
        <td>
          {PAYABLE_STATUSES.has(item.status) ? (
            <Button
              variant="primary"
              disabled={markPaidMutation.isPending}
              onClick={() => { markPaidMutation.mutate(item.id) }}
            >
              {t('admin.finance.billing_invoices.action.mark_paid')}
            </Button>
          ) : null}
          {item.status === LIFT_BLOCK_ELIGIBLE_STATUS ? (
            <Button variant="secondary" onClick={onLiftBlock}>
              {t('admin.finance.billing_invoices.action.lift_block')}
            </Button>
          ) : null}
        </td>
      </tr>
      {markPaidMutation.isError ? (
        <tr>
          <td colSpan={6}>
            <p role="alert">
              {markPaidMutation.error.code === 'CONFLICT'
                ? t('admin.finance.billing_invoices.mark_paid.conflict')
                : t('admin.finance.billing_invoices.mark_paid.error')}
            </p>
          </td>
        </tr>
      ) : null}
    </>
  )
}

interface LiftInvoiceBlockModalProps {
  readonly invoiceId: string | null
  readonly onClose: () => void
}

const LIFT_BLOCK_REASON_MIN_LENGTH = 10

const LiftInvoiceBlockModal = ({ invoiceId, onClose }: LiftInvoiceBlockModalProps): ReactElement | null => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const [reason, setReason] = useState('')
  const liftBlockMutation = useLiftInvoiceBlock()

  useEffect(() => {
    setReason('')
  }, [invoiceId])

  if (invoiceId === null) {
    return null
  }

  return (
    <Modal isOpen title={t('admin.finance.billing_invoices.lift_block.title')} closeButtonLabel={t('common.close')} onClose={onClose}>
      <Input
        label={t('admin.finance.billing_invoices.lift_block.reason_label')}
        value={reason}
        onChange={(e) => { setReason(e.target.value) }}
      />
      <Button
        variant="primary"
        disabled={reason.trim().length < LIFT_BLOCK_REASON_MIN_LENGTH || liftBlockMutation.isPending}
        onClick={() => {
          liftBlockMutation.mutate({ invoiceId, reason: reason.trim() }, { onSuccess: onClose })
        }}
      >
        {t('admin.finance.billing_invoices.lift_block.confirm')}
      </Button>
      {liftBlockMutation.isError ? <p role="alert">{t('admin.finance.billing_invoices.lift_block.error')}</p> : null}
    </Modal>
  )
}
