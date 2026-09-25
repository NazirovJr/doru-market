import { useEffect, useState, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { computeRemainingSeconds, formatRemainingClock, isSlaNearingBreach } from '@/features/order-fulfillment/model/picking.model'

// TODO(DTJ-400): перенести в packages/ui, когда там появится готовый CountdownTimer.
export interface CountdownTimerProps {
  readonly deadlineAt: string | null
}

const TICK_MS = 1_000

export const CountdownTimer = ({ deadlineAt }: CountdownTimerProps): ReactElement | null => {
  const { t } = useT('tj')
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (deadlineAt === null) return
    const id = setInterval(() => { setNowMs(Date.now()) }, TICK_MS)
    return () => { clearInterval(id) }
  }, [deadlineAt])

  if (deadlineAt === null) return null

  const remainingSeconds = computeRemainingSeconds(deadlineAt, nowMs) ?? 0
  const nearingBreach = isSlaNearingBreach(remainingSeconds)

  return (
    <p
      data-testid="picking-sla-timer"
      data-nearing-breach={nearingBreach}
      className={`text-lg font-semibold ${nearingBreach ? 'text-brand-danger' : 'text-ink'}`}
    >
      {t('pharmacy.picking.sla.remaining', { time: formatRemainingClock(remainingSeconds) })}
    </p>
  )
}
