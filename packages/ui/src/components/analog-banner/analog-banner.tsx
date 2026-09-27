/**
 * `AnalogBanner` (DTJ-407, `SRS-CAT-039`/`041`, D1, REQ-UX-2, `docs/04-SCOPE-DECISION-PIVOT.md`
 * §2.1) — плашка «тот же действующий компонент дешевле» под карточкой товара. INLINE-разметка
 * (обычный `<div>`), НЕ `Modal`/`role="dialog"` (REQ-UX-2 — плашка не перебивает поток экрана
 * назойливым оверлеем).
 *
 * i18n: два новых ключа заводятся этим тикетом.
 * - `catalog.analogs.banner_message` — параметризованный текст сравнения цены (`{substanceName}`/
 *   `{dosage}`/`{analogPrice}`/`{referencePrice}`/`{savingsPercent}`). `{analogPrice}`/
 *   `{referencePrice}` — уже ПОЛНЫЕ строки `formatMoney()` (с суффиксом валюты, DTJ-402) — шаблон
 *   НЕ дублирует слово «сомони» литералом (в отличие от `catalog.analogs.title_savings`/
 *   `SRS-CAT-038 savings_banner`, которые получают сырое число и сами достраивают суффикс) —
 *   иначе суффикс задвоился бы («N сомони сомони»), см. JSDoc `SavingsBadge` — тот же приём.
 *   НЕ переиспользует `catalog.analogs.savings_banner` (SRS-CAT-038): у того ключа другой набор
 *   параметров (`substanceNames`-массив, без `dosage`/`savingsPercent`) — он принадлежит блоку
 *   аналогов каталога (DTJ-104, `apps/web/src/features/analogs`), этот — отдельному inline-баннеру
 *   ЭТОГО компонента (разные экраны/контексты применения, ticket DTJ-407 §3).
 * - `catalog.analogs.disclaimer` — ИМЯ КЛЮЧА зафиксировано спекой (`SRS-CAT-039`/`041`, Must),
 *   до этого тикета отсутствовал в словарях. Текст — `pending_legal_review` (риски тикета
 *   DTJ-407): значение плейсхолдерное, замена на юридически вычитанный текст — правка ЗНАЧЕНИЯ
 *   ключа в трёх словарях, БЕЗ изменения структуры этого компонента.
 *
 * Дисклеймер рендерится ВСЕГДА, независимо от величины `savingsPercent` (SRS-CAT-039 — «КАЖДЫЙ
 * рендеринг блока аналогов», не только при значимой экономии) — критерий приёмки 3/тест-план.
 */
import { type ReactElement } from 'react'
import { type Locale, type TranslateFunction, formatMoney } from '@dorutj/i18n'

export interface AnalogBannerProps {
  /** Название действующего вещества (МНН) — данные с бэкенда, не UI-строка (не через `t()`). */
  readonly substanceName: string
  /** Дозировка (например «500 мг») — данные с бэкенда, не UI-строка. */
  readonly dosage: string
  readonly analogPriceDiram: number
  readonly referencePriceDiram: number
  /** Целое число процентов — посчитано бэкендом (компонент не считает экономию, DTJ-407 §DoD). */
  readonly savingsPercent: number
  readonly locale: Locale
  readonly t: TranslateFunction
}

export const AnalogBanner = ({
  substanceName,
  dosage,
  analogPriceDiram,
  referencePriceDiram,
  savingsPercent,
  locale,
  t,
}: AnalogBannerProps): ReactElement => (
  <div
    data-testid="analog-banner"
    style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-2)',
      boxSizing: 'border-box',
      padding: 'var(--space-3)',
      borderRadius: 'var(--radius-md)',
      background: 'var(--brand-success-bg)',
      border: '1px solid var(--brand-success-border)',
      fontFamily: 'var(--brand-font-family)',
    }}
  >
    <p
      data-testid="analog-banner-message"
      style={{
        margin: 0,
        fontSize: 'var(--font-size-sm)',
        fontWeight: 'var(--font-weight-medium)',
        color: 'var(--brand-success-text)',
      }}
    >
      {t('catalog.analogs.banner_message', {
        substanceName,
        dosage,
        analogPrice: formatMoney(analogPriceDiram, locale),
        referencePrice: formatMoney(referencePriceDiram, locale),
        savingsPercent,
      })}
    </p>
    <p
      data-testid="analog-banner-disclaimer"
      style={{
        margin: 0,
        fontSize: 'var(--font-size-xs)',
        color: 'var(--brand-text-muted)',
      }}
    >
      {t('catalog.analogs.disclaimer')}
    </p>
  </div>
)
