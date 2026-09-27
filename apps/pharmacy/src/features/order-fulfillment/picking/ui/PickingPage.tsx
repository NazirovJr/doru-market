import { useEffect, useState, type Dispatch, type ReactElement, type SetStateAction } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useT } from '@dorutj/i18n'
import { CountdownTimer, PriceTag } from '@dorutj/ui'
import type { HandoverOtpDto, OrderDto } from '@dorutj/contracts'
import { useOrderDetail } from '@/features/order-fulfillment/api/order-items.api'
import { useCompletePicking } from '@/features/order-fulfillment/api/complete-picking.api'
import { areAllItemsResolved, isOrderCancelled, resolveCompletePickingBannerErrorMessage } from '@/features/order-fulfillment/model/picking.model'
import { HttpError } from '@/shared/api/http-client'
import {
  PARTIAL_FULFILLMENT_IDLE_STATE,
  canCompletePicking,
  canProposePartialFulfillment,
  resolvePartialFulfillmentUiState,
  type PartialFulfillmentUiState,
} from '@/features/order-fulfillment/partial-fulfillment/model/partial-fulfillment.model'
import { useProposePartialFulfillment } from '@/features/order-fulfillment/partial-fulfillment/api/propose-partial-fulfillment.api'
import { PartialFulfillmentBanner } from '@/features/order-fulfillment/partial-fulfillment/ui/PartialFulfillmentBanner'
import { HandoverOtpScreen, type HandoverOtpScreenProps } from '@/features/order-fulfillment/handover/ui/HandoverOtpScreen'
import { CompletePickingSection } from './CompletePickingSection'
import { ItemRow } from './ItemRow'
import { OrderCancelledDialog } from './OrderCancelledDialog'

// Единственный тир предупреждения (нет отдельного «warning», в отличие от 15-минутного handover-таймера) — 1:1 приём удалённого локального CountdownTimer (TODO(DTJ-400), снят этим тикетом).
const SLA_WARNING_THRESHOLD_SECONDS = 120
const SLA_DANGER_THRESHOLD_SECONDS = 0

/** WS DTJ-308 отсутствует — разрешение баннера частичной сборки уже существующим опросом `GET /orders/:id` (см. JSDoc `resolvePartialFulfillmentUiState`). Вынесено в хук — C1 (`complexity` `PickingPage`, порог 10). */
function usePartialFulfillmentUiState(
  order: Pick<OrderDto, 'status' | 'totalAmountDiram'> | undefined,
): readonly [PartialFulfillmentUiState, Dispatch<SetStateAction<PartialFulfillmentUiState>>] {
  const [state, setState] = useState<PartialFulfillmentUiState>(PARTIAL_FULFILLMENT_IDLE_STATE)
  useEffect(() => {
    if (order === undefined) return
    setState((previous) => resolvePartialFulfillmentUiState(previous, order))
  }, [order?.totalAmountDiram, order?.status])
  return [state, setState]
}

// «Что сделать» п.5/п.6 — сразу после успешного complete-picking ИЛИ при возврате на уже picked_up заказ.
function shouldShowHandoverScreen(order: Pick<OrderDto, 'status'>, completedOtp: HandoverOtpDto | null): boolean {
  return completedOtp !== null || order.status === 'picked_up'
}

// `initialOtp` — `exactOptionalPropertyTypes` не допускает явный `undefined`, свойство должно ЦЕЛИКОМ отсутствовать (тот же приём, что `note` в `ReportIssueModal`).
function buildHandoverOtpScreenProps(orderId: string, completedOtp: HandoverOtpDto | null, onNextOrder: () => void): HandoverOtpScreenProps {
  return completedOtp !== null ? { orderId, initialOtp: completedOtp, onNextOrder } : { orderId, onNextOrder }
}

function extractHttpErrorCode(error: unknown): string | null {
  return error instanceof HttpError ? error.code : null
}

function resolveProposeBannerErrorMessage(t: (key: string) => string, isError: boolean): string | null {
  return isError ? t('pharmacy.partial_fulfillment.propose_error') : null
}

// До `accept` заказ ещё не несёт `slaDeadlineAt` — терминал уже не показывает эту страницу без accept, но тип поля остаётся `string | null`. Отдельный компонент, не инлайн-тернарий в JSX — C1 (`complexity` `PickingPage`).
const SlaCountdown = ({ deadlineAt }: { readonly deadlineAt: string | null }): ReactElement | null => {
  if (deadlineAt === null) return null
  return (
    <CountdownTimer
      targetTimestamp={new Date(deadlineAt).getTime()}
      warningThresholdSeconds={SLA_WARNING_THRESHOLD_SECONDS}
      dangerThresholdSeconds={SLA_DANGER_THRESHOLD_SECONDS}
    />
  )
}

const AllItemsResolvedBanner = ({ items }: { readonly items: Parameters<typeof areAllItemsResolved>[0] }): ReactElement | null => {
  const { t } = useT('tj')
  if (!areAllItemsResolved(items)) return null
  return (
    <p className="rounded-md bg-line px-3 py-2 text-sm text-ink" data-testid="picking-all-resolved">
      {t('pharmacy.picking.all_resolved')}
    </p>
  )
}

export const PickingPage = (): ReactElement => {
  const { t } = useT('tj')
  const navigate = useNavigate()
  const { id: orderId } = useParams<{ id: string }>()
  const query = useOrderDetail(orderId ?? '')
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [partialFulfillmentUiState, setPartialFulfillmentUiState] = usePartialFulfillmentUiState(query.data)
  const [sealConfirmed, setSealConfirmed] = useState(false)
  const [completedOtp, setCompletedOtp] = useState<HandoverOtpDto | null>(null)
  const proposePartialFulfillment = useProposePartialFulfillment(orderId ?? '')
  const completePicking = useCompletePicking(orderId ?? '')

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

  if (shouldShowHandoverScreen(order, completedOtp)) {
    return <HandoverOtpScreen {...buildHandoverOtpScreenProps(order.id, completedOtp, () => { void navigate('/') })} />
  }

  function handlePropose(): void {
    proposePartialFulfillment.mutate(undefined, {
      onSuccess: () => { setPartialFulfillmentUiState({ kind: 'awaiting', totalBeforeDiram: order.totalAmountDiram }) },
    })
  }

  function handleCompletePicking(): void {
    completePicking.mutate(sealConfirmed, {
      onSuccess: (result) => { setCompletedOtp(result.handoverOtp) },
      onError: (error) => {
        // Гонка (SRS-PHT-026) — баннер ожидания вместо сырой ошибки, экран остаётся на списке позиций.
        if (error instanceof HttpError && error.code === 'PARTIAL_FULFILLMENT_PENDING') {
          setPartialFulfillmentUiState({ kind: 'awaiting', totalBeforeDiram: order.totalAmountDiram })
        }
      },
    })
  }

  const completePickingErrorMessage = resolveCompletePickingBannerErrorMessage(t, extractHttpErrorCode(completePicking.error))

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-4 py-8" data-testid="picking-page">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink">{t('pharmacy.picking.page.title', { orderNumber: order.orderNumber })}</h1>
        <SlaCountdown deadlineAt={order.slaDeadlineAt} />
      </header>

      <PriceTag amountDiram={order.totalAmountDiram} locale="tj" />

      <AllItemsResolvedBanner items={order.items} />

      <PartialFulfillmentBanner
        canPropose={canProposePartialFulfillment(order.items, partialFulfillmentUiState)}
        isAwaiting={partialFulfillmentUiState.kind === 'awaiting'}
        onPropose={handlePropose}
        isProposing={proposePartialFulfillment.isPending}
        proposeErrorMessage={resolveProposeBannerErrorMessage(t, proposePartialFulfillment.isError)}
      />

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

      <CompletePickingSection
        canComplete={canCompletePicking(order.items, partialFulfillmentUiState)}
        sealConfirmed={sealConfirmed}
        onSealConfirmedChange={setSealConfirmed}
        onComplete={handleCompletePicking}
        isCompleting={completePicking.isPending}
        errorMessage={completePickingErrorMessage}
      />

      {cancelled ? <OrderCancelledDialog /> : null}
    </section>
  )
}

export default PickingPage
