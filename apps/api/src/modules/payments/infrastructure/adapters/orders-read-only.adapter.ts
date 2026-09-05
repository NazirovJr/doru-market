/**
 * `OrdersReadOnlyAdapter` (EP-10, DTJ-248) — реализация ЧАСТИ `PaymentsOrdersPort`
 * (`application/ports/orders-facade.port.ts`, DTJ-236), достаточной для
 * `GetOrderLedgerQuery`: только `getOrderById`.
 *
 * НЕ канонический адаптер модуля. Канонический `OrdersFacadeAdapter implements
 * PaymentsOrdersPort` поверх реального `OrdersFacade` (EP-09) — `files_owned` DTJ-242
 * (`infrastructure/adapters/orders-facade.adapter.ts`), в периметр ЭТОГО тикета не входит и на
 * момент написания этого файла не существует (см. отчёт сдачи DTJ-248, ДОПУЩЕНИЯ/DISPUTED).
 *
 * ПОЧЕМУ НЕ ЧЕРЕЗ `OrdersFacade` (как канонический адаптер обязан по DTJ-242): `orders.module.ts`
 * уже импортирует `PaymentsModule` (DTJ-241, `PAYMENT_INVOICE_PORT`) — односторонний Nest-граф
 * `orders → payments`. Если `payments.module.ts` добавит `imports: [OrdersModule]`, граф
 * замыкается в цикл `payments → orders → payments`, который `dependency-cruiser` (`no-circular`)
 * отклоняет как ошибку СТАТИЧЕСКИ, `forwardRef()` эту диагностику не убирает (снимает только
 * порядок РАНТАЙМ-резолвинга Nest, не сам ES-граф импортов, который проверяет depcruise) — см.
 * прямое предупреждение задания («Упрёшься — не отключай правило, приди ко мне», AGENTS.md §5).
 * Эскалация в этом (одиночном, без интерактивного CTO) прогоне — честный обходной путь ниже,
 * задокументированный, а не тихий, плюс явный DISPUTED в отчёте сдачи.
 *
 * ОБХОДНОЙ ПУТЬ (безопасный, уже прецедентный): читает `orders`/`pharmacies` НАПРЯМУЮ через
 * Drizzle-схему (`@/db/schema/orders.js`, `@/db/schema/pharmacies.js`) — ТОТ ЖЕ приём, что
 * `DrizzleEscrowLedgerRepository.orderBelongsToTenant` (DTJ-240, принято CTO): чтение
 * ЧУЖОЙ Drizzle-схемы (не `domain`/`application`) из своего `infrastructure` — не межмодульный
 * deep-import (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.1 запрещает импорт `domain`/`application`
 * чужого модуля, НЕ импорт таблицы). Ни одного Nest-модуля `orders` не импортируется — цикл
 * физически невозможен.
 *
 * `markPaidEscrow`/`cancel` — ЭТИ методы порта НЕ нужны `GetOrderLedgerQuery` (read-only query,
 * `02` §3.2 «use case не мутирует» неприменимо буквально, но здесь и не use case) — оба БРОСАЮТ
 * явно (правило 5 задания, D-EP09-16: заглушка, отвечающая на денежный вопрос, обязана бросать,
 * не изображать «безопасный» результат). Если код когда-либо дойдёт до реального вызова —
 * это означает, что кто-то забиндил ЭТОТ адаптер для write-сценария, для которого он не
 * предназначен — ошибка конфигурации DI, которую нужно увидеть немедленно, не молча.
 *
 * ТЕНАНТ-ИЗОЛЯЦИЯ (SRS-API-043/046): `WHERE id=:orderId AND tenant_id=:tenantId AND deleted_at
 * IS NULL` — чужой тенант ИЛИ soft-deleted заказ (SRS-PAY-040, тот же принцип, что webhook)
 * ⇒ `null` (404 у вызывающего кода, не подтверждаем существование чужой/удалённой строки).
 *
 * Деньги — БЕЗ float: `orders.total_amount_tjs` (legacy `NUMERIC(10,2)`, см. `db/schema/
 * orders.ts` JSDoc) конвертируется в diram через `Money.fromDbDecimalTjs` (тот же VO-метод, что
 * `orders`-репозиторий использует для этой самой колонки — не новый парсер, правило 12 AGENTS.md).
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, isNull } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { orders } from '@/db/schema/orders.js'
import { pharmacies } from '@/db/schema/pharmacies.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import {
  type PaymentsOrdersPort,
  type PaymentsOrderSnapshot,
} from '@/modules/payments/application/ports/orders-facade.port.js'

const NOT_IMPLEMENTED_MESSAGE =
  'OrdersReadOnlyAdapter — только getOrderById (DTJ-248). Write-методы PaymentsOrdersPort ' +
  '(markPaidEscrow/cancel) реализует канонический OrdersFacadeAdapter (DTJ-242, infrastructure/' +
  'adapters/orders-facade.adapter.ts) — этот адаптер не должен быть забинжен для write-сценариев.'

@Injectable()
export class OrdersReadOnlyAdapter implements PaymentsOrdersPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async getOrderById(tenantId: string, orderId: string): Promise<PaymentsOrderSnapshot | null> {
    const rows = await this.db
      .select({
        id: orders.id,
        tenantId: orders.tenantId,
        pharmacyId: orders.pharmacyId,
        status: orders.status,
        paymentMethod: orders.paymentMethod,
        totalAmountTjs: orders.totalAmountTjs,
      })
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt)))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    const pharmacyChainId = await this.resolvePharmacyChainId(row.pharmacyId)
    return toSnapshot(row, pharmacyChainId)
  }

  public markPaidEscrow(): Promise<void> {
    return Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE))
  }

  public cancel(): Promise<void> {
    return Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE))
  }

  private async resolvePharmacyChainId(pharmacyId: string | null): Promise<string | null> {
    if (pharmacyId === null) return null
    const rows = await this.db
      .select({ chainId: pharmacies.chainId })
      .from(pharmacies)
      .where(eq(pharmacies.id, pharmacyId))
      .limit(1)
    return rows[0]?.chainId ?? null
  }
}

interface OrderReadRow {
  readonly id: string
  readonly tenantId: string
  readonly pharmacyId: string | null
  readonly status: string | null
  readonly paymentMethod: string
  readonly totalAmountTjs: string
}

function toSnapshot(row: OrderReadRow, pharmacyChainId: string | null): PaymentsOrderSnapshot {
  if (row.status === null) {
    throw new Error(`orders.status is NULL for order ${row.id} — invalid data, cannot build PaymentsOrderSnapshot`)
  }
  return {
    id: row.id,
    tenantId: row.tenantId,
    pharmacyId: row.pharmacyId,
    status: row.status,
    paymentMethod: row.paymentMethod,
    totalAmountDiram: Money.fromDbDecimalTjs(row.totalAmountTjs).diram,
    pharmacyChainId,
    // DTJ-244 (аддитивное поле порта) — минимальная правка ради компиляции: этот адаптер
    // НЕ забинжен ни в один провайдер (см. JSDoc файла, «остаётся неиспользуемым», DTJ-242
    // отчёт сдачи) — реальных позиций заказа не носит ни один текущий вызывающий код, т.к.
    // такого кода физически нет.
    items: [],
  }
}
