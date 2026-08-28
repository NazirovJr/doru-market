import { describe, expect, it } from 'vitest'
import { buildPinoOptions, createRootLogger } from '@/common/logging/root-logger'
import { RequestContext } from '@/common/context/request-context'
import type { AppConfigService } from '@/config/app-config.service'

function fakeConfig(logLevel: string): AppConfigService {
  return { logLevel } as unknown as AppConfigService
}

describe('createRootLogger', () => {
  it('использует уровень из AppConfigService.logLevel', () => {
    const logger = createRootLogger(fakeConfig('warn'))
    expect(logger.level).toBe('warn')
  })
})

const DUMMY_LOG_LEVEL = 30

describe('buildPinoOptions().mixin (SRS-NFR-038)', () => {
  it('подмешивает requestId/tenantId/userId/role внутри активного RequestContext', () => {
    const { mixin } = buildPinoOptions(fakeConfig('info'))

    let observed: object = {}
    RequestContext.run({ requestId: 'req-1', tenantId: 'tenant-1', userId: null, role: null }, () => {
      observed = mixin?.({}, DUMMY_LOG_LEVEL, undefined as never) ?? {}
    })

    expect(observed).toEqual({ requestId: 'req-1', tenantId: 'tenant-1', userId: null, role: null })
  })

  it('не подмешивает ничего вне активного RequestContext', () => {
    const { mixin } = buildPinoOptions(fakeConfig('info'))

    expect(mixin?.({}, DUMMY_LOG_LEVEL, undefined as never)).toEqual({})
  })
})
