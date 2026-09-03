import type { ReactElement } from 'react'

/**
 * `analog-card-skeleton.tsx` (DTJ-104).
 *
 * `packages/ui` не содержит `Skeleton` на момент реализации (`packages/ui/src/index.ts` —
 * пустая заглушка манифеста EP-18). Тикет DTJ-104 («Риски и подводные камни») ЯВНО разрешает в
 * этой ситуации временный локальный компонент в `features/analogs/ui/` вместо блокировки тикета
 * ожиданием EP-18. Форма повторяет `AnalogCard` (`docs/spec/32-design-reference.md` строка 147 —
 * «форма скелетона повторяет форму реального контента», не общий спиннер).
 *
 * TODO(EP-18): заменить на `Skeleton` из `packages/ui`, когда компонент будет готов — тот же
 * приём временного маркера, что `app/layout.tsx` (`BRAND_PLACEHOLDER`/`LanguageSwitcherPlaceholder`).
 */
export const AnalogCardSkeleton = (): ReactElement => (
  <div
    data-testid="analog-card-skeleton"
    aria-hidden="true"
    className="animate-pulse rounded-md border border-line bg-surface p-3"
  >
    <div className="flex items-start justify-between gap-2">
      <div className="flex flex-1 flex-col gap-2">
        <div className="h-3 w-32 rounded bg-line" />
        <div className="h-2 w-20 rounded bg-line" />
      </div>
    </div>
    <div className="mt-3 h-3 w-16 rounded bg-line" />
  </div>
)
