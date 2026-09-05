/**
 * `TenancyFacadeAdapter` (EP-09, DTJ-228/229) — реализация `TenancyFacadePort` поверх
 * `TenantSettingsRepositoryPort` (`modules/tenancy/index.ts`, DTJ-052/229 — экспорт добавлен
 * специально для этого адаптера, см. JSDoc `tenancy/index.ts`). Заменяет отсутствие любого
 * провайдера на `TENANCY_FACADE_PORT` в `orders.module.ts` (без него `CalculateOrderCostService`/
 * `CodPolicyService`/`PaymentMethodEnabledPolicyService` не резолвятся Nest'ом).
 *
 * **`resolveCommissionRate` — ПОКАТЕГОРИЙНЫЙ дефолт (правка по решению CTO, спор №1 отчёта
 * сдачи DTJ-228/229/230).** Первая версия возвращала ОДНУ ставку (500 bps) для любой
 * категории — дефект в деньгах: SRS-DOM-160 (`docs/spec/10-domain-model.md:1109`) фиксирует
 * ставку 500 bps ТОЛЬКО для `rx`, `otc` — 800 bps, `parapharma` — 1200 bps. `commission_bps`
 * снэпшотится на `order_items` НЕИЗМЕНЯЕМО в `Order.create()` (SRS-DOM-008) — заниженная
 * ставка одной категории навсегда остаётся на уже созданных заказах, назад не переставить.
 * Категория (`rx|otc|parapharma`) — параметр, уже приходящий в этот метод (из
 * `CatalogFacadePort.getMedicineSnapshot` выше по стеку, `CalculateOrderCostService`), поэтому
 * покатегорийный дефолт реализуем СЕГОДНЯ, без таблицы. Неизвестная категория — бросает, не
 * подставляет правдоподобное значение (тот же принцип, что чтение-разрешение без безопасного
 * дефолта, D-EP09-16 — только здесь вопрос не «можно ли», а «сколько», и выдуманное число
 * так же недопустимо, как выдуманное разрешение).
 *
 * Недоступной остаётся ТОЛЬКО цепочка специфичности `(tenant,chain,category) >
 * (tenant,chain) > (tenant,category) > (tenant) > global_default` (D-03) — таблицы
 * `commission_rates` (или `platform_fee`, как называл её текст DTJ-228 — проверено `grep -rl
 * platform_fee apps/api/src/db/schema`, таблицы НЕТ ни в одной миграции, EP-10 ещё не
 * приземлился) в схеме нет. `TODO(EP-10)` ниже — только эта часть, не покатегорийный дефолт.
 *
 * `getCodLimitDiram`/`getEnabledPaymentMethods` — РЕАЛЬНЫЕ (DTJ-229, «Что сделать» §2/3):
 * `cod_limit_diram` уже есть в базовой схеме `tenant_settings` (D-EP09-5), читается по-настоящему.
 * `enabledPaymentMethods` — колонки нет (Group C, вне владения) — константный R1-дефолт
 * `['cash_courier']`, СОВПАДАЕТ с `21-module-orders-payments-escrow.md:1271` (`DEFAULT
 * ARRAY['cash_courier']`) — см. JSDoc порта, то же обоснование не повторяется здесь.
 */
import { Inject, Injectable } from '@nestjs/common'
import type { OrderPaymentMethod } from '@dorutj/contracts'
import { TENANT_SETTINGS_REPOSITORY, TenantId, type TenantSettingsRepositoryPort } from '@/modules/tenancy/index.js'
import { COD_LIMIT_DEFAULT_DIRAM } from '@/modules/orders/domain/order-create-command.js'
import {
  TENANCY_FACADE_PORT,
  type CommissionCategory,
  type TenancyFacadePort,
} from '@/modules/orders/application/ports/tenancy-facade.port.js'

/**
 * SRS-DOM-160 (`docs/spec/10-domain-model.md:1109`) — ASSUMPTION-дефолты платформенной
 * комиссии ПО КАТЕГОРИИ, подлежат утверждению заказчиком (D-03), но это ЕДИНСТВЕННЫЙ
 * задокументированный дефолт в проекте — не магическое число, не тест-кейсовая величина
 * (500 bps фигурирует в TC-DOM-006/TC-DOM-038 как сценарная сумма ОДНОГО заказа, не как
 * системный дефолт целиком — этой путаницы придерживалась первая версия этого файла).
 */
const DEFAULT_COMMISSION_BPS_BY_CATEGORY: Readonly<Record<CommissionCategory, number>> = {
  rx: 500,
  otc: 800,
  parapharma: 1200,
}

/** R1-дефолт разрешённых способов оплаты (SRS-ORD-025 п.2, ASSUMPTION документа) — см. JSDoc порта. */
const DEFAULT_ENABLED_PAYMENT_METHODS: readonly OrderPaymentMethod[] = ['cash_courier']

/** DTJ-301 — 1:1 с DB-дефолтом `tenant_settings.pickup_sla_minutes` (D-19, `db/schema/tenants.ts`
 *  `DEFAULT_PICKUP_SLA_MINUTES`) — тот же фолбэк-приём, что `COD_LIMIT_DEFAULT_DIRAM` выше. */
const PICKUP_SLA_MINUTES_DEFAULT = 7

@Injectable()
export class TenancyFacadeAdapter implements TenancyFacadePort {
  constructor(
    @Inject(TENANT_SETTINGS_REPOSITORY) private readonly tenantSettingsRepository: TenantSettingsRepositoryPort,
  ) {}

  /**
   * TODO(EP-10): подключить специфичность `(tenant,chain,category) > ... > global_default`
   * (D-03) через `commission_rates`, когда таблица появится — ПОКАТЕГОРИЙНЫЙ уровень (эта
   * реализация) уже не заглушка, а прямое чтение SRS-DOM-160, останется как fallback ПОД
   * специфичностью, не будет выброшен целиком.
   */
  // async — не просто Promise<number>: throw ниже обязан стать rejected-промисом, не синхронным
  // исключением из вызова метода (иначе caller-ы через .catch()/.then(null, ...), не await/try, не поймали бы).
  // eslint-disable-next-line @typescript-eslint/require-await -- нет await внутри намеренно, async нужен только ради этой семантики
  async resolveCommissionRate(_tenantId: string, _chainId: string | null, category: CommissionCategory): Promise<number> {
    // Каст до `Record<string, number | undefined>` — тот же приём, что `resolveHttpStatus` в
    // `common/filters/all-exceptions.filter.ts`: тип параметра ОБЪЯВЛЯЕТ `CommissionCategory`, но
    // реальное значение может прийти в обход компилятора (легаси-вызов, `as` у чужого кода) —
    // без каста индексация всегда дала бы `number` по типам, и защита ниже была бы мертва.
    const bps = (DEFAULT_COMMISSION_BPS_BY_CATEGORY as Record<string, number | undefined>)[category]
    if (bps === undefined) {
      throw new Error(
        `resolveCommissionRate: unrecognized commission category "${category}" — SRS-DOM-160 has no default for it, refusing to guess a money-affecting value.`,
      )
    }
    return bps
  }

  async getCodLimitDiram(tenantId: string): Promise<bigint> {
    const settings = await this.tenantSettingsRepository.findByTenantId(TenantId.from(tenantId))
    return settings?.codLimitDiram ?? COD_LIMIT_DEFAULT_DIRAM
  }

  /** TODO(Group C): `tenant_settings.enabled_payment_methods` не существует — см. JSDoc файла/порта. */
  getEnabledPaymentMethods(_tenantId: string): Promise<readonly OrderPaymentMethod[]> {
    return Promise.resolve(DEFAULT_ENABLED_PAYMENT_METHODS)
  }

  /** DTJ-301 (SRS-PHT-008/030) — 1:1 с `getCodLimitDiram` выше (тот же `tenantSettingsRepository`). */
  async getPickupSlaMinutes(tenantId: string): Promise<number> {
    const settings = await this.tenantSettingsRepository.findByTenantId(TenantId.from(tenantId))
    return settings?.pickupSlaMinutes ?? PICKUP_SLA_MINUTES_DEFAULT
  }
}

export const TENANCY_FACADE_PORT_PROVIDER = {
  provide: TENANCY_FACADE_PORT,
  useClass: TenancyFacadeAdapter,
} as const
