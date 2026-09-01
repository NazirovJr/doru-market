/**
 * Унифицированный порт `CatalogRepository` (DTJ-092, EP-04, R1).
 *
 * Все use case'ы модуля `catalog` (`GetMedicineDetailUseCase`, `GetCategoryTreeUseCase`,
 * `FindAnalogsUseCase`, `CatalogFacade`, админские write-пути DTJ-097/099/100/101)
 * читают и пишут `medicines` / `substances` / `categories` / `medicine_substances`
 * через ОДИН порт, а не напрямую через Drizzle — иначе `application` знает
 * про инфраструктуру (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.1, запрет
 * `application → infrastructure`).
 *
 * Единственная продакшен-реализация — `CatalogRepositoryAdapter` (Drizzle,
 * `infrastructure/adapters/catalog-repository.adapter.ts`). Тестовые
 * и dev-режимы могут использовать in-memory дублёр, но контракт — здесь.
 *
 * **Контракт фильтрации (SRS-CAT-005/006).** Метод `findMedicineById` ВОЗВРАЩАЕТ
 * запись как есть — включая черновики (`isPublished = false`) и любые категории
 * контроля, включая `psychotropic`/`narcotic`. Это сознательно: `super_admin`-
 * эндпоинты модерации должны читать скрытые записи через тот же репозиторий.
 * Публичные read-пути (`GET /api/v1/medicines`) ОБЯЗАНЫ применять фильтры
 * `isPublished`/`controlCategory` на своём уровне (use case / in-memory адаптер
 * для обратной совместимости с волной 3.5).
 *
 * **N+1-инвариант.** `findMedicineById` и `findMedicinesByIds` подгружают
 * `MedicineSubstance[]` JOIN'ом `medicine_substances` за ОДИН SQL-запрос —
 * `AnalogEquivalenceService` и `Medicine.publish()` обязаны видеть полное
 * множество веществ сразу, без ленивой подгрузки (SRS-DOM-013/017).
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-005/006)
 * @see docs/spec/10-domain-model.md (SRS-DOM-013/017)
 */
import type {
  CategoryNode,
  MedicineRecord,
  SubstanceRef,
} from '../../domain/medicine.types.js'
import type { Medicine } from '../../domain/medicine.entity.js'

/** DI-токен NestJS для `CatalogRepository` (D-27: единый Symbol на пакет). */
export const CATALOG_REPOSITORY = Symbol.for('@dorutj/catalog/catalog-repository')

/**
 * Унифицированный контракт каталога.
 *
 * `findMedicineById` / `findMedicinesByIds` возвращают `MedicineRecord` DTO
 * инфраструктуры (см. `domain/medicine.types.ts`) — НЕ доменную сущность
 * `Medicine`. Маппинг `MedicineRecord ↔ Medicine` делает `MedicineMapper`
 * в `infrastructure/mappers/`. Домен НЕ зависит от инфраструктуры, но
 * инфраструктура зависит от домена — это нормальная стрелка `infra → domain`
 * (`02` §1.3).
 */
export interface CatalogRepository {
  /**
   * Возвращает ОДНУ запись `MedicineRecord` (агрегат с `substances[]`) или `null`,
   * если не найдена. Решение о 404 / 403 / 410 принимает use case, не репозиторий.
   *
   * Без фильтра видимости — см. JSDoc порта.
   */
  findMedicineById(id: string): Promise<MedicineRecord | null>

  /**
   * Батч-выборка по списку id. Возвращает ТОЛЬКО найденные записи (порядок не
   * гарантирован). Пустой массив на входе → пустой массив на выходе (не ошибка).
   * Тот же N+1-инвариант: один SQL-запрос с JOIN.
   */
  findMedicinesByIds(ids: readonly string[]): Promise<MedicineRecord[]>

  /**
   * Дерево категорий с уже поднятыми `children[]`. Корни — узлы с
   * `parentId === null`. Неактивные категории (`isActive = false`) исключены —
   * они нужны только для админки, не для публичной навигации (SRS-CAT-004).
   */
  findCategoryTree(): Promise<readonly CategoryNode[]>

  /**
   * Батч-выборка веществ по списку id препаратов: `medicineId → SubstanceRef[]`.
   * Используется `FindAnalogsUseCase` для оценки пересечения МНН между
   * кандидатом и текущим препаратом. Один SQL-запрос (SRS-CAT-042).
   */
  findSubstancesByMedicineIds(
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, readonly SubstanceRef[]>>

  /**
   * Персистенция доменной сущности `Medicine` (insert/update). Сигнатура
   * зарезервирована для DTJ-097 (создание черновика при composite-матчинге)
   * и DTJ-099 (домен `Medicine.publish()`/`proposeControlCategory()` требует
   * персистентности решения). В этом тикете достаточно объявить и реализовать
   * минимально (`INSERT ... ON CONFLICT (id) DO UPDATE`) — полное покрытие
   * тестами пишут потребляющие тикеты.
   *
   * Запись идёт через `MedicineMapper.toRecord(medicine)` — маппер знает,
   * как превратить сущность в плоскую запись БД + отдельные строки
   * `medicine_substances`.
   */
  save(medicine: Medicine): Promise<void>
}