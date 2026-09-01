/**
 * `MedicinesController` (DTJ-094 + DTJ-095, read-часть для EP-04 / Волна 4).
 *
 * Маршруты:
 *   - `GET /api/v1/medicines?categoryId=…&limit=…&offset=…` — пагинированный список
 *     опубликованных medicines, опционально по категории. Hard ceiling `limit=100`,
 *     default `limit=20`. `offset` ≥ 0.
 *   - `GET /api/v1/medicines/:id` — детальная карточка товара (DTJ-095, SRS-CAT-049).
 *     Содержит `description` с резолвом fallback tj→ru, `offers: []`/`hasAnalogs: false`
 *     пока — временная заглушка для EP-07 (DTJ-101, `AnalogOfferLookupPort` +
 *     `FindAnalogsUseCase`). Эти поля будут наполнены в DTJ-101, а не здесь
 *     (см. JSDoc `GetMedicineDetailUseCase`).
 *
 * Endpoints маркера `@Public()` (для DTJ-060/120 — R1-3 публичный поиск
 * работает без авторизации). Это осознанный выбор, а не задел на будущее: это
 * READ-маршрут без чувствительных данных: в нём нет аптечных остатков, цен или
 * личных данных — только публичная карточка препарата.
 *
 * **404 mapping для `psychotropic`/`narcotic` (SRS-CAT-005/006).** Делается на уровне
 * use case `GetMedicineDetailUseCase` — не подтверждаем существование запрещённой записи
 * постороннему. Не на уровне репозитория (как было в DTJ-094 read-части), потому что
 * `CATALOG_REPOSITORY.findMedicineById` возвращает запись БЕЗ фильтра видимости —
 * намеренно для super_admin-эндпоинтов модерации.
 *
 * **`bypassVisibilityCheck`.** Этот флаг пока всегда `false`: ролевой гард ещё не
 * реализован (EP-15, не входит в волну 3.5). Когда появится — admin-контроллер
 * сможет передавать `true` после проверки роли `super_admin`/каталог-оператор.
 *
 * @see docs/STATE-AND-RESUME-POINT.md §11.4 задача 3.1/3.2 + §11.6 (Волна 4, EP-04)
 */
import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common'
import { ok } from '@dorutj/contracts'
import { Public } from '@/common/decorators/public.decorator.js'
import { GetMedicineDetailUseCase } from '@/modules/catalog/application/use-cases/get-medicine-detail.use-case.js'
import { ListMedicinesUseCase } from '@/modules/catalog/application/use-cases/list-medicines.use-case.js'
import { toMedicineDetailDto, type MedicineDetailResponseDto } from '../dto/medicine-detail.dto.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

/** Дефолт и жёсткий потолок, чтобы клиент не вытащил всю БД одним запросом. */
const DEFAULT_LIST_LIMIT = 20
const MAX_LIST_LIMIT = 100

/** Поддерживаемые локали для описания (SRS-CAT-008: только `tj`/`ru`, `en` не существует). */
const SUPPORTED_LOCALE_VALUES = ['tj', 'ru'] as const
type SupportedLocale = (typeof SUPPORTED_LOCALE_VALUES)[number]

const DEFAULT_LOCALE: SupportedLocale = 'tj'

@Controller({ path: 'medicines', version: '1' })
@Public()
export class MedicinesController {
  constructor(
    private readonly getMedicineDetail: GetMedicineDetailUseCase,
    private readonly listMedicines: ListMedicinesUseCase,
  ) {}

  @Get()
  async list(
    @Query('categoryId') categoryIdRaw: string | undefined,
    @Query('limit') limitRaw: string | undefined,
    @Query('offset') offsetRaw: string | undefined,
  ): Promise<unknown> {
    const categoryId = parseCategoryId(categoryIdRaw)
    const limit = clampLimit(parseLimit(limitRaw))
    const offset = Math.max(0, parseIntOrZero(offsetRaw))
    const items = await this.listMedicines.execute({
      categoryId,
      params: { limit, offset },
    })
    const data = items.map((m) => ({
      medicineId: m.getId(),
      tradeName: m.getTradeName(),
      innName: m.getInnName(),
      dosageForm: m.getDosageForm().getFormClass(),
      dosageStrength: m.getDosageStrengthRaw(),
      isPrescriptionRequired: m.isPrescriptionRequired(),
      controlCategory: m.getControlCategory(),
    }))
    return ok({ items: data, total: data.length, limit, offset })
  }

  /**
   * Детальная карточка товара (DTJ-095). Принимает опциональные query-параметры:
   *   - `locale` — `tj` (default) или `ru` (SRS-CAT-008).
   *   - `radiusMeters`, `lat`, `lon` — зарезервированы для DTJ-101 (offers), сейчас не используются.
   *   - `bypassVisibilityCheck` — НЕ принимается от клиента; всегда `false` для публичного
   *     маршрута. Флаг будет использоваться admin-эндпоинтом после появления ролевого гарда
   *     (EP-15).
   *
   * Возвращает `{ data: MedicineDetailDto }` по SRS-CAT-049 (полный набор полей,
   * включая `substances[]`, `offers[]`, `hasAnalogs`).
   */
  @Get(':id')
  async getById(
    @Param('id', ID_PARSE_UUID) id: string,
    @Query('locale') localeRaw: string | undefined,
  ): Promise<MedicineDetailResponseDto> {
    const locale = parseLocale(localeRaw)
    const detail = await this.getMedicineDetail.execute({
      medicineId: id,
      locale,
      bypassVisibilityCheck: false,
    })
    return { data: toMedicineDetailDto(detail) }
  }
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIST_LIMIT
  return parseIntOrZero(raw) || DEFAULT_LIST_LIMIT
}

function parseCategoryId(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return null
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : null
}

function parseIntOrZero(raw: string | undefined): number {
  if (raw === undefined) return 0
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : 0
}

function clampLimit(n: number): number {
  if (n <= 0) return DEFAULT_LIST_LIMIT
  if (n > MAX_LIST_LIMIT) return MAX_LIST_LIMIT
  return DEFAULT_LIST_LIMIT
}

/**
 * Парсинг `locale` query-параметра. Невалидные значения тихо фолбэчат на дефолт —
 * карточка товара обязана отдаваться (с фолбэком описания `tj → ru`), а не падать
 * 400 на кривом заголовке. Валидация через `Set` исключает неподдерживаемые
 * значения без выделения HTTP-ошибки (SRS-CAT-008: `en` как поле не существует).
 */
function parseLocale(raw: string | undefined): SupportedLocale {
  if (raw === undefined || raw === '') return DEFAULT_LOCALE
  const normalized = raw.toLowerCase()
  if ((SUPPORTED_LOCALE_VALUES as readonly string[]).includes(normalized)) {
    return normalized as SupportedLocale
  }
  return DEFAULT_LOCALE
}