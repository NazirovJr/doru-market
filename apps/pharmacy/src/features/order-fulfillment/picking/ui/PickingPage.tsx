import { useState, type ReactElement } from 'react'
import { useParams } from 'react-router'
import { useT } from '@dorutj/i18n'
import { useLocale } from '@/shared/config/locale-provider'
import { useOrderDetail } from '@/features/order-fulfillment/api/order-items.api'
import { areAllItemsResolved, isOrderCancelled } from '@/features/order-fulfillment/model/picking.model'
import { CountdownTimer } from './CountdownTimer'
import { ItemRow } from './ItemRow'
import { OrderCancelledDialog } from './OrderCancelledDialog'

export const PickingPage = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const { id: orderId } = useParams<{ id: string }>()
  const query = useOrderDetail(orderId ?? '')
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)

  if (orderId === undefined) {
    return <p role="alert" className="p-8 text-sm text-brand-danger">{t('pharmacy.picking.error')}</p>
  }

  if (query.isPending) {
    return <p className="p-8 text-sm text-ink-muted" data-testid="picking-loading">{t('pharmacy.picking.loading')}</p>
  }

  if (query.isError && query.data === undefined) {
    return <p role="alert" className="p-8 text-sm text-brand-danger" data-testid="picking-error">{t('pharmacy.picking.error')}</p>
  }

  // isPending/isError уже отфильтрованы выше — query.data здесь гарантированно определён.
  const order = query.data
  const cancelled = isOrderCancelled(order)

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-4 py-8" data-testid="picking-page">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink">{t('pharmacy.picking.page.title', { orderNumber: order.orderNumber })}</h1>
        <CountdownTimer deadlineAt={order.slaDeadlineAt} />
      </header>

      {areAllItemsResolved(order.items) ? (
        <p className="rounded-md bg-line px-3 py-2 text-sm text-ink" data-testid="picking-all-resolved">
          {t('pharmacy.picking.all_resolved')}
        </p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {order.items.map((item) => (
          <ItemRow
            key={item.id}
            order={order}
            item={item}
            isSelected={selectedItemId === item.id}
            onSelect={setSelectedItemId}
          />
        ))}
      </ul>

      {cancelled ? <OrderCancelledDialog /> : null}
    </section>
  )
}

export default PickingPage
