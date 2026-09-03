import type { ReactElement } from 'react'

/**
 * `empty-state.tsx` (DTJ-234) — временный локальный fallback `EmptyState` (`tickets/00-EPICS.md`
 * «Пересекающееся владение» п.6, SRS-UX-034): `packages/ui` ещё не несёт `EmptyState` (владелец —
 * EP-18, DTJ-406 «Toast, Modal/BottomSheet, EmptyState, ErrorState, ...», НЕ реализован на момент
 * этого тикета — `packages/ui/src/index.ts` пуст, проверено). Перенести в `packages/ui`, когда
 * DTJ-406 landing — сигнатура намеренно минимальна (message+CTA), чтобы перенос был
 * прямолинейным.
 *
 * Тап-зона CTA ≥48×48px (SRS-UX-002) — `min-h-12`, hit-slop через padding, не раздувание текста.
 */

export interface EmptyStateProps {
  readonly message: string
  readonly ctaLabel: string
  readonly onCtaClick: () => void
}

export const EmptyState = ({ message, ctaLabel, onCtaClick }: EmptyStateProps): ReactElement => (
  <div className="flex flex-col items-center gap-4 p-8 text-center" data-testid="cart-empty-state">
    <p role="status" className="text-sm text-ink-muted">
      {message}
    </p>
    <button
      type="button"
      data-testid="cart-empty-cta"
      onClick={onCtaClick}
      className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-md bg-brand-primary px-4 font-semibold text-white"
    >
      {ctaLabel}
    </button>
  </div>
)
