import { Logger } from '@nestjs/common'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NullAuditLogRetentionAdapter } from './null-audit-log-retention.adapter.js'

describe('NullAuditLogRetentionAdapter (DTJ-377)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })


  it('отклоняет deleteBatch с явной ошибкой о незаведённой роли — не тихий no-op/0', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    const adapter = new NullAuditLogRetentionAdapter()

    await expect(adapter.deleteBatch()).rejects.toThrow('AUDIT_RETENTION_DATABASE_URL')
  })

  it('логирует ошибку через pino-логгер (Logger), не console.log (C9)', async () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    const adapter = new NullAuditLogRetentionAdapter()

    await adapter.deleteBatch().catch(() => undefined)

    expect(errorSpy).toHaveBeenCalledTimes(1)
  })
})
