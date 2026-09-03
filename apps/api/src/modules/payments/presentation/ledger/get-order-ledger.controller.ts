/**
 * `GetOrderLedgerController` (EP-10, DTJ-248, SRS-PAY-016) — `GET /api/v1/orders/:id/ledger`.
 *
 * Живёт в `payments/presentation/**` (`files_owned` тикета), но регистрирует маршрут под
 * `orders/:id/...` — путь и владение модулем НЕЗАВИСИМЫ в Nest (маршрутизация читает
 * `@Controller({path})`, не имя папки). В отличие от `RetryPaymentController` (DTJ-241,
 * `orders/presentation/checkout/retry-payment.controller.ts`), которому пришлось физически
 * переехать в `orders`, чтобы не замкнуть Nest-граф `payments → orders → payments` (см. JSDoc
 * `orders-read-only.adapter.ts`) — ЭТОТ контроллер целиком самодостаточен внутри `payments`
 * (query + свой read-only порт-адаптер), межмодульного импорта `orders` не требует вовсе.
 *
 * `AuthGuard`/`RolesGuard`/`CurrentUser`/`Roles` — публичный фасад `modules/auth` (`02` §1.2,
 * тот же приём, что `RetryPaymentController`). `@Roles('super_admin', 'pharmacy_admin')` —
 * ГРУБЫЙ пропуск (только эти две роли МОГУТ дойти до query) — НЕ дублирует политику видимости:
 * реальная фильтрация полей/записей и проверка «своя сеть» — целиком в `GetOrderLedgerQuery`
 * (`02` §3.4, «Риски» тикета — единая точка политики, не разошедшаяся между слоями).
 *
 * `tenantId` — из `TenantContext` (глобальный `TenantScopeGuard`/`TenantResolutionMiddleware`
 * уже гарантируют резолвленный тенант ДО этого контроллера), НЕ из `claims.tenantId` — тот же
 * приём, что `PharmaciesMapController`/`CartController` (`resolveTenantId()` ниже — намеренно
 * локальная копия, не общий хелпер: 6 независимых копий уже существуют в кодовой базе на
 * момент этого тикета — извлечение общего `common`-хелпера вне периметра DTJ-248, см. отчёт
 * сдачи, «НАЙДЕННЫЕ ЧУЖИЕ ПРОБЛЕМЫ»).
 */
import { Controller, Get, Inject, InternalServerErrorException, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common'
import { ErrorCode, ok, type SuccessEnvelope } from '@dorutj/contracts'
import { TenantContext } from '@/common/context/tenant-context.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { GetOrderLedgerQuery, type LedgerEntryViewDto } from '@/modules/payments/application/queries/get-order-ledger.query.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

@Controller({ path: 'orders', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class GetOrderLedgerController {
  public constructor(@Inject(GetOrderLedgerQuery) private readonly getOrderLedger: GetOrderLedgerQuery) {}

  @Get(':id/ledger')
  @Roles('super_admin', 'pharmacy_admin')
  public async getLedger(
    @Param('id', ID_PARSE_UUID) orderId: string,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<readonly LedgerEntryViewDto[]>> {
    const result = await this.getOrderLedger.execute({
      tenantId: resolveTenantId(),
      orderId,
      actorRole: claims.role,
      actorChainId: claims.chainId,
    })
    return ok(result.entries, { isBalanced: result.meta.isBalanced })
  }
}

/** 1:1 с `pharmacies-map.controller.ts`/`cart.controller.ts` — см. JSDoc файла. */
function resolveTenantId(): string {
  const store = TenantContext.get()
  if (store?.tenantId === undefined || store.tenantId === null) {
    throw new InternalServerErrorException({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'tenant context not resolved (TenantScopeGuard should have rejected earlier)',
    })
  }
  return store.tenantId
}
