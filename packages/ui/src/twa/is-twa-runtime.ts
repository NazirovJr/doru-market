/**
 * `is-twa-runtime.ts` (DTJ-411, `SRS-UX-043`) — чистый детектор среды Telegram Mini App.
 *
 * Определяет, какой из двух путей рендера использовать (обычная `Button`/стрелка «назад», DTJ-404
 * vs системные `MainButton`/`BackButton`, `SRS-UX-045/046`). Без побочных эффектов, безопасна к
 * вызову в SSR/тестовом окружении — не бросает при отсутствии `window`.
 */
import { getTelegramWebApp } from './telegram-webapp-types'

/**
 * Given `window.Telegram?.WebApp` отсутствует (обычный веб, SSR, тест без мока), Then `false`.
 * Given мок SDK присутствует, Then `true`.
 */
export function isTwaRuntime(): boolean {
  return getTelegramWebApp() !== undefined
}
