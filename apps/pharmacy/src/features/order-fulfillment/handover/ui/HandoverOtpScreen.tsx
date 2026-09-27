import { useEffect, useState, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { Button, CountdownTimer } from '@dorutj/ui'
import type { HandoverOtpDto } from '@dorutj/contracts'
import { HttpError } from '@/shared/api/http-client'
import { useHandoverOtp, useRegenerateHandoverOtp } from '@/features/order-fulfillment/handover/api/handover-otp.api'
import { isOtpExpired } from '@/features/order-fulfillment/handover/model/handover.model'

export interface HandoverOtpScreenProps {
  readonly orderId: string
  /** Ответ `complete-picking` уже несёт код — избегаем лишнего `GET` сразу после успеха («Что сделать» п.6). */
  readonly initialOtp?: HandoverOtpDto
  readonly onNextOrder: () => void
}

const TICK_MS = 1_000
// Порог оповещения — 60с до истечения 15-минутного TTL (`HANDOVER_OTP_TTL_SECONDS`, бэкенд); danger=0 — просрочка (см. `CountdownTimer` JSDoc, packages/ui).
const WARNING_THRESHOLD_SECONDS = 60
const DANGER_THRESHOLD_SECONDS = 0
const MONO_FONT_STACK = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace"

/** `HandoverOtpScreen` (DTJ-312, SRS-PHT-027/028/029) — крупный код вручения + обновление по истечении (НЕ автоматическое, риск тикета — регенерация тратит лимит). */
export const HandoverOtpScreen = ({ orderId, initialOtp, onNextOrder }: HandoverOtpScreenProps): ReactElement => {
  const { t } = useT('tj')
  const otpQuery = useHandoverOtp(orderId, initialOtp)
  const regenerate = useRegenerateHandoverOtp(orderId)
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const intervalId = setInterval(() => { setNowMs(Date.now()) }, TICK_MS)
    return () => { clearInterval(intervalId) }
  }, [])

  if (otpQuery.isPending) {
    return <p className="p-8 text-sm text-ink-muted" data-testid="handover-otp-loading">{t('pharmacy.handover.loading')}</p>
  }

  if (otpQuery.isError && otpQuery.data === undefined) {
    return <p role="alert" className="p-8 text-sm text-brand-danger" data-testid="handover-otp-error">{t('pharmacy.handover.error')}</p>
  }

  // isPending/isError уже отфильтрованы выше — otpQuery.data здесь гарантированно определён (см. picking.model.ts/PickingPage, тот же приём).
  const otp = otpQuery.data
  const expired = isOtpExpired(otp.expiresAt, nowMs)

  function handleRegenerate(): void {
    regenerate.mutate()
  }

  const regenerateErrorMessage =
    regenerate.error instanceof HttpError
      ? t(regenerate.error.code === 'RATE_LIMITED' ? 'pharmacy.handover.regenerate_rate_limited' : 'pharmacy.handover.regenerate_error')
      : null

  return (
    <section className="mx-auto flex w-full max-w-sm flex-col items-center gap-4 py-16 text-center" data-testid="handover-otp-screen">
      <h1 className="text-base font-semibold text-ink">{t('pharmacy.handover.title')}</h1>
      <p className="text-sm text-ink-muted">{t('pharmacy.handover.instructions')}</p>

      <span
        key={otp.code}
        data-testid="handover-otp-code"
        style={{
          fontFamily: MONO_FONT_STACK,
          fontVariantNumeric: 'tabular-nums',
          fontSize: 'var(--font-size-3xl)',
          fontWeight: 'var(--font-weight-bold)',
          letterSpacing: '0.2em',
          color: 'var(--brand-text)',
        }}
      >
        {otp.code}
      </span>

      <CountdownTimer
        key={otp.expiresAt}
        targetTimestamp={new Date(otp.expiresAt).getTime()}
        warningThresholdSeconds={WARNING_THRESHOLD_SECONDS}
        dangerThresholdSeconds={DANGER_THRESHOLD_SECONDS}
      />

      {expired ? (
        <Button variant="secondary" onClick={handleRegenerate} loading={regenerate.isPending} data-testid="handover-otp-regenerate-cta">
          {t('pharmacy.handover.regenerate_cta')}
        </Button>
      ) : null}

      {regenerateErrorMessage !== null ? (
        <p role="alert" className="text-xs text-brand-danger" data-testid="handover-otp-regenerate-error">
          {regenerateErrorMessage}
        </p>
      ) : null}

      <Button variant="primary" onClick={onNextOrder} data-testid="handover-otp-next-order-cta">
        {t('pharmacy.handover.next_order_cta')}
      </Button>
    </section>
  )
}
