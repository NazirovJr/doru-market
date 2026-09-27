// «Заказы сети» (pharmacy_admin, scope=own) — обзорный список; клик ведёт на общую READ-ONLY карточку заказа.
import { useEffect, useState, type ChangeEvent, type ReactElement } from 'react'
import { Link } from 'react-router'
import { useT } from '@dorutj/i18n'
import { Badge, CursorTable, type CursorTableColumn } from '@dorutj/ui'
import type { OrderAdminSummaryDto } from '@dorutj/contracts'
import { ADMIN_LOCALE } from '@/shared/config/locale'
import { useOwnOrdersAdmin, useOwnOrdersAdminFilters } from '../api/use-orders-admin'
import { ORDER_STATUS_BADGE_TONE, ORDER_STATUS_VALUES } from './order-status.constants'

export const OwnOrdersPage = (): ReactElement => {
  const { t } = useT(ADMIN_LOCALE)
  const { filters, setStatus, setSlaBreached, resetFilters } = useOwnOrdersAdminFilters()
  const [cursor, setCursor] = useState<string | null>(null)
  const [items, setItems] = useState<readonly OrderAdminSummaryDto[]>([])

  const query = useOwnOrdersAdmin(filters, cursor)

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
    { key: 'pharmacy', header: t('admin.orders.column.pharmacy'), render: (order) => order.pharmacyId ?? '—' },
    {
      key: 'status',
      header: t('admin.orders.column.status'),
      render: (order) => <Badge tone={ORDER_STATUS_BADGE_TONE[order.status] ?? 'neutral'}>{statusLabel(t, order.status)}</Badge>,
    },
    {
      key: 'slaBreached',
      header: t('admin.orders.filter.sla_breached'),
      render: (order) => (order.slaBreached ? <Badge tone="danger">{t('admin.orders.sla_breached_badge')}</Badge> : null),
    },
  ]

  return (
    <section data-testid="own-orders-page">
      <h1>{t('admin.orders.own.title')}</h1>
      <form
        data-testid="own-orders-filters"
        onSubmit={(e) => {
          e.preventDefault()
        }}
      >
        <label>
          {t('admin.orders.filter.status')}
          <select
            value={filters.status ?? ''}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => { setStatus(e.target.value === '' ? undefined : e.target.value) }}
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
          <input
            type="checkbox"
            checked={filters.slaBreached === true}
            onChange={(e: ChangeEvent<HTMLInputElement>) => { setSlaBreached(e.target.checked) }}
          />
          {t('admin.orders.filter.sla_breached')}
        </label>
        <button type="button" onClick={resetFilters}>
          {t('admin.orders.filter.reset')}
        </button>
      </form>

      {query.error !== null ? <p role="alert">{t('admin.orders.error')}</p> : null}

      <CursorTable
        aria-label={t('admin.orders.own.title')}
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

function statusLabel(t: (key: string) => string, status: string): string {
  return (ORDER_STATUS_VALUES as readonly string[]).includes(status) ? t(`admin.orders.status.${status}`) : status
}
