/**
 * `ReturnStatusTimeline` (DTJ-276, EP-11, «Что сделать» п.5) — визуальный таймлайн статусов
 * возврата, аналог `OrderTimeline` (`32-design-reference.md` «Инвентарь компонентов»). Ни один
 * эпик ещё не реализовал `OrderTimeline`/`entities/` на момент этого тикета (`Glob` по
 * `apps/web/src/entities/**` — пусто, проверено) — переиспользовать было нечего, реализация с нуля.
 *
 * **Последовательность R1** — `return_requested → return_in_transit → return_confirmed`
 * (`order-return.state-machine.ts`, DTJ-271). `returned_to_pharmacy` в enum'е есть, но НИ ОДИН
 * переход R1 в него не ведёт (D-EP11-4) — в шкале прогресса не участвует, трактуется как «после
 * return_in_transit», если всё же встретится.
 *
 * **АС4 тикета: `return_rejected` НЕ помечается «завершено».** `return_rejected` НЕ терминален
 * (SRS-DOM-056 — `admin_override`/`retryTransit` ещё могут изменить исход из НЕГО) — рисуется
 * ОТДЕЛЬНОЙ строкой `--brand-danger` вместо заполнения финального шага `return_confirmed`
 * (`--brand-primary`), которым помечен ТОЛЬКО настоящий терминальный `return_confirmed`.
 */
import type { ReactElement } from 'react'
import type { OrderReturnDto, ReturnStatus } from '@dorutj/contracts'
import { useT, type TranslateFunction } from '@dorutj/i18n'
import { useLocale } from '@/shared/config/locale-provider'

const MAIN_STEPS: readonly ReturnStatus[] = ['return_requested', 'return_in_transit', 'return_confirmed']

function isRejected(status: ReturnStatus): boolean {
  return status === 'return_rejected'
}

/** Индекс ПОСЛЕДНЕГО пройденного шага шкалы `MAIN_STEPS` для данного статуса. */
function currentStepIndex(status: ReturnStatus): number {
  if (isRejected(status)) {
    // Отклонение достижимо только ИЗ return_in_transit (state-machine) — оба первых шага пройдены.
    return MAIN_STEPS.indexOf('return_in_transit')
  }
  const index = MAIN_STEPS.indexOf(status)
  // `returned_to_pharmacy` недостижим в R1 (D-EP11-4), но тип это допускает.
  return index === -1 ? MAIN_STEPS.indexOf('return_in_transit') : index
}

interface StepRowProps {
  readonly label: string
  readonly isDone: boolean
  readonly isCurrent: boolean
}

const StepRow = ({ label, isDone, isCurrent }: StepRowProps): ReactElement => (
  <li
    data-testid="return-timeline-step"
    data-done={isDone}
    className={`flex items-center gap-2 text-sm ${isDone ? 'text-ink' : 'text-ink-muted'} ${isCurrent ? 'font-semibold' : ''}`}
  >
    <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${isDone ? 'bg-brand-primary' : 'border border-line'}`} />
    {label}
  </li>
)

const RejectedRow = ({ t }: { readonly t: TranslateFunction }): ReactElement => (
  <li data-testid="return-timeline-rejected" className="flex items-center gap-2 text-sm font-semibold text-brand-danger">
    <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-brand-danger" />
    {t('customer.returns.status.return_rejected')}
  </li>
)

export interface ReturnStatusTimelineProps {
  readonly orderReturn: Pick<OrderReturnDto, 'status'>
}

export const ReturnStatusTimeline = ({ orderReturn }: ReturnStatusTimelineProps): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const { status } = orderReturn
  const rejected = isRejected(status)
  const stepsToRender = rejected ? MAIN_STEPS.slice(0, -1) : MAIN_STEPS
  const currentIndex = currentStepIndex(status)

  return (
    <ol className="flex flex-col gap-2" data-testid="return-status-timeline">
      {stepsToRender.map((step, index) => (
        <StepRow
          key={step}
          label={t(`customer.returns.status.${step}`)}
          isDone={index <= currentIndex}
          isCurrent={!rejected && index === currentIndex}
        />
      ))}
      {rejected ? <RejectedRow t={t} /> : null}
    </ol>
  )
}
