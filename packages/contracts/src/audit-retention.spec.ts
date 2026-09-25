import { describe, expect, it } from 'vitest'
import { AUDIT_LOG_CATEGORY_VALUES } from './admin/audit-log.js'
import { AUDIT_LOG_RETENTION_EXCLUDED_CATEGORY, AUDIT_LOG_RETENTION_YEARS_DEFAULT } from './audit-retention.js'

describe('audit-retention (DTJ-377)', () => {
  it('дефолт хранения — 5 лет (ASSUMPTION тикета)', () => {
    expect(AUDIT_LOG_RETENTION_YEARS_DEFAULT).toBe(5)
  })

  it('исключённая категория — prescription_access, реальное значение audit_action_category', () => {
    expect(AUDIT_LOG_RETENTION_EXCLUDED_CATEGORY).toBe('prescription_access')
    expect(AUDIT_LOG_CATEGORY_VALUES).toContain(AUDIT_LOG_RETENTION_EXCLUDED_CATEGORY)
  })
})
