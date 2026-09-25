import { describe, expect, it } from 'vitest'
import type { AppConfigService } from '@/config/app-config.service.js'
import { AppConfigAuditRetentionConfig } from './audit-retention.config.js'

function buildAppConfig(retentionYears: number): AppConfigService {
  return { auditLogRetentionYears: retentionYears } as unknown as AppConfigService
}

describe('AppConfigAuditRetentionConfig (DTJ-377)', () => {
  it('прокидывает retentionYears из AppConfigService, не читает ConfigService напрямую', () => {
    const config = new AppConfigAuditRetentionConfig(buildAppConfig(5))

    expect(config.retentionYears).toBe(5)
  })

  it('меняется вместе с ENV — не захардкожен на 5 (C6)', () => {
    const config = new AppConfigAuditRetentionConfig(buildAppConfig(7))

    expect(config.retentionYears).toBe(7)
  })
})
