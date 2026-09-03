import type { ReactElement } from 'react'
import { useParams } from 'react-router'
import { useT } from '@dorutj/i18n'
import { useLocale } from '@/shared/config/locale-provider'
import { AnalogsBlock } from '@/features/analogs/ui/analogs-block'

/**
 * `medicine-page.tsx` — экран `/medicines/:id` (дизайн-референс `docs/spec/32-design-reference.md`
 * строка 176: `Medicine` → «Название/МНН/форма/производитель, бейдж Rx, `AnalogBanner`… + список
 * предложений аптек»).
 *
 * **ДОПУЩЕНИЕ (см. отчёт сдачи DTJ-104, раздел ДОПУЩЕНИЯ/DISPUTED).** Полноценного экрана
 * карточки товара во `apps/web` НЕТ — ни маршрута, ни страницы, ни тикета на неё в
 * `tickets/00-INDEX.md` (проверено: `DTJ-095` — бэкенд `GET /medicines/:id`, `layer: application`,
 * `files_owned` только `apps/api/**`; фронтенд-эквивалента не существует). DTJ-104 требует
 * (правило 1 AGENTS.md), чтобы `AnalogsBlock` был РЕАЛЬНО встроен в экран лекарства, а не просто
 * существовал файлом — без хост-страницы это невозможно физически. Этот файл — МИНИМАЛЬНЫЙ,
 * честно помеченный стаб (только `:id` из маршрута → `AnalogsBlock`), НЕ полноценный экран
 * `Medicine` из дизайн-референса (название/МНН/форма/производитель/список предложений/кнопка «На
 * карте» — вне `files_owned` DTJ-104, задача отдельного тикета EP-04/EP-07, которого пока нет в
 * плане). Тот же приём временного маркера, что `app/layout.tsx` (`TODO(EP-18)`).
 *
 * TODO(EP-04/EP-07): заменить на полноценный экран карточки товара, когда появится
 * соответствующий тикет (название/МНН/форма/производитель/список предложений/кнопка «На карте») —
 * `AnalogsBlock` при этом переносится как есть, без изменений (уже самодостаточный feature-модуль).
 */
const MedicinePage = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const { id } = useParams<{ id: string }>()
  const medicineId = id ?? ''

  return (
    <section className="flex flex-col gap-4" data-testid="medicine-page">
      {medicineId.length === 0 ? (
        <p role="alert" data-testid="medicine-page-missing-id" className="text-sm text-ink">
          {t('ux.error.generic_500')}
        </p>
      ) : (
        <AnalogsBlock medicineId={medicineId} />
      )}
    </section>
  )
}

export default MedicinePage
