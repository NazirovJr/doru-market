/**
 * `GetBillingInvoicesController` (EP-10, DTJ-252, п.5) — `GET /api/v1/pharmacy-accounts/:id/
 * billing-invoices`, курсорный список `platform_billing_invoices` сети, которой принадлежит
 * аптека `:id`. Тот же приём, что `GetPayoutsController` (гварды/`CurrentUser`/парсинг query) —
 * `@Roles('super_admin', 'pharmacy_admin')` БЕЗ `pharmacist` (в отличие от payouts, см. ticket
 * п.5 vs п.3): грубый пропуск на уровне гварда уже исключает `pharmacist`, дополнительно
 * подтверждается `assertChainReportAccess` внутри `GetBillingInvoicesQuery` (единая точка
 * политики).
 */
import { Controller, Get, Inject, UseGuards } from '@nestjs/common'
import { encodeCursor, ok, type PaginationMeta, type SuccessEnvelope } from '@dorutj/contracts'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { GetBillingInvoicesQuery, type BillingInvoiceViewDto } from '@/modules/payments/application/queries/get-billing-invoices.query.js'
import { parseListQuery } from './pharmacy-accounts-report-query.util.js'
import { PharmacyReportRequest, type PharmacyReportRequestParams } from './pharmacy-report-request.decorator.js'

@Controller({ path: 'pharmacy-accounts', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class GetBillingInvoicesController {
  public constructor(@Inject(GetBillingInvoicesQuery) private readonly getBillingInvoices: GetBillingInvoicesQuery) {}

  @Get(':id/billing-invoices')
  @Roles('super_admin', 'pharmacy_admin')
  public async list(
    @PharmacyReportRequest() request: PharmacyReportRequestParams,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<readonly BillingInvoiceViewDto[]>> {
    const { limit, cursor } = parseListQuery(request.limitRaw, request.cursorRaw)
    const result = await this.getBillingInvoices.execute({
      pharmacyId: request.pharmacyId,
      actor: { role: claims.role, chainId: claims.chainId },
      limit,
      cursor,
    })
    const pagination: PaginationMeta = {
      nextCursor: result.nextCursor === null ? null : encodeCursor(result.nextCursor),
      hasMore: result.hasMore,
      limit,
    }
    return ok(result.items, { pagination })
  }
}
