// BillingInvoicesController — GET листинг + POST mark-paid/lift-block, только super_admin. Тот же приём query/cursor, что FinanceLedgerController.
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common'
import {
  BillingInvoicesListQuerySchema,
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
  ok,
  type BillingInvoiceDto,
  type BillingInvoicesListQueryDto,
  type PaginationMeta,
  type SuccessEnvelope,
} from '@dorutj/contracts'
import { HttpStatus } from '@/common/http/http-status.constants.js'
import { RequestContext } from '@/common/context/request-context.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import type { BillingInvoiceListItem } from '../application/use-cases/list-billing-invoices.use-case.js'
import { ListBillingInvoicesUseCase } from '../application/use-cases/list-billing-invoices.use-case.js'
import { MarkInvoicePaidUseCase } from '../application/use-cases/mark-invoice-paid.use-case.js'
import { LiftInvoiceBlockUseCase } from '../application/use-cases/lift-invoice-block.use-case.js'
import type { FinanceCursor } from '../application/ports/payments-facade.port.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

@Controller({ path: 'finance', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles('super_admin')
export class BillingInvoicesController {
  public constructor(
    @Inject(ListBillingInvoicesUseCase) private readonly listBillingInvoicesUseCase: ListBillingInvoicesUseCase,
    @Inject(MarkInvoicePaidUseCase) private readonly markInvoicePaidUseCase: MarkInvoicePaidUseCase,
    @Inject(LiftInvoiceBlockUseCase) private readonly liftInvoiceBlockUseCase: LiftInvoiceBlockUseCase,
  ) {}

  @Get('billing-invoices')
  public async list(
    @Query(new ZodValidationPipe(BillingInvoicesListQuerySchema)) query: BillingInvoicesListQueryDto,
  ): Promise<SuccessEnvelope<readonly BillingInvoiceDto[]>> {
    const result = await this.listBillingInvoicesUseCase.execute({
      chainId: query['filter[chainId]'],
      invoiceType: query['filter[type]'],
      status: query['filter[status]'],
      limit: query.limit,
      cursor: parseFinanceCursor(query.cursor),
    })
    const pagination: PaginationMeta = {
      nextCursor: result.nextCursor === null ? null : encodeCursor(result.nextCursor),
      hasMore: result.hasMore,
      limit: query.limit,
    }
    return ok(result.items.map(toBillingInvoiceDto), { pagination })
  }

  @Post('billing-invoices/:id/mark-paid')
  @HttpCode(HttpStatus.Ok)
  public async markPaid(@Param('id', ID_PARSE_UUID) id: string, @CurrentUser() claims: JwtClaims): Promise<SuccessEnvelope<BillingInvoiceDto>> {
    const view = await this.markInvoicePaidUseCase.execute({
      invoiceId: id,
      actor: { userId: claims.sub },
      requestId: RequestContext.get()?.requestId ?? null,
    })
    return ok(toBillingInvoiceDto({ ...view, chainName: null }))
  }

  @Post('billing-invoices/:id/lift-block')
  @HttpCode(HttpStatus.Ok)
  public async liftBlock(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body() rawBody: unknown,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<{ readonly liftedBlock: true }>> {
    await this.liftInvoiceBlockUseCase.execute({
      invoiceId: id,
      rawBody,
      actor: { userId: claims.sub },
      requestId: RequestContext.get()?.requestId ?? null,
    })
    return ok({ liftedBlock: true })
  }
}

function parseFinanceCursor(raw: string | undefined): FinanceCursor | null {
  if (raw === undefined) {
    return null
  }
  const decoded = decodeCursor(raw)
  if (decoded === null || typeof decoded.v !== 'string') {
    throw new InvalidCursorError(`Cannot decode cursor: "${raw}"`, { raw })
  }
  return { v: decoded.v, id: decoded.id }
}

function toBillingInvoiceDto(view: BillingInvoiceListItem): BillingInvoiceDto {
  return {
    id: view.id,
    chainId: view.chainId,
    chainName: view.chainName,
    invoiceType: view.invoiceType,
    status: view.status,
    periodStart: view.periodStart.toISOString(),
    periodEnd: view.periodEnd.toISOString(),
    subtotalDiram: view.subtotalDiram,
    vatDiram: view.vatDiram,
    totalDiram: view.totalDiram,
    issuedAt: view.issuedAt?.toISOString() ?? null,
    dueAt: view.dueAt?.toISOString() ?? null,
    paidAt: view.paidAt?.toISOString() ?? null,
  }
}
