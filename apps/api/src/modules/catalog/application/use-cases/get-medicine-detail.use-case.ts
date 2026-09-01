/**
 * `GetMedicineDetailUseCase` (DTJ-095, EP-04, R1) — `GET /api/v1/medicines/:id`.
 *
 * Карточка товара: целевая страница любого клика по результату поиска или блоку аналогов.
 * Скрывает черновики и запрещённые к обороту вещества (`psychotropic`/`narcotic`) строже,
 * чем список поиска: прямой запрос по известному `id` — самый частый вектор попытки обхода
 * (SRS-CAT-005/006). Резолвит fallback описания tj→ru (SRS-CAT-008).
 *
 * **Зависимости и почему их нет в этом тикете.**
 *   - `CatalogRepository.findMedicineById(id)` — реализован в DTJ-092, единый
 *     порт `CATALOG_REPOSITORY`. Возвращает `MedicineRecord` без фильтра видимости
 *     (см. JSDoc порта) — фильтр применяет этот use case.
 *   - `AnalogOfferLookupPort` (SRS-CAT-011/050) — DTJ-101 (`FindAnalogsUseCase`),
 *     `EP-07 Analog Engine`. В этом тикете поле `offers` возвращается пустым
 *     массивом с явным TODO; use case НЕ зависит от ещё не реализованного порта.
 *   - `FindAnalogsUseCase` (DTJ-101) — тот же эпик. В этом тикете `hasAnalogs`
 *     возвращается `false` с явным TODO. После реализации DTJ-101 этот use case
 *     будет переключён на прямой вызов `FindAnalogsUseCase.execute({limit:1})` —
 *     см. «Риски и подводные камни» тикета и временную заглушку `assumptions`.
 *
 * **Авторизация (SRS-CAT-005/006).** `bypassVisibilityCheck` выставляется
 * ТОЛЬКО presentation-слоем после проверки роли `super_admin`/каталог-оператор
 * (см. риск в тикете). Сам use case НЕ знает про роли (`02-CLEAN-ARCHITECTURE-AND-CODE.md`
 * §3.4 — авторизация на границе, не внутри бизнес-правил видимости).
 *
 * **404 mapping.** Существование записи не подтверждается постороннему: не найдено,
 * `isPublished=false`, `controlCategory ∈ {psychotropic, narcotic}` — все три случая
 * бросают `MedicineNotFoundError` (404 в `DomainExceptionFilter`). Существующий
 * код ошибки `MEDICINE_NOT_FOUND` не зарегистрирован в `ERROR_HTTP_STATUS`, поэтому
 * этот use case использует `ErrorCode.NOT_FOUND` через бросание `NotFoundError` из
 * `packages/contracts` — фильтр замапит в 404 корректно. Локальный
 * `MedicineNotFoundError` остаётся для других вызывающих и под будущую регистрацию
 * в общем каталоге кодов (TODO вне рамок тикета).
 *
 * @see docs/spec/20-module-catalog-search.md SRS-CAT-005/006/007/008/009/049/050
 * @see docs/STATE-AND-RESUME-POINT.md §11.4 задача 3.2 (Волна 3.5)
 */
import { Inject, Injectable } from '@nestjs/common'
import { NotFoundError } from '@dorutj/contracts'
import { CONTROL_CATEGORIES_FORBIDDEN_FROM_REMOTE } from '../../domain/medicine.enums.js'
import { CATALOG_REPOSITORY, type CatalogRepository } from '../ports/catalog-repository.port.js'
import type { MedicineRecord } from '../../domain/medicine.types.js'

/**
 * Опции запроса детальной карточки. `locale` — текущая локаль UI),
 * `radiusMeters` и `geo` — зарезервированы для `AnalogOfferLookupPort` (DTJ-101);
 * сейчас use case их НЕ потребляет (см. JSDoc выше), но контракт сигнатуры зафиксирован,
 * чтобы будущая интеграция не меняла публичный API.
 */
export interface GetMedicineDetailInput {
  readonly medicineId: string
  readonly locale: 'tj' | 'ru'
  readonly radiusMeters?: number
  readonly geo?: { readonly lat: number; readonly lon: number }
  /**
   * Флаг обхода фильтра видимости. Выставляется presentation-слоем ТОЛЬКО после
   * проверки роли `super_admin`/каталог-оператор в `RolesGuard` (см. описание риска в тикете).
   * Сейчас в R1 это всегда `false` — ролевой гард ещё не реализован.
   */
  readonly bypassVisibilityCheck: boolean
}

/**
 * Контракт детальной карточки (SRS-CAT-049). Описывает только то, что use case
 * отдаёт в presentation; presentation (контроллер) делает финальный JSON-маппинг,
 * включая подгонку имён полей под публичный DTO.
 *
 * `offers` и `hasAnalogs` сейчас — стабы `[]`/`false`. После реализации
 * `AnalogOfferLookupPort`/`FindAnalogsUseCase` (DTJ-101, EP-07) поле `offers` наполняется
 * через порт, а `hasAnalogs = items.length > 0` из `FindAnalogsUseCase.execute({limit: 1})`.
 */
export interface MedicineDetail {
  readonly record: MedicineRecord
  readonly description: string | null
  readonly offers: readonly unknown[]
  readonly hasAnalogs: boolean
}

@Injectable()
export class GetMedicineDetailUseCase {
  constructor(
    @Inject(CATALOG_REPOSITORY)
    private readonly catalogRepository: CatalogRepository,
  ) {}

  /**
   * Основной метод use case. Возвращает `MedicineDetail` для одной записи.
   * Бросает `NotFoundError` (`ErrorCode.NOT_FOUND`, маппится в 404) для:
   *   - несуществующего `medicineId`;
   *   - `isPublished = false` И `bypassVisibilityCheck = false`;
   *   - `controlCategory ∈ {psychotropic, narcotic}` И `bypassVisibilityCheck = false`.
   */
  async execute(input: GetMedicineDetailInput): Promise<MedicineDetail> {
    const record = await this.catalogRepository.findMedicineById(input.medicineId)
    if (record === null) {
      // Не раскрываем факт существования/несуществования (SRS-CAT-006).
      throw new NotFoundError({ resource: 'medicine' })
    }

    if (!input.bypassVisibilityCheck) {
      if (!record.isPublished) {
        throw new NotFoundError({ resource: 'medicine' })
      }
      if (CONTROL_CATEGORIES_FORBIDDEN_FROM_REMOTE.has(record.controlCategory)) {
        throw new NotFoundError({ resource: 'medicine' })
      }
    }

    const description = resolveDescription(input.locale, record.descriptionTj, record.descriptionRu)

    // TODO(DTJ-101, EP-07): подключить `AnalogOfferLookupPort.getOffersForMedicines([medicineId], geo,
    // radiusMeters ?? MEDICINE_DETAIL_ALL_OFFERS)`. Сейчас поле пустое — это сознательная
    // временная заглушка (см. JSDoc класса), не пропуск. До релиза R1 заглушка заменяется
    // на реальный вызов порта в тикете DTJ-101, после чего эта строка удаляется.
    const offers: readonly unknown[] = []

    // TODO(DTJ-101, EP-07): заменить на `FindAnalogsUseCase.execute({medicineId, geo, radiusMeters, limit: 1}).items.length > 0`.
    // Сейчас `hasAnalogs: false` — см. JSDoc класса.
    const hasAnalogs = false

    return { record, description, offers, hasAnalogs }
  }
}

/**
 * Резолв описания с фолбэком tj→ru (SRS-CAT-008). `en` как поле НЕ существует —
 * это сознательное решение SRS (`11-database-schema.md` хранит только `description_tj`
 * и `description_ru`).
 *
 * Логика:
 *   - locale='tj': description_tj ?? description_ru ?? null
 *   - locale='ru': description_ru ?? null
 *
 * Пустая строка `""` и строка из одних пробелов трактуется как отсутствие (БД иногда
 * хранит `''` для «поле не заполнено» из-за разных админских UI — `'' → null` устраняет
 * ложные пробелы в UI).
 */
export function resolveDescription(
  locale: 'tj' | 'ru',
  descriptionTj: string | null,
  descriptionRu: string | null,
): string | null {
  if (locale === 'tj') {
    return nonEmptyTrimmed(descriptionTj) ?? nonEmptyTrimmed(descriptionRu) ?? null
  }
  return nonEmptyTrimmed(descriptionRu) ?? null
}

/**
 * Возвращает `trim()` непустой строки или `null` для `null`/`undefined`/`''`/`'   '`.
 * Используется в `resolveDescription` для резолва fallback описания с защитой
 * от пустых/пробельных значений из БД.
 */
function nonEmptyTrimmed(value: string | null): string | null {
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}