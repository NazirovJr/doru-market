/**
 * `SlaBadge` (DTJ-283) — визуальный индикатор SLA первого ответа: зелёный (`ok`), жёлтый
 * (`warning`, < 15 минут до дедлайна), красный (`overdue`, соответствует эскалированному
 * `priority > 0` от `SupportSlaMonitorJob`, DTJ-280), нейтральный (`responded`).
 *
 * Цвета — ТОЛЬКО через CSS custom properties (`--color-status-*`, `index.html`) — `packages/ui`
 * ещё не несёт токенов (EP-18, DTJ-406, `packages/ui/src/index.ts` пуст, проверено) — тот же
 * приём, что временный `@theme`-блок `apps/web/src/app/styles.css` (DTJ-003). Вычисление
 * состояния — `model/sla-status.ts` (чистая функция, тестируется отдельно от рендера).
 */
import type { ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { ADMIN_LOCALE } from '@/shared/config/locale'
import { computeSlaState, type SlaState, type SlaTicketLike } from '../model/sla-status'

const STATE_TOKENS: Readonly<Record<SlaState, { readonly bg: string; readonly text: string }>> = {
  ok: { bg: 'var(--color-status-success-bg)', text: 'var(--color-status-success-text)' },
  warning: { bg: 'var(--color-status-warning-bg)', text: 'var(--color-status-warning-text)' },
  overdue: { bg: 'var(--color-status-danger-bg)', text: 'var(--color-status-danger-text)' },
  responded: { bg: 'var(--color-status-neutral-bg)', text: 'var(--color-status-neutral-text)' },
}

const BADGE_PADDING = '2px 8px'
const BADGE_BORDER_RADIUS = '4px'

export type SlaBadgeProps = SlaTicketLike

export const SlaBadge = ({ firstResponseDueAt, firstRespondedAt }: SlaBadgeProps): ReactElement => {
  const { t } = useT(ADMIN_LOCALE)
  const state = computeSlaState({ firstResponseDueAt, firstRespondedAt })
  const tokens = STATE_TOKENS[state]
  return (
    <span
      data-testid="sla-badge"
      data-sla-state={state}
      style={{ backgroundColor: tokens.bg, color: tokens.text, padding: BADGE_PADDING, borderRadius: BADGE_BORDER_RADIUS }}
    >
      {t(`admin.support.sla.${state}`)}
    </span>
  )
}
