/**
 * Доменные ошибки модуля `inventory` (EP-05, DTJ-160), уровень application/presentation
 * (не путать с `inventory_sync_row_error_code` — построчные коды батча, они НЕ HTTP-ошибки,
 * живут только в `inventory_sync_errors.error_code`, см. модуль 22 SRS-INV-013/014).
 *
 * Отдельный файл, НЕ дописано в `domain-errors.ts` (та же причина, что `domain-errors-security.ts`/
 * `domain-errors-pharmacy-terminal.ts` — split по max-lines, `domain-errors.ts` уже за порогом
 * 300 строк). Импорт — ОДНОСТОРОННИЙ (этот файл → `domain-errors.ts`), см. их JSDoc про цикл
 * `class X extends ValidationError`.
 */
import { ErrorCode } from './errors.js'
import { ValidationError } from './domain-errors.js'

/**
 * SRS-INV-012/014 — файл Excel/CSV-импорта остатков не содержит одну (или более) ОБЯЗАТЕЛЬНУЮ
 * колонку шаблона (`INVENTORY_IMPORT_TEMPLATE_HEADERS`) — весь файл отклоняется ДО построчного
 * разбора, это ошибка структуры файла, не отдельной строки.
 */
export class ExcelTemplateHeaderMismatchError extends ValidationError {
  constructor(details?: Record<string, unknown>) {
    super('Excel/CSV template header mismatch: a required column is missing', details, ErrorCode.EXCEL_TEMPLATE_HEADER_MISMATCH)
  }
}
