// Общий READ-ONLY экран super_admin (полный доступ) и pharmacy_admin (своя сеть) — секция действий условно НЕ монтируется, не CSS-скрытие.
import { type ReactElement } from 'react'
import { useParams } from 'react-router'
import { formatMoney, useT } from '@dorutj/i18n'
import { Badge, OrderTimeline, type OrderTimelineStep } from '@dorutj/ui'
import type { OrderAdminEscrowLedgerEntryDto, OrderDetailAdminDto } from '@dorutj/contracts'
import { useLocale } from '@/shared/config/locale-provider'
import { ADMIN_LOCALE } from '@/shared/config/locale'
import { getCurrentRole } from '@/shared/auth/current-role'
import { useOrderDetailAdmin } from '../api/use-orders-admin'
import { ORDER_STATUS_BADGE_TONE } from './order-status.constants'

function formatSomoni(diram: number): string {
  return formatMoney(diram, ADMIN_LOCALE)
}

export const OrderDetailPage = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const { id } = useParams<{ id: string }>()
  const query = useOrderDetailAdmin(id ?? null)
  const role = getCurrentRole()

  return (
    <section data-testid="order-detail-page">
      <h1>{t('admin.order_detail.title')}</h1>
      {query.isLoading ? <p role="status">{t('admin.order_detail.loading')}</p> : null}
      {query.error !== null ? <p role="alert">{t('admin.order_detail.error')}</p> : null}
      {query.data !== undefined ? (
        <>
          <OrderSummarySection order={query.data} />
          <TimelineSection order={query.data} />
          <EscrowSection order={query.data} />
          <PayoutSection order={query.data} />
          <PrescriptionSection order={query.data} />
          {/* DTJ-356 — payment-override/force-cancel, ТОЛЬКО super_admin. Компонент не монтируется вовсе для остальных ролей (не CSS-скрытие). */}
          {role === 'super_admin' ? <OrderAdminActionsPlaceholder /> : null}
        </>
      ) : null}
    </section>
  )
}

const OrderSummarySection = ({ order }: { readonly order: OrderDetailAdminDto }): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  return (
    <dl data-testid="order-detail-summary">
      <dt>{t('admin.order_detail.field.order_number')}</dt>
      <dd>{order.orderNumber}</dd>
      <dt>{t('admin.order_detail.field.status')}</dt>
      <dd>
        <Badge tone={ORDER_STATUS_BADGE_TONE[order.status] ?? 'neutral'}>{t(`admin.orders.status.${order.status}`)}</Badge>
      </dd>
      <dt>{t('admin.order_detail.field.tenant')}</dt>
      <dd>{order.tenantId}</dd>
      <dt>{t('admin.order_detail.field.pharmacy')}</dt>
      <dd>{order.pharmacyId}</dd>
      <dt>{t('admin.order_detail.field.customer')}</dt>
      <dd>{order.customerId}</dd>
      <dt>{t('admin.order_detail.field.payment_method')}</dt>
      <dd>{t(`admin.order_detail.payment_method.${order.paymentMethod}`)}</dd>
      <dt>{t('admin.order_detail.field.total_amount')}</dt>
      <dd>{formatSomoni(order.totalAmountDiram)}</dd>
    </dl>
  )
}

const TimelineSection = ({ order }: { readonly order: OrderDetailAdminDto }): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const steps: readonly OrderTimelineStep[] = [
    {
      status: 'created',
      label: t('admin.order_detail.timeline.created'),
      timestamp: new Date(order.timeline.createdAt),
      isCompleted: true,
      isCurrent: order.timeline.processingStartedAt === null,
    },
    {
      status: 'processing_started',
      label: t('admin.order_detail.timeline.processing_started'),
      timestamp: order.timeline.processingStartedAt === null ? null : new Date(order.timeline.processingStartedAt),
      isCompleted: order.timeline.processingStartedAt !== null,
      isCurrent: order.status === 'processing',
    },
    {
      status: 'picked_up',
      label: t('admin.order_detail.timeline.picked_up'),
      timestamp: order.timeline.pickedUpAt === null ? null : new Date(order.timeline.pickedUpAt),
      isCompleted: order.timeline.pickedUpAt !== null,
      isCurrent: order.status === 'picked_up',
    },
    {
      status: 'delivered',
      label: t('admin.order_detail.timeline.delivered'),
      timestamp: order.timeline.deliveredAt === null ? null : new Date(order.timeline.deliveredAt),
      isCompleted: order.timeline.deliveredAt !== null,
      isCurrent: order.status === 'delivered',
    },
  ]
  return (
    <section data-testid="order-detail-timeline">
      <h2>{t('admin.order_detail.section.timeline')}</h2>
      <OrderTimeline steps={steps} />
    </section>
  )
}

const EscrowSection = ({ order }: { readonly order: OrderDetailAdminDto }): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  return (
    <section data-testid="order-detail-escrow">
      <h2>{t('admin.order_detail.section.escrow')}</h2>
      {order.escrowLedger === null ? (
        <p data-testid="order-detail-escrow-not-applicable">{t('admin.order_detail.escrow.not_applicable')}</p>
      ) : order.escrowLedger.length === 0 ? (
        <p>{t('admin.order_detail.escrow.empty')}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t('admin.order_detail.column.entry_type')}</th>
              <th>{t('admin.order_detail.column.direction')}</th>
              <th>{t('admin.order_detail.column.amount')}</th>
              <th>{t('admin.order_detail.column.created_at')}</th>
            </tr>
          </thead>
          <tbody>
            {order.escrowLedger.map((entry, index) => (
              <EscrowRow key={index} entry={entry} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

const EscrowRow = ({ entry }: { readonly entry: OrderAdminEscrowLedgerEntryDto }): ReactElement => (
  <tr data-testid="order-detail-escrow-row">
    <td>{entry.entryType}</td>
    <td>{entry.direction}</td>
    <td>{formatSomoni(entry.amountDiram)}</td>
    <td>{new Date(entry.createdAt).toLocaleString()}</td>
  </tr>
)

const PayoutSection = ({ order }: { readonly order: OrderDetailAdminDto }): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const payout = order.payoutSchedule
  return (
    <section data-testid="order-detail-payout">
      <h2>{t('admin.order_detail.section.payout')}</h2>
      {payout === null ? (
        <p>{t('admin.order_detail.payout.none')}</p>
      ) : (
        <dl>
          <dt>{t('admin.order_detail.payout.field.gross')}</dt>
          <dd>{formatSomoni(payout.grossAmountDiram)}</dd>
          <dt>{t('admin.order_detail.payout.field.commission')}</dt>
          <dd>{formatSomoni(payout.commissionDiram)}</dd>
          <dt>{t('admin.order_detail.payout.field.net')}</dt>
          <dd>{formatSomoni(payout.netAmountDiram)}</dd>
          <dt>{t('admin.order_detail.payout.field.status')}</dt>
          <dd>{payout.status}</dd>
        </dl>
      )}
    </section>
  )
}

const PrescriptionSection = ({ order }: { readonly order: OrderDetailAdminDto }): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const meta = order.prescriptionMeta
  return (
    <section data-testid="order-detail-prescription">
      <h2>{t('admin.order_detail.section.prescription')}</h2>
      {meta === null ? (
        <p>{t('admin.order_detail.prescription.none')}</p>
      ) : (
        <>
          <p>{t('admin.order_detail.prescription.status_label', { status: meta.status })}</p>
          {/* TODO(DTJ-376): подключить обработчик показа изображения рецепта (SRS-DOM-155в — отдельный клик с явной причиной/аудитом). Кнопка физически неактивна до готовности того тикета. */}
          <button type="button" disabled data-testid="order-detail-prescription-show-image">
            {t('admin.order_detail.prescription.show_image')}
          </button>
        </>
      )}
    </section>
  )
}

// TODO(DTJ-356): payment-override/force-cancel как кнопки действий над заказом.
const OrderAdminActionsPlaceholder = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  return (
    <section data-testid="order-detail-actions-placeholder">
      <p>{t('admin.order_detail.actions.placeholder')}</p>
    </section>
  )
}
