import type { ReactElement } from 'react'
import type { TranslateFunction } from '@dorutj/i18n'

/**
 * `success-screen.tsx` (DTJ-076, «Что сделать» §7) — экран подтверждения ПОСЛЕ обоих API-вызовов
 * (создание + перевод в `pending_review`) — единственный экран успеха на ОБА сценария (соло/сеть,
 * см. «Риски» тикета: «важно не дать двум API-вызовам просочиться в UX как два отдельных
 * действия»).
 *
 * SLA-формулировка и «что дальше» — нейтральные i18n-ключи, не привязанные к конкретному каналу
 * уведомления (канал уточняется по готовности EP-16, тикет п.7).
 */
export interface SuccessScreenProps {
  readonly applicationId: string
  readonly onHome: () => void
  readonly t: TranslateFunction
}

export const SuccessScreen = ({ applicationId, onHome, t }: SuccessScreenProps): ReactElement => (
  <section className="mx-auto flex max-w-md flex-col items-center gap-4 p-8 text-center" data-testid="pharmacy-application-success">
    <h1 className="text-lg font-bold text-ink">{t('onboarding.success.title')}</h1>
    <p className="text-sm text-ink-muted" data-testid="pharmacy-application-success-id">
      {t('onboarding.success.application_id', { id: applicationId })}
    </p>
    <p className="text-sm text-ink-muted">{t('onboarding.success.sla')}</p>
    <p className="text-sm text-ink-muted">{t('onboarding.success.next_steps')}</p>
    <button
      type="button"
      data-testid="pharmacy-application-success-home"
      onClick={onHome}
      className="inline-flex min-h-12 items-center justify-center rounded-md bg-brand-primary px-6 font-semibold text-white"
    >
      {t('onboarding.success.home_cta')}
    </button>
  </section>
)
