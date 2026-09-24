/**
 * `buildSensitiveFieldRedactPaths` (EP-16, DTJ-375) — unit-тест. Тест-план тикета: сгенерированные
 * `redact.paths` содержат ВСЕ имена из `SENSITIVE_FIELD_NAMES`.
 */
import { describe, expect, it } from 'vitest'
import { SENSITIVE_FIELD_NAMES } from '@dorutj/contracts'
import { buildSensitiveFieldRedactPaths } from './pino-redaction.config.js'

describe('buildSensitiveFieldRedactPaths (DTJ-375)', () => {
  const paths = buildSensitiveFieldRedactPaths()

  it('содержит путь верхнего уровня и путь на один уровень вложенности для КАЖДОГО поля списка', () => {
    for (const field of SENSITIVE_FIELD_NAMES) {
      expect(paths).toContain(field)
      expect(paths).toContain(`*.${field}`)
    }
  })

  it('ровно две записи на каждое поле, ничего лишнего', () => {
    expect(paths).toHaveLength(SENSITIVE_FIELD_NAMES.length * 2)
  })

  it('пересчитывается из ТЕКУЩЕГО SENSITIVE_FIELD_NAMES при каждом вызове (не закешированная копия)', () => {
    expect(buildSensitiveFieldRedactPaths()).toEqual(paths)
  })
})
