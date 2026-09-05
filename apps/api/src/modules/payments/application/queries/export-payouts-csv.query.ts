/**
 * `ExportPayoutsCsvQuery` (EP-10, DTJ-252, АС4) — `GET /api/v1/pharmacy-accounts/:id/payouts/
 * export?format=csv`. Те же данные и ролевая политика, что `GetPharmacyPayoutsQuery`
 * (`pharmacy-report-access.util.ts`), но ПОЛНЫЙ поток без курсорной пагинации (DoD тикета) —
 * `PayoutScheduleRepository.findAllByPharmacy`, не `findByPharmacy`.
 *
 * CSV-экспорт — ПЕРВЫЙ прецедент в кодовой базе (проверено: `grep` по `text/csv`/`csv-stringify`
 * не находит ничего до этого тикета) — нет существующего форматтера для переиспользования.
 * RFC4180-квотирование (поле в `"..."` при наличии `,`/`"`/CR/LF, внутренние `"` → `""`) — DoD.
 *
 * CSV/formula injection (поле, начинающееся с `=`/`+`/`-`/`@`, Excel/Sheets трактует как
 * формулу при открытии) — нейтрализовано ведущим `'` на СТРОКОВЫХ полях (`orderId`/
 * `orderNumber`/`status`). Числовые (`*Diram`) и датные (`dueAt`/`paidAt`) ячейки форматируются
 * ОТДЕЛЬНО (`String(bigint)`/`toISOString()`) — их значение полностью контролируется этим кодом,
 * формульный префикс структурно недостижим, доп. защита была бы декорацией без эффекта.
 * `orderId`/`status` — тоже серверные (UUID/enum), `orderNumber` — строгий формат `DTJ-YYMMDD-
 * NNNNN` (`OrderNumber.parse`), НИ ОДНО поле реально не может начинаться с триггер-символа
 * сегодня — защита применена уницифировано на ВСЕ строковые поля как defense-in-depth (дешевле,
 * чем разбирать «нужно ли» для каждого поля отдельно, и переживает будущие изменения формата).
 */
import { Inject, Injectable } from '@nestjs/common'
import {
  PAYOUT_SCHEDULE_REPOSITORY,
  type PayoutReportRow,
  type PayoutScheduleRepository,
} from '@/modules/payments/application/ports/payout-schedule-repository.port.js'
import { PHARMACY_CHAIN_LOOKUP, type PharmacyChainLookupPort } from '@/modules/payments/application/ports/pharmacy-chain-lookup.port.js'
import { assertPharmacyReportAccess, type PharmacyReportActor } from './pharmacy-report-access.util.js'

export interface ExportPayoutsCsvInput {
  readonly pharmacyId: string
  readonly actor: PharmacyReportActor
  readonly statuses?: readonly string[] | undefined
}

const CSV_HEADER = ['orderId', 'orderNumber', 'grossAmountDiram', 'commissionDiram', 'netAmountDiram', 'status', 'dueAt', 'paidAt'] as const
const CSV_LINE_BREAK = '\r\n'
/** Excel/Sheets формульные триггеры (OWASP CSV Injection) — ведущий символ ячейки. */
const FORMULA_TRIGGER_CHARS: ReadonlySet<string> = new Set(['=', '+', '-', '@'])
const NEEDS_QUOTING_PATTERN = /["\r\n,]/u

@Injectable()
export class ExportPayoutsCsvQuery {
  public constructor(
    @Inject(PAYOUT_SCHEDULE_REPOSITORY) private readonly payoutRepository: PayoutScheduleRepository,
    @Inject(PHARMACY_CHAIN_LOOKUP) private readonly chainLookup: PharmacyChainLookupPort,
  ) {}

  public async execute(input: ExportPayoutsCsvInput): Promise<string> {
    await assertPharmacyReportAccess(this.chainLookup, input.pharmacyId, input.actor)
    const rows = await this.payoutRepository.findAllByPharmacy(input.pharmacyId, input.statuses)
    return toCsv(rows)
  }
}

function toCsv(rows: readonly PayoutReportRow[]): string {
  const lines = [CSV_HEADER.join(',')]
  for (const row of rows) {
    lines.push(
      [
        csvStringField(row.orderId),
        csvStringField(row.orderNumber),
        String(row.grossAmountDiram),
        String(row.commissionDiram),
        String(row.netAmountDiram),
        csvStringField(row.status),
        row.dueAt?.toISOString() ?? '',
        row.paidAt?.toISOString() ?? '',
      ].join(','),
    )
  }
  return lines.join(CSV_LINE_BREAK) + CSV_LINE_BREAK
}

/** RFC4180-квотирование + formula-injection нейтрализация одного строкового поля (см. JSDoc файла). */
function csvStringField(value: string): string {
  const neutralized = FORMULA_TRIGGER_CHARS.has(value.charAt(0)) ? `'${value}` : value
  if (!NEEDS_QUOTING_PATTERN.test(neutralized)) {
    return neutralized
  }
  return `"${neutralized.replace(/"/gu, '""')}"`
}
