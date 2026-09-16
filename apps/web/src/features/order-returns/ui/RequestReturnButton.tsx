/**
 * `RequestReturnButton` (DTJ-276, EP-11, «Что сделать» п.6) — точка входа `/orders/:id` →
 * `/order-returns/new` (`30-ux-screens-and-flows.md` строка 330). Видима СТРОГО когда
 * `orderStatus === 'delivered'` И `now() <= deliveredAt + disputeWindowHours` — оба значения
 * ПРИХОДЯТ ПРОПАМИ (сервер уже отдаёт `deliveredAt` в составе заказа; `disputeWindowHours` —
 * `tenant_settings.dispute_window_hours`, SRS-RET-012), НЕ пересчитывается по захардкоженному
 * числу (C6). Компонент намеренно НЕ завязан на конкретную форму `OrderDto`
 * (`packages/contracts/src/orders.ts` не несёт поля окна возврата на момент этого тикета) — берёт
 * ровно то, что ему нужно, точка встраивания решает, откуда взять оба значения.
 *
 * **SRS-RET-012 — по истечении окна кнопка СКРЫТА, не `disabled`.** Не провоцировать
 * бессмысленную попытку — сервер всё равно отклонит `422 RETURN_WINDOW_EXPIRED` (тикет,
 * буквально: «кнопка не должна провоцировать бессмысленную попытку»).
 *
 * **`/orders/:id` не существует в `apps/web` на момент этого тикета** (проверено — ни `pages/`,
 * ни маршрута в `app/router.tsx`) — тот же вывод, что DTJ-284 «Риски» для `ContactSupportButton`:
 * компонент готов к интеграции, когда экран заказа появится в другом эпике (`pages/order-detail`
 * компоновка, `02` §5 — не горизонтальный импорт из `features/order-returns` в чужую фичу),
 * протестирован напрямую на уровне компонента (АС1/АС3), не через реальный `/orders/:id`.
 */
import { useNavigate } from 'react-router'
import type { ReactElement } from 'react'
import type { OrderStatus } from '@dorutj/contracts'
import { useT } from '@dorutj/i18n'
import { useLocale } from '@/shared/config/locale-provider'

const MS_PER_HOUR = 3_600_000

export interface RequestReturnButtonProps {
  readonly orderId: string
  readonly orderStatus: OrderStatus
  readonly deliveredAt: string | null
  readonly disputeWindowHours: number | null
  /** Инъекция текущего времени — детерминированные тесты окна (АС1/АС3). По умолчанию `Date.now`. */
  readonly now?: () => number
}

function isWithinReturnWindow(deliveredAt: string | null, disputeWindowHours: number | null, nowMs: number): boolean {
  if (deliveredAt === null || disputeWindowHours === null) {
    return false
  }
  const deadline = new Date(deliveredAt).getTime() + disputeWindowHours * MS_PER_HOUR
  return nowMs <= deadline
}

export const RequestReturnButton = ({
  orderId,
  orderStatus,
  deliveredAt,
  disputeWindowHours,
  now = Date.now,
}: RequestReturnButtonProps): ReactElement | null => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const navigate = useNavigate()

  if (orderStatus !== 'delivered' || !isWithinReturnWindow(deliveredAt, disputeWindowHours, now())) {
    return null
  }

  return (
    <button
      type="button"
      data-testid="request-return-button"
      onClick={() => { void navigate(`/order-returns/new?orderId=${encodeURIComponent(orderId)}`) }}
      className="inline-flex min-h-12 items-center justify-center rounded-md border border-line px-4 font-semibold text-ink"
    >
      {t('customer.returns.button.request_return')}
    </button>
  )
}
