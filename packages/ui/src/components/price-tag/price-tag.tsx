/**
 * `PriceTag` (DTJ-407, `SRS-UX-002`/`SRS-UX-003`/`SRS-UX-031`) — отображение цены. Единственное
 * место форматирования денег в этом слое — через `formatMoney()` (`@dorutj/i18n`, DTJ-402):
 * компонент НЕ содержит собственной денежной арифметики или округления (AGENTS.md правило 6 —
 * деньги только целыми дирамами, конвертация в сомони — исключительно внутри `formatMoney`).
 *
 * `strikethrough` — пара «было/стало»: когда задан `previousAmountDiram`, он рендерится ПЕРЕД
 * основной ценой, зачёркнутым, приглушённым цветом — семантика «была дороже» передаётся
 * `<s>`-элементом (не только цветом/CSS, `SRS-UX-034`), а не парой чисел без разметки.
 *
 * Крупный контрастный текст цены — `--font-size-lg` + `--brand-text` на `--brand-surface`
 * (целевой контраст 7:1 для критичных цифр, `SRS-UX-003`) — токены, не хардкод цвета/размера.
 */
import { type ReactElement } from 'react'
import { type Locale, formatMoney } from '@dorutj/i18n'

export interface PriceTagProps {
  /** Итоговая (актуальная) цена, целые дирамы — AGENTS.md правило 6. */
  readonly amountDiram: number
  /**
   * Прежняя (более высокая) цена, если задана — рендерится зачёркнутой перед основной ценой
   * (пара «было/стало»). Само по себе поле `strikethrough` компонент не принимает: наличие
   * `previousAmountDiram` — единственный источник этого состояния (нет риска рассинхронизации
   * пропа-флага и пропа-значения).
   */
  readonly previousAmountDiram?: number
  readonly locale: Locale
}

export const PriceTag = ({ amountDiram, previousAmountDiram, locale }: PriceTagProps): ReactElement => (
  <span
    data-testid="price-tag"
    style={{
      display: 'inline-flex',
      alignItems: 'baseline',
      gap: 'var(--space-2)',
      fontFamily: 'var(--brand-font-family)',
    }}
  >
    {previousAmountDiram !== undefined && (
      <s
        data-testid="price-tag-previous"
        style={{
          fontSize: 'var(--font-size-sm)',
          fontWeight: 'var(--font-weight-regular)',
          color: 'var(--brand-text-muted)',
        }}
      >
        {formatMoney(previousAmountDiram, locale)}
      </s>
    )}
    <span
      data-testid="price-tag-current"
      style={{
        fontSize: 'var(--font-size-lg)',
        fontWeight: 'var(--font-weight-bold)',
        color: 'var(--brand-text)',
      }}
    >
      {formatMoney(amountDiram, locale)}
    </span>
  </span>
)
