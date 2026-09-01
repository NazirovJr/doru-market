/**
 * `telegram-webapp.ts` (EP-01, DTJ-028.5, SRS-UX-043/045/047) — минимальный
 * типизированный wrapper над `window.Telegram.WebApp`.
 *
 * Стратегия: НЕ подключаем `@telegram-apps/sdk-react` (SRS-UX-043 говорит
 * «поверх существующего apps/web, НЕ отдельный бандл»), а определяем только
 * те поля, которые НУЖНЫ для авторизации (DTJ-027 бэкенд принимает
 * `initData` строку). Всё остальное (MainButton, themeParams) — зона
 * EP-18, не блокирует DTJ-028.5.
 *
 * Security:
 *   - `initData` читается ТОЛЬКО из `window.Telegram.WebApp.initData`,
 *     НЕ из query-string/localStorage. Бэкенд (DTJ-027) проверяет подпись
 *     HMAC-SHA256 с `botToken`; подделать `initData` нельзя без утечки токена.
 *   - `initData` НЕ кэшируется. `getInitData()` всегда возвращает СВЕЖЕЕ
 *     значение (`WebApp.initData` обновляется Telegram при каждом открытии
 *     мини-приложения, см. SRS-API-072).
 *   - `isAvailable()` НЕ доверяет `window.Telegram !== undefined`, потому что
 *     `window.Telegram` присутствует в обычном браузере, если открыть
 *     страницу с user-script'ом или расширением. Проверяем `WebApp.initData`.
 *
 * Type-only: никаких `any`. Если Telegram добавит поля — TS скажет, и мы
 * расширим интерфейс явно (НЕ «ловим всё» через index signature).
 */

const TELEGRAM_WEBAPP_INIT_DATA_MIN_LENGTH = 10
const MIN_TAP_ZONE_PX = 48

/**
 * Минимальный типизированный view `window.Telegram.WebApp` (DTJ-027,
 * официальная документация `https://core.telegram.org/bots/webapps`).
 * НЕ полная типизация — только поля, нужные для sign-in flow.
 */
export interface TelegramWebApp {
  /**
   * URL-encoded string с параметрами initData, переданная из Telegram
   * (`user`, `auth_date`, `hash`, и т.п.). Бэкенд (DTJ-027) парсит
   * через `URLSearchParams` и проверяет подпись.
   */
  readonly initData: string
  /**
   * `initDataUnsafe` — НЕ используется для авторизации (бэкенд игнорирует).
   * Присутствует в типизации, потому что Telegram-стандарт различает
   * `initData` (для бэкенда) и `initDataUnsafe` (для UI, НЕ доверяем).
   */
  readonly initDataUnsafe: {
    readonly user?: {
      readonly id: number
      readonly first_name: string
      readonly last_name?: string
      readonly username?: string
    }
  }
  /**
   * Программный close TWA. Не используется в sign-in, но оставлен для
   * возможных follow-up (например, после успешной авторизации — закрыть
   * TWA и вернуться в обычный flow).
   */
  readonly close: () => void
  /**
   * Готовность TWA. После `ready()` Telegram ждёт, пока UI отрендерится,
   * прежде чем показать мини-приложение (без этого — белая вспышка).
   * Не критично для sign-in, но оставлено для полноты API.
   */
  readonly ready: () => void
}

declare global {
  interface Window {
    readonly Telegram?: {
      readonly WebApp?: TelegramWebApp
    }
  }
}

/**
 * Истина, если страница открыта внутри Telegram Mini App (TWA). В этом
 * случае `window.Telegram.WebApp.initData` — НЕ пустая строка.
 *
 * Эвристика: `initData.length > 10` отсекает мусор/пустые placeholder'ы,
 * которые некоторые браузерные расширения записывают в `window.Telegram`.
 */
export function isTelegramWebApp(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  const webApp = window.Telegram?.WebApp
  if (webApp === undefined) {
    return false
  }
  return webApp.initData.length > TELEGRAM_WEBAPP_INIT_DATA_MIN_LENGTH
}

/**
 * Возвращает СВЕЖИЙ `initData` из TWA. Если `isTelegramWebApp() === false`
 * — бросает `Error` (на UI-кнопке мы делаем `disabled` в этом случае, но
 * safety net остаётся).
 */
export function getInitData(): string {
  const webApp = window.Telegram?.WebApp
  if (webApp === undefined) {
    throw new Error('Telegram WebApp is not available')
  }
  if (webApp.initData.length === 0) {
    throw new Error('Telegram WebApp.initData is empty')
  }
  return webApp.initData
}

export const TELEGRAM_BUTTON_MIN_HEIGHT_PX = MIN_TAP_ZONE_PX
