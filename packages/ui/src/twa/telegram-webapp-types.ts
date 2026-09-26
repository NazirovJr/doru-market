/**
 * `telegram-webapp-types.ts` (DTJ-411, `SRS-UX-043/044/045/046`) — минимальный типизированный
 * доступ к `window.Telegram.WebApp`, разделяемый файлами `src/twa/**`.
 *
 * Риск тикета зафиксирован явно: `@telegram-apps/sdk-react` (упомянут `SRS-UX-043` как технический
 * выбор) отсутствует в `pnpm-lock.yaml`/`docs/01-TECH-BASELINE.md` и НЕ входит в зафиксированный
 * список пакетов — правило AGENTS.md §10 запрещает исполнителю самостоятельно ставить новую
 * зависимость («needsDependency» в отчёте). `apps/web/src/features/auth/lib/telegram-webapp.ts`
 * (EP-01, DTJ-028.5) уже приняла то же решение для `initData`-авторизации по той же причине —
 * этот файл продолжает ту же стратегию для темизации/`MainButton`/`BackButton`: узкий
 * типизированный wrapper над нативным `window.Telegram.WebApp` без внешнего SDK.
 *
 * Сознательно НЕ используется `declare global` (как в `apps/web/.../telegram-webapp.ts`) — два
 * независимых `declare global { interface Window { Telegram?: ... } }` с разными по составу
 * полей интерфейсами в разных пакетах монорепо рискуют конфликтом деклараций при объединении
 * тайпчека потребителя (`apps/web` зависит от `@dorutj/ui`). Вместо этого — локальный type cast,
 * не затрагивающий глобальное пространство имён `Window`.
 *
 * Миграция (вне периметра этого тикета): `apps/web/src/features/auth/lib/telegram-webapp.ts`
 * читает `initData`/`ready`/`close` отдельным узким интерфейсом — при появлении зависимости
 * `@telegram-apps/sdk-react` в `01-TECH-BASELINE.md` оба места стоит объединить вокруг общего
 * источника типов (кандидат размещения — `packages/domain-kernel`/новый общий пакет, т.к. нужен
 * ≥2 пакетам, правило AGENTS.md §12).
 */

export interface TelegramThemeParams {
  /** Нативный метод хоста: проставляет `--tg-theme-*` custom properties на `document.documentElement`. */
  readonly bindCssVars: () => void
}

export interface TelegramViewport {
  /** Обязателен при старте TWA (`research 07 §1.3`) — иначе приложение открывается в половине экрана. */
  readonly expand: () => void
}

export interface TelegramMainButton {
  setText: (text: string) => void
  show: () => void
  hide: () => void
  enable: () => void
  disable: () => void
  showProgress: () => void
  hideProgress: () => void
  onClick: (callback: () => void) => void
  offClick: (callback: () => void) => void
}

export interface TelegramBackButton {
  show: () => void
  hide: () => void
  onClick: (callback: () => void) => void
  offClick: (callback: () => void) => void
}

export interface TelegramWebApp {
  readonly themeParams: TelegramThemeParams
  readonly viewport: TelegramViewport
  readonly MainButton: TelegramMainButton
  readonly BackButton: TelegramBackButton
}

interface TelegramGlobal {
  readonly WebApp?: TelegramWebApp
}

/**
 * Given обычный веб (нет `window` — SSR/тест, или `window.Telegram.WebApp` не присутствует),
 * When вызов, Then `undefined` без побочных эффектов и без исключения.
 */
export function getTelegramWebApp(): TelegramWebApp | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }
  return (window as typeof window & { Telegram?: TelegramGlobal }).Telegram?.WebApp
}
