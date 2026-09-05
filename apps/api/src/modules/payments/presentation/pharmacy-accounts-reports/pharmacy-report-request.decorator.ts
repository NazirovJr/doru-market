/**
 * `@PharmacyReportRequest()` (DTJ-252) — параметр-декоратор, объединяющий `:id` (path,
 * UUID-валидация) + `limit`/`cursor`/`filter[status][in]` (query) в ОДИН параметр контроллера.
 * Без него `GetPayoutsController.list`/`.export`/`GetBillingInvoicesController.list` несли бы
 * 4-5 отдельных `@Param`/`@Query`-параметров, нарушая `max-params` ≤3 (C5) — тот же приём, что
 * `@CartIdentity()` (`orders/presentation/cart/decorators/cart-identity.decorator.ts`, DTJ-226).
 *
 * `:id`-валидация — РУЧНОЙ вызов `ParseUUIDPipe.transform()` (не отдельный `@Param(...,
 * ID_PARSE_UUID)`, композитный декоратор не может параллельно нести второй decorated-параметр
 * на ТОТ ЖЕ путь без превышения лимита) — идентичная гарантия формата, тот же класс Nest, не
 * дублирующая регулярка.
 *
 * `filter[status][in]` — bracket-синтаксис как ЛИТЕРАЛЬНОЕ имя query-параметра (см. JSDoc
 * `pharmacy-accounts-report-query.util.ts`).
 */
import { BadRequestException, ParseUUIDPipe, createParamDecorator, type ArgumentMetadata, type ExecutionContext } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })
const STATUS_FILTER_QUERY_KEY = 'filter[status][in]'
const ID_ARGUMENT_METADATA: ArgumentMetadata = { type: 'param', data: 'id' }

export interface PharmacyReportRequestParams {
  readonly pharmacyId: string
  readonly limitRaw: string | undefined
  readonly cursorRaw: string | undefined
  readonly statusFilterRaw: string | undefined
}

interface RawPharmacyReportRequest {
  readonly params: Record<string, string | undefined>
  readonly query: Record<string, string | string[] | undefined>
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export const PharmacyReportRequest = createParamDecorator(
  async (_data: unknown, ctx: ExecutionContext): Promise<PharmacyReportRequestParams> => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest>() as unknown as RawPharmacyReportRequest
    const rawId = request.params.id
    if (rawId === undefined) {
      throw new BadRequestException('missing required path parameter "id"')
    }
    const pharmacyId = await ID_PARSE_UUID.transform(rawId, ID_ARGUMENT_METADATA)
    return {
      pharmacyId,
      limitRaw: firstValue(request.query.limit),
      cursorRaw: firstValue(request.query.cursor),
      statusFilterRaw: firstValue(request.query[STATUS_FILTER_QUERY_KEY]),
    }
  },
)
