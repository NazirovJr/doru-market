/** `*` в redact-путях pino покрывает ровно один уровень, рекурсии нет: пути только для
 * верхнего уровня и одного вложенного. */
import { SENSITIVE_FIELD_NAMES } from '@dorutj/contracts'

export function buildSensitiveFieldRedactPaths(): string[] {
  return SENSITIVE_FIELD_NAMES.flatMap((field) => [field, `*.${field}`])
}
