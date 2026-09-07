import type { ReactElement } from 'react'

/** Иконка крестика закрытия, общая для `Modal`/`BottomSheet` — декоративна (`aria-hidden`),
 * доступное имя несёт `aria-label` на самой `IconButton`, не эта иконка. */
export const CloseIcon = (): ReactElement => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path
      d="M3 3L13 13M13 3L3 13"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
)
