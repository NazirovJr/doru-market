/**
 * `GetPayoutsController` (EP-10, DTJ-252, АС3/АС4/АС5) — `GET /api/v1/pharmacy-accounts/:id/
 * payouts` (курсорный список) + `GET .../payouts/export?format=csv` (полный CSV-поток). ОДИН
 * контроллер на оба маршрута (общий `:id`/роли/гварды) — `files_owned` тикета называет ровно
 * этот один файл, не отдельный контроллер под экспорт.
 *
 * `AuthGuard`/`RolesGuard`/`CurrentUser`/`Roles` — публичный фасад `modules/auth` (тот же приём,
 * что `GetOrderLedgerController`, DTJ-248). `@Roles(...)` — ГРУБЫЙ пропуск (пропускает 3 роли,
 * способные ДОЙТИ до query), РЕАЛЬНАЯ политика (АС5: `pharmacist` — только своя аптека,
 * `pharmacy_admin` — только своя сеть) — целиком в `GetPharmacyPayoutsQuery`/`ExportPayoutsCsvQuery`
 * (`pharmacy-report-access.util.ts`), единая точка, не разошедшаяся между слоями.
 *
 * `:id` в пути — `pharmacyId` (АС3 текст тикета: «курсорный список payout_schedule ЭТОЙ
 * аптеки»), НЕ `chainId` — `pharmacy_admin` видит СВОЮ СЕТЬ, проверяется резолвом
 * `pharmacyId → chainId` внутри query, не по буквальному совпадению `:id`.
 *
 * CSV-маршрут — РУЧНОЙ `FastifyReply` (`@Res()` БЕЗ `passthrough`, тот же приём, что
 * `ApiDocsController`, `common/openapi/openapi.module.ts`): `ResponseInterceptor` оборачивает
 * ЛЮБОЕ возвращённое контроллером значение в JSON-конверт — CSV обязан обойти его целиком
 * (`Content-Type: text/csv`, сырое тело, АС4 DoD). `format=csv` в query — НЕ читается: это
 * единственный поддерживаемый формат в R1, параметр в URL — для будущей расширяемости, не
 * дискриминатор ветвления сегодня.
 */
import { Controller, Get, Inject, Res, UseGuards } from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import { encodeCursor, ok, type PaginationMeta, type SuccessEnvelope } from '@dorutj/contracts'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { ExportPayoutsCsvQuery } from '@/modules/payments/application/queries/export-payouts-csv.query.js'
import { GetPharmacyPayoutsQuery, type PayoutViewDto } from '@/modules/payments/application/queries/get-pharmacy-payouts.query.js'
import { parseListQuery, parseStatusesFilter } from './pharmacy-accounts-report-query.util.js'
import { PharmacyReportRequest, type PharmacyReportRequestParams } from './pharmacy-report-request.decorator.js'

const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8'
const REPORT_ROLES = ['super_admin', 'pharmacy_admin', 'pharmacist'] as const

@Controller({ path: 'pharmacy-accounts', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class GetPayoutsController {
  public constructor(
    @Inject(GetPharmacyPayoutsQuery) private readonly getPayouts: GetPharmacyPayoutsQuery,
    @Inject(ExportPayoutsCsvQuery) private readonly exportPayoutsCsv: ExportPayoutsCsvQuery,
  ) {}

  @Get(':id/payouts')
  @Roles(...REPORT_ROLES)
  public async list(
    @PharmacyReportRequest() request: PharmacyReportRequestParams,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<readonly PayoutViewDto[]>> {
    const { limit, cursor } = parseListQuery(request.limitRaw, request.cursorRaw)
    const result = await this.getPayouts.execute({
      pharmacyId: request.pharmacyId,
      actor: { role: claims.role, chainId: claims.chainId, pharmacyId: claims.pharmacyId },
      statuses: parseStatusesFilter(request.statusFilterRaw),
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

  @Get(':id/payouts/export')
  @Roles(...REPORT_ROLES)
  public async export(
    @PharmacyReportRequest() request: PharmacyReportRequestParams,
    @CurrentUser() claims: JwtClaims,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const csv = await this.exportPayoutsCsv.execute({
      pharmacyId: request.pharmacyId,
      actor: { role: claims.role, chainId: claims.chainId, pharmacyId: claims.pharmacyId },
      statuses: parseStatusesFilter(request.statusFilterRaw),
    })
    reply.header('content-type', CSV_CONTENT_TYPE)
    reply.send(csv)
  }
}
