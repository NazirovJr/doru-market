/**
 * `TenantScopedRepository<TEntity>` (DTJ-056, EP-02) — переиспользуемый
 * базовый класс для репозиториев тенант-скоупных таблиц.
 *
 * Зачем это нужно
 * ----------------
 * Charter §3.4 требует «обязателен тест на утечку данных между тенантами».
 * Эта гарантия ЦЕЛИКОМ держится на дисциплине типов (обязательный параметр
 * `tenantId`) + переиспользуемом поведенческом тесте
 * `describeTenantIsolationContract` (testing/tenant-isolation.contract-test.ts).
 *
 * `dependency-cruiser` не может статически проверить содержимое SQL-запроса
 * (есть ли `WHERE tenant_id = ?`), поэтому тип + контракт-тест — единственное
 * статическое + динамическое рубежирование.
 *
 * Граница применимости
 * --------------------
 * - Применимо к таблицам с **прямой** колонкой `tenant_id`
 *   (`users`, `orders`, `cart`, `prescriptions`, `notifications`,
 *   `i18n_overrides` — см. `11-database-schema.md` §«Изоляция тенантов»).
 * - НЕ применимо к таблицам с **транзитивным** тенант-скоупом
 *   (`pharmacies`, `pharmacy_inventory` — скоуп через `chain_id`, не
 *   прямую колонку `tenant_id`). Для таких таблиц контракт-тест неприменим
 *   дословно; изоляция проверяется JOIN-цепочкой (ответственность конкретного
 *   модуля).
 * - НЕ применимо к самой таблице `tenants` (она определяет тенантов, тенант-
 *   скоуп неприменим по определению — комментарий в
 *   `tenant.repository.ts`, DTJ-052).
 *
 * Что экспортируется
 * ------------------
 * - `TenantScopedRepository<TEntity>` — абстрактный базовый класс.
 * - `InvalidTenantIdError` — ошибка рантайм-рубежа для случаев, когда
 *   TypeScript обойдён через `any`/`unknown`.
 *
 * Контракт наследника
 * --------------------
 * ЛЮБОЙ публичный метод чтения/записи в наследнике ОБЯЗАН принимать
 * `tenantId: TenantId` ПЕРВЫМ явным параметром. Конкретные `findById`/
 * `save`/`delete` определяет каждый наследник. Базовый класс не диктует
 * query-логику — только тип-контракт + рантайм-страховку.
 *
 * Пример наследника:
 *
 * ```ts
 * class UserRepository extends TenantScopedRepository<User> {
 *   findById(tenantId: TenantId, id: string): Promise<User | null> {
 *     this.assertTenantId(tenantId) // рантайм-рубеж
 *     return this.db.query.users.findFirst({
 *       where: and(eq(users.id, id), eq(users.tenant_id, tenantId.value)),
 *     })
 *   }
 * }
 * ```
 *
 * @see docs/05-DEVELOPER-HANDBOOK.md §6 (направление зависимостей)
 * @see apps/api/src/modules/tenancy/testing/tenant-isolation.contract-test.ts
 *   переиспользуемый contract-test (обязателен для каждого тенант-скоупного
 *   репозитория в `pnpm verify`).
 */
import type { TenantId } from '@/modules/tenancy/domain/value-objects/tenant-id.vo.js'

/**
 * Ошибка рантайм-рубежа: вызывающий код передал `undefined`/`null` вместо
 * валидного `TenantId`. Это второй рубеж после типов — на случай, если
 * TypeScript обойдён через `any`/`unknown` или ошибка миграции в типах.
 *
 * Намеренно выделена в отдельный класс, чтобы ревьюер/мониторинг мог
 * отличить «забыли передать tenantId» от других ошибок репозитория.
 */
export class InvalidTenantIdError extends Error {
  constructor(message = 'tenantId is required') {
    super(message)
    this.name = 'InvalidTenantIdError'
  }
}

// TEntity — compile-time маркер для контракта наследника (см. _entityBrand),
// не используется в сигнатурах методов намеренно: базовый класс не знает о
// query-логике. ESLint no-unnecessary-type-parameters здесь срабатывает ошибочно.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- compile-time маркер через _entityBrand для контракта наследника; не сигнатурный, а type-level инвариант базового класса
export abstract class TenantScopedRepository<TEntity> {
  /**
   * Рантайм-проверка `tenantId` — вызывается наследником ПЕРЕД query, чтобы
   * случайный `undefined`/`null`/`''` не превратился в `WHERE tenant_id = NULL`
   * (Postgres-семантика: `NULL = NULL` → `NULL` → ни одной строки, то есть
   * ВСЕ записи тенанта возвращаются как null). Это страховка от обхода
   * типов; первичная защита — TypeScript-сигнатура.
   */
  protected assertTenantId(tenantId: TenantId): void {
    // Защита от обхода типов через `any`/`unknown`. TypeScript видит, что
    // параметр типа `TenantId` (не может быть null), но runtime-рубеж
    // обязан защитить от обходов. `== null` покрывает и `null`, и `undefined`.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime-рубеж: TypeScript-тип не может быть null, но обход через any делает возможным null/undefined в рантайме
    if (tenantId == null) {
      throw new InvalidTenantIdError('tenantId must be a TenantId instance, got undefined/null')
    }
    // Пустая строка после toString — ещё один обходной путь (`new TenantId('')` невозможен
    // из-за uuid-валидации, но защищаем рантайм-рубеж на случай подмены через any).
    if (typeof tenantId.value !== 'string' || tenantId.value.length === 0) {
      throw new InvalidTenantIdError('tenantId.value must be a non-empty UUID string')
    }
  }

  /**
   * Шаблонный метод для подкласса: проверяет tenantId и возвращает
   * «охраняемое» замыкание. Используется наследниками, которые хотят
   * централизованно валидировать перед каждым query (пример:
   * `await this.scoped(tenantId, async (id) => this.db.query...)`).
   *
   * @template T тип возвращаемого значения query-функции
   * @param tenantId проверенный `TenantId`
   * @param fn query-функция, получающая валидированный `tenantId`
   */
  // `async` — ОБЯЗАТЕЛЬНО: без него `assertTenantId` бросает СИНХРОННО (до
  // возврата `Promise`), и вызывающий `repo.scoped(bad, fn).catch(...)`
  // (стандартный promise-паттерн для метода, объявленного как `Promise<T>`)
  // никогда не поймает эту ошибку — она улетает как necaught exception в
  // точке вызова, а не как rejection. `async` гарантирует единообразие:
  // ЛЮБАЯ ошибка (валидация ИЛИ сам `fn`) — rejection одного и того же
  // возвращённого промиса (обнаружено unit-тестом: `.rejects.toThrow(...)`
  // не мог поймать синхронный throw).
  protected async scoped<T>(tenantId: TenantId, fn: (id: TenantId) => Promise<T>): Promise<T> {
    this.assertTenantId(tenantId)
    return fn(tenantId)
  }

  /**
   * Маркер для compile-time проверки, что подкласс действительно
   * параметризован `TEntity`. Не вызывается в рантайме — нужен только для
   * того, чтобы TS-компаратор свёл тип и предъявил ошибку, если наследник
   * «забудет» указать `TEntity`.
   */
  protected readonly _entityBrand?: TEntity
}