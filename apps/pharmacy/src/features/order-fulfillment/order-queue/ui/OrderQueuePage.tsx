import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { useLocale } from '@/shared/config/locale-provider'
import type { PharmacyTerminalQueueItemDto } from '@dorutj/contracts'
import { useAuthStore } from '@/shared/api/auth-store'
import { useAcceptOrder, useOrderQueue, type OrderQueueItems } from '@/features/order-fulfillment/api/orders-queue.api'
import { findNewlyArrivedOrderIds, shouldShowOfflineBanner, splitQueueSections } from '@/features/order-fulfillment/model/order-queue.model'
import { OrderCard } from './OrderCard'
import { NewOrderBanner } from './NewOrderBanner'
import { OfflineBanner } from './OfflineBanner'
import { SoundAlert, type SoundAlertHandle } from './SoundAlert'

export const OrderQueuePage = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const currentUserId = useAuthStore((state) => state.user?.id ?? null)
  const query = useOrderQueue()
  const acceptOrder = useAcceptOrder(currentUserId ?? '')
  const soundAlertRef = useRef<SoundAlertHandle>(null)
  const previousItemsRef = useRef<OrderQueueItems>([])
  const [bannerOrderNumber, setBannerOrderNumber] = useState<string | null>(null)

  useEffect(() => {
    if (query.data === undefined) return
    const newlyArrivedIds = findNewlyArrivedOrderIds(previousItemsRef.current, query.data)
    if (newlyArrivedIds.length > 0) {
      const firstNewItem = query.data.find((item) => item.id === newlyArrivedIds[0])
      soundAlertRef.current?.notifyNewOrder()
      if (firstNewItem !== undefined) setBannerOrderNumber(firstNewItem.orderNumber)
    }
    previousItemsRef.current = query.data
  }, [query.data])

  const sections = splitQueueSections(query.data ?? [])

  function handleAccept(orderId: string): void {
    acceptOrder.mutate({ orderId, idempotencyKey: crypto.randomUUID() })
  }

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-4 py-8" data-testid="order-queue-page">
      <header>
        <h1 className="text-lg font-semibold text-ink">{t('pharmacy.order_queue.page.title')}</h1>
      </header>

      <SoundAlert ref={soundAlertRef} />
      <NewOrderBanner orderNumber={bannerOrderNumber} onDismiss={() => { setBannerOrderNumber(null) }} />
      <OfflineBanner visible={shouldShowOfflineBanner(query.failureCount)} />

      {query.isPending ? (
        <p className="text-sm text-ink-muted" data-testid="order-queue-loading">{t('pharmacy.order_queue.loading')}</p>
      ) : query.isError && query.data === undefined ? (
        <p role="alert" className="text-sm text-brand-danger" data-testid="order-queue-error">{t('pharmacy.order_queue.error')}</p>
      ) : (
        <>
          <QueueSection
            titleKey="pharmacy.order_queue.section.new"
            emptyKey="pharmacy.order_queue.section.new_empty"
            items={sections.newOrders}
            currentUserId={currentUserId ?? ''}
            onAccept={handleAccept}
            isAccepting={acceptOrder.isPending}
          />
          <QueueSection
            titleKey="pharmacy.order_queue.section.processing"
            emptyKey="pharmacy.order_queue.section.processing_empty"
            items={sections.processing}
            currentUserId={currentUserId ?? ''}
            onAccept={handleAccept}
            isAccepting={acceptOrder.isPending}
          />
        </>
      )}
    </section>
  )
}

interface QueueSectionProps {
  readonly titleKey: string
  readonly emptyKey: string
  readonly items: readonly PharmacyTerminalQueueItemDto[]
  readonly currentUserId: string
  readonly onAccept: (orderId: string) => void
  readonly isAccepting: boolean
}

const QueueSection = ({ titleKey, emptyKey, items, currentUserId, onAccept, isAccepting }: QueueSectionProps): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  return (
    <div className="flex flex-col gap-3" data-testid="order-queue-section">
      <h2 className="text-sm font-semibold text-ink-muted">{t(titleKey, { count: items.length })}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">{t(emptyKey)}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <OrderCard key={item.id} item={item} currentUserId={currentUserId} onAccept={onAccept} isAccepting={isAccepting} />
          ))}
        </ul>
      )}
    </div>
  )
}

export default OrderQueuePage
