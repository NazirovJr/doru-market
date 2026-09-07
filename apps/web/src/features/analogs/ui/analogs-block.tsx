import type { ReactElement } from 'react'
import { useT, type Locale, type TranslateFunction } from '@dorutj/i18n'
import { Skeleton } from '@dorutj/ui'
import { useLocale } from '@/shared/config/locale-provider'
import { useAnalogsQuery, type AnalogsDataDto, type UseAnalogsQueryGeo } from '../api/use-analogs-query'
import { AnalogCard } from './analog-card'
import { SavingsBanner } from './savings-banner'

/**
 * `analogs-block.tsx` (DTJ-104, `SRS-CAT-036..040`, `TC-CAT-013..016`).
 *
 * Композиция: `SavingsBanner`/нейтральный заголовок (по серверному `titleKey`, компонент это
 * условие не пересчитывает — DTJ-104 п.3), список `AnalogCard[]`, дисклеймер.
 *
 * **Дисклеймер рендерится ВСЕГДА, включая ПУСТОЙ `items`** (решение CTO по этому тикету,
 * SRS-CAT-039/REQ-NORM-3 — нормативное требование, не UX-пожелание: сервер отдаёт `disclaimer`
 * даже при пустом списке, скрывать текст в этой ветке запрещено). Это ОТМЕНЯЕТ пункт тест-плана
 * тикета «пустой items → блок не рендерится вовсе» — прямое указание CTO в постановке этого
 * тикета старше и приоритетнее текста самого тикета, см. DISPUTED отчёта сдачи. Блок целиком не
 * рендерится (`return null`) ТОЛЬКО при сетевой/иной ошибке запроса (DTJ-104 п.6 — аналоги не
 * критичны для покупки, деградация без блокировки карточки товара) и при пустом `medicineId`.
 *
 * Заголовок берётся из `data.titleKey` ДОСЛОВНО (строковое сравнение с константой ниже), не
 * пересчитывается из `data.savingsDiram` — сервер уже принял решение (`resolveTitleKey`,
 * `analog-result.dto.ts`), вторая реализация того же правила на клиенте разошлась бы с ним.
 */

/** Совпадает с `apps/api/.../catalog/presentation/dto/analog-result.dto.ts` — строковый контракт, не бизнес-правило (см. JSDoc выше). */
const TITLE_KEY_SAVINGS = 'catalog.analogs.title_savings'
const TITLE_KEY_NEUTRAL = 'catalog.analogs.title_neutral'

const SKELETON_CARD_COUNT = 3
const SKELETON_KEYS = Array.from({ length: SKELETON_CARD_COUNT }, (_, index) => `analogs-skeleton-${String(index)}`)

export interface AnalogsBlockProps {
  readonly medicineId: string
  readonly geo?: UseAnalogsQueryGeo | undefined
  readonly radiusMeters?: number | undefined
}

const AnalogsBlockSkeleton = (): ReactElement => (
  <div data-testid="analogs-block-skeleton" className="flex flex-col gap-2">
    {SKELETON_KEYS.map((key) => (
      <Skeleton key={key} variant="card" data-testid="analog-card-skeleton" />
    ))}
  </div>
)

interface AnalogsBlockHeaderProps {
  readonly data: AnalogsDataDto
  readonly locale: Locale
  readonly t: TranslateFunction
}

/** `savingsDiram !== null` — узкая type-guard проверка типа TS, НЕ пересчёт бизнес-правила (см. JSDoc файла). */
const AnalogsBlockHeader = ({ data, locale, t }: AnalogsBlockHeaderProps): ReactElement => {
  if (data.titleKey === TITLE_KEY_SAVINGS && data.savingsDiram !== null) {
    return <SavingsBanner savingsDiram={data.savingsDiram} locale={locale} t={t} />
  }
  return (
    <h2 data-testid="analogs-block-neutral-title" className="text-sm font-semibold text-ink">
      {t(TITLE_KEY_NEUTRAL)}
    </h2>
  )
}

interface AnalogsBlockContentProps {
  readonly data: AnalogsDataDto
  readonly locale: Locale
  readonly t: TranslateFunction
}

const AnalogsBlockContent = ({ data, locale, t }: AnalogsBlockContentProps): ReactElement => (
  <section data-testid="analogs-block" className="flex flex-col gap-3">
    <AnalogsBlockHeader data={data} locale={locale} t={t} />
    {data.items.length > 0 ? (
      <ul className="flex flex-col gap-2" data-testid="analogs-block-list">
        {data.items.map((item) => (
          <li key={item.medicineId}>
            <AnalogCard item={item} locale={locale} t={t} />
          </li>
        ))}
      </ul>
    ) : null}
    {/* SRS-CAT-039/REQ-NORM-3: ВСЕГДА в DOM, независимо от веток выше — см. JSDoc файла. */}
    <p data-testid="analogs-disclaimer" className="text-xs text-ink-muted">
      {data.disclaimer}
    </p>
  </section>
)

export const AnalogsBlock = ({ medicineId, geo, radiusMeters }: AnalogsBlockProps): ReactElement | null => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const query = useAnalogsQuery({ medicineId, geo, radiusMeters })

  if (medicineId.trim().length === 0) {
    return null
  }
  if (query.isPending) {
    return <AnalogsBlockSkeleton />
  }
  if (query.error !== null) {
    // Деградация без блокировки основной карточки товара (DTJ-104 п.6) — аналоги
    // дополнительная, не критичная для покупки информация.
    return null
  }

  return <AnalogsBlockContent data={query.data} locale={locale} t={t} />
}
