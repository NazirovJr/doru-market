/**
 * `use-telegram-theme.ts` (DTJ-411, `SRS-UX-013/044`) — третий, самый внешний слой каскада
 * темизации: нейтральный дефолт (`colors.css`, `SRS-TEN-015`) → бренд тенанта (`--brand-*`,
 * `validateBrandingPayload()`, DTJ-401) → (только в TWA) `--tg-theme-*` поверх ПОДМНОЖЕСТВА
 * токенов.
 *
 * Поведение (`docs/spec/30-ux-screens-and-flows.md` §9.2, `SRS-UX-044`):
 * 1. Given обычный веб (`isTwaRuntime() === false`) — хук не вызывает ни `themeParams.bindCssVars()`,
 *    ни `viewport.expand()` (проверяется отсутствием вызова мока SDK).
 * 2. Given TWA — вызывает `bindCssVars()` (хост проставляет `--tg-theme-*` custom properties на
 *    `document.documentElement`) и ОБЯЗАТЕЛЬНО `viewport.expand()` (`research 07 §1.3` — иначе
 *    приложение открывается в компактной половине экрана), затем переносит СТРОГО таблицу
 *    `TELEGRAM_THEME_VAR_MAP` на `--brand-*`.
 * 3. Если хост не отдаёт значение конкретной `--tg-theme-*` переменной (напр. старый клиент без
 *    `section-separator-color`) — соответствующий `--brand-*` НЕ перезаписывается `undefined`/
 *    пустой строкой, fallback остаётся прежним значением бренда.
 *
 * `--brand-success`/`-danger`/`-warning` (`LOCKED_SEMANTIC_KEYS`, `tokens/branding-allowlist.ts`,
 * `SRS-UX-012`) НАМЕРЕННО отсутствуют в `TELEGRAM_THEME_VAR_MAP` — Telegram не предоставляет
 * отдельных семантических цветов, подмена «ошибки»/«успеха» палитрой хоста нарушила бы узнаваемость
 * статуса (`SRS-UX-044`). `use-telegram-theme.spec.ts` содержит тест-нарушитель, ловящий попытку
 * добавить эти ключи в карту.
 *
 * Допущение (запись в отчёт тикета, `AGENTS.md` §10): строка таблицы `SRS-UX-044` «(текст на
 * кнопке) ← --tg-theme-button-text-color» не имеет целевого `--brand-*` токена ни в
 * `tokens/colors.css` (владение DTJ-401, вне `files_owned` этого тикета — правится ТОЛЬКО
 * дополнением, не создаём новый токен без решения владельца дизайн-системы), ни в
 * `tokens/branding-allowlist.ts`. Системная `MainButton` — нативный UI-элемент хоста и получает
 * цвет своего текста от Telegram автоматически (без нашего вмешательства); этот хук её не
 * стилизует напрямую (см. `use-main-button.ts`).
 */
import { useEffect } from 'react'
import { isTwaRuntime } from './is-twa-runtime'
import { getTelegramWebApp } from './telegram-webapp-types'

/**
 * `SRS-UX-044` §9.2 — СТРОГО эта таблица, ничего сверх. Экспортируется для теста-нарушителя
 * (`use-telegram-theme.spec.ts`): попытка добавить `--brand-success`/`-danger`/`-warning` в эту
 * карту обязана быть поймана тестом, не только этим комментарием.
 */
export const TELEGRAM_THEME_VAR_MAP: readonly (readonly [brandVar: string, telegramVar: string])[] = [
  ['--brand-bg', '--tg-theme-bg-color'],
  ['--brand-surface', '--tg-theme-secondary-bg-color'],
  ['--brand-text', '--tg-theme-text-color'],
  ['--brand-text-muted', '--tg-theme-hint-color'],
  ['--brand-primary', '--tg-theme-button-color'],
  ['--brand-border', '--tg-theme-section-separator-color'],
]

function applyTelegramThemeCascade(): void {
  const root = document.documentElement
  const computed = getComputedStyle(root)

  for (const [brandVar, telegramVar] of TELEGRAM_THEME_VAR_MAP) {
    const value = computed.getPropertyValue(telegramVar).trim()
    if (value.length > 0) {
      root.style.setProperty(brandVar, value)
    }
  }
}

/**
 * Монтируется один раз (эквивалент "на старте приложения"). Не принимает и не возвращает значений
 * — эффект целиком в мутации `document.documentElement` (единственный источник правды для
 * `var(--brand-*)`, читаемого всеми компонентами `packages/ui`).
 */
export function useTelegramTheme(): void {
  useEffect(() => {
    if (!isTwaRuntime()) {
      return
    }
    const webApp = getTelegramWebApp()
    if (webApp === undefined) {
      return
    }
    webApp.themeParams.bindCssVars()
    webApp.viewport.expand()
    applyTelegramThemeCascade()
  }, [])
}
