// «Заказы» (super_admin) — кросс-тенантный поиск, фильтры на CursorTable/Badge из packages/ui.
import { useEffect, useState, type ChangeEvent, type ReactElement } from 'react'
import { Link } from 'react-router'
import { formatMoney, useT } from '@dorutj/i18n'
import { Badge, CursorTable, type CursorTableColumn, type BadgeTone } from '@dorutj/ui'
import type { OrderAdminSummaryDto } from '@dorutj/contracts'
import { useLocale } from '@/shared/config/locale-provider'
import { ADMIN_LOCALE } from '@/shared/config/locale'
import { useOrdersAdmin, useOrdersAdminFilters, type OrdersAdminFilters } from '../api/use-orders-admin'
import { ORDER_STATUS_BADGE_TONE, ORDER_STATUS_VALUES } from './order-status.constants'

export const OrdersListPage = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const { filters, setFilter, resetFilters } = useOrdersAdminFilters()
  const [orderNumberDraft, setOrderNumberDraft] = useState(filters.orderNumber ?? '')
  const [cursor, setCursor] = useState<string | null>(null)
  const [items, setItems] = useState<readonly OrderAdminSummaryDto[]>([])

  const query = useOrdersAdmin(filters, cursor)

  useEffect(() => {
    setCursor(null)
    setItems([])
  }, [filters])

  useEffect(() => {
    if (query.data === undefined) return
    setItems((prev) => (cursor === null ? query.data.items : [...prev, ...query.data.items]))
  }, [query.data])

  const columns: readonly CursorTableColumn<OrderAdminSummaryDto>[] = [
    {
      key: 'orderNumber',
      header: t('admin.orders.column.order_number'),
      render: (order) => <Link to={`/admin/orders/${order.id}`}>{order.orderNumber}</Link>,
    },
    {
      key: 'status',
      header: t('admin.orders.column.status'),
      render: (order) => <Badge tone={statusTone(order.status)}>{statusLabel(t, order.status)}</Badge>,
    },
    { key: 'tenant', header: t('admin.orders.column.tenant'), render: (order) => order.tenantId },
    { key: 'pharmacy', header: t('admin.orders.column.pharmacy'), render: (order) => order.pharmacyId ?? '—' },
    { key: 'amount', header: t('admin.orders.column.amount'), render: (order) => formatMoney(order.totalAmountDiram, ADMIN_LOCALE) },
    { key: 'createdAt', header: t('admin.orders.column.created_at'), render: (order) => new Date(order.createdAt).toLocaleDateString() },
  ]

  return (
    <section data-testid="orders-admin-page">
      <h1>{t('admin.orders.title')}</h1>
      <OrdersFiltersForm
        filters={filters}
        orderNumberDraft={orderNumberDraft}
        onOrderNumberDraftChange={setOrderNumberDraft}
        onSetFilter={setFilter}
        onReset={() => {
          setOrderNumberDraft('')
          resetFilters()
        }}
      />

      {query.error !== null ? <p role="alert">{t('admin.orders.error')}</p> : null}

      <CursorTable
        aria-label={t('admin.orders.title')}
        columns={columns}
        items={items}
        getItemKey={(order) => order.id}
        nextCursor={query.data?.nextCursor ?? null}
        isLoading={query.isLoading}
        onLoadMore={() => {
          if (query.data?.nextCursor != null) setCursor(query.data.nextCursor)
        }}
        loadMoreLabel={t('admin.orders.load_more')}
        emptyState={!query.isLoading ? <p>{t('admin.orders.empty')}</p> : undefined}
      />
    </section>
  )
}

interface OrdersFiltersFormProps {
  readonly filters: OrdersAdminFilters
  readonly orderNumberDraft: string
  readonly onOrderNumberDraftChange: (value: string) => void
  readonly onSetFilter: (key: keyof OrdersAdminFilters, value: string | undefined) => void
  readonly onReset: () => void
}

const OrdersFiltersForm = ({ filters, orderNumberDraft, onOrderNumberDraftChange, onSetFilter, onReset }: OrdersFiltersFormProps): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  return (
    <form
      data-testid="orders-admin-filters"
      onSubmit={(e) => {
        e.preventDefault()
        onSetFilter('orderNumber', orderNumberDraft.trim() === '' ? undefined : orderNumberDraft.trim())
      }}
    >
      <label>
        {t('admin.orders.filter.order_number')}
        <input value={orderNumberDraft} onChange={(e: ChangeEvent<HTMLInputElement>) => { onOrderNumberDraftChange(e.target.value) }} />
      </label>
      <label>
        {t('admin.orders.filter.status')}
        <select
          value={filters.status ?? ''}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => { onSetFilter('status', e.target.value === '' ? undefined : e.target.value) }}
        >
          <option value="">{t('admin.orders.filter.status_all')}</option>
          {ORDER_STATUS_VALUES.map((status) => (
            <option key={status} value={status}>
              {t(`admin.orders.status.${status}`)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('admin.orders.filter.tenant_id')}
        <input
          value={filters.tenantId ?? ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) => { onSetFilter('tenantId', e.target.value.trim() === '' ? undefined : e.target.value.trim()) }}
        />
      </label>
      <label>
        {t('admin.orders.filter.pharmacy_id')}
        <input
          value={filters.pharmacyId ?? ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) => { onSetFilter('pharmacyId', e.target.value.trim() === '' ? undefined : e.target.value.trim()) }}
        />
      </label>
      <label>
        {t('admin.orders.filter.created_from')}
        <input
          type="date"
          value={filters.createdFrom ?? ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) => { onSetFilter('createdFrom', e.target.value === '' ? undefined : e.target.value) }}
        />
      </label>
      <label>
        {t('admin.orders.filter.created_to')}
        <input
          type="date"
          value={filters.createdTo ?? ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) => { onSetFilter('createdTo', e.target.value === '' ? undefined : e.target.value) }}
        />
      </label>
      <button type="submit">{t('admin.orders.filter.apply')}</button>
      <button type="button" onClick={onReset}>
        {t('admin.orders.filter.reset')}
      </button>
    </form>
  )
}

function statusTone(status: string): BadgeTone {
  return ORDER_STATUS_BADGE_TONE[status] ?? 'neutral'
}

function statusLabel(t: (key: string) => string, status: string): string {
  return (ORDER_STATUS_VALUES as readonly string[]).includes(status) ? t(`admin.orders.status.${status}`) : status
}
