import type { ReactElement } from 'react'

// Плейсхолдер главного маршрута — реальный каталог/поиск не входит в DTJ-003 (другие эпики).
// TODO(EP-18): текст заменить на packages/i18n после готовности словарей (DTJ-004).
const COMING_SOON_TEXT = 'скоро'

export const ComingSoonPage = (): ReactElement => (
  <p className="text-ink-muted" data-testid="coming-soon-placeholder">
    {COMING_SOON_TEXT}
  </p>
)
