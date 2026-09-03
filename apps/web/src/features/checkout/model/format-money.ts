import { toIntlLocale, type Locale } from '@dorutj/i18n'

/**
 * `format-money.ts` (DTJ-235) — целые дирамы → строка сомони для отображения (правило 6
 * AGENTS.md: деление на 100 только на последнем шаге, для показа, не для промежуточных
 * вычислений — вся арифметика над `*Diram`-полями этого экрана остаётся целочисленной).
 *
 * `locale` МАППИТСЯ через `toIntlLocale()` (`@dorutj/i18n`), НЕ передаётся в `Intl.NumberFormat`
 * напрямую — внутренний код локали `'tj'` не зарегистрирован в BCP-47 (`tg` — реальный код),
 * `Intl` на незарегистрированном теге молча откатывается на американское форматирование
 * (точка вместо запятой) — см. подробный разбор в `features/analogs/model/format-savings.ts`,
 * тот же приём, второй независимый потребитель `toIntlLocale` в кодовой базе (не третий — копия
 * самой функции `formatSomoni`/`formatSavings` НЕ создаётся здесь: `features/analogs` — чужая
 * фича, горизонтальный импорт `checkout → analogs` запрещён `.dependency-cruiser.cjs`
 * (`fe-features-are-isolated`), поэтому эта копия — не третье повторение единой абстракции, а
 * необходимое следствие изоляции фич по `02-CLEAN-ARCHITECTURE-AND-CODE.md` §5).
 */

const DIRAM_PER_SOMONI = 100
const SOMONI_FRACTION_DIGITS = 2

export function formatCheckoutMoney(amountDiram: number, locale: Locale): string {
  const somoni = amountDiram / DIRAM_PER_SOMONI
  return new Intl.NumberFormat(toIntlLocale(locale), {
    minimumFractionDigits: SOMONI_FRACTION_DIGITS,
    maximumFractionDigits: SOMONI_FRACTION_DIGITS,
  }).format(somoni)
}
