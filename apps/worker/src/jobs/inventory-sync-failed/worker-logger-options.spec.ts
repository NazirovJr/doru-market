import 'reflect-metadata'
import { MODULE_METADATA } from '@nestjs/common/constants'
import type * as PinoModule from 'pino'
import { pino } from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { buildWorkerLoggerOptions } from './worker-logger-options.js'

vi.mock('pino', async (importOriginal) => {
  const actual = await importOriginal<typeof PinoModule>()
  return { ...actual, pino: vi.fn(actual.pino) }
})

const pinoSpy = pino as unknown as ReturnType<typeof vi.fn>

describe('buildWorkerLoggerOptions — редакция чувствительных полей', () => {
  function captureOutput(run: (logger: PinoModule.Logger) => void): string {
    const written: string[] = []
    const logger = pino(buildWorkerLoggerOptions(), { write: (chunk: string) => written.push(chunk) })
    run(logger)
    return written.join('')
  }

  it('password на верхнем уровне не попадает в вывод', () => {
    const output = captureOutput((logger) => {
      logger.info({ password: 'hunter2', ok: 1 }, 'msg')
    })
    expect(output).not.toContain('hunter2')
  })

  it('apiKey, вложенный на один уровень, не попадает в вывод', () => {
    const output = captureOutput((logger) => {
      logger.info({ user: { apiKey: 'sec_live_123' } }, 'msg')
    })
    expect(output).not.toContain('sec_live_123')
  })

  it('обычное поле попадает в вывод без изменений', () => {
    const output = captureOutput((logger) => {
      logger.info({ visibleField: 'not-a-secret' }, 'msg')
    })
    expect(output).toContain('not-a-secret')
  })
})

describe('InventorySyncFailedModule — LOGGER-провайдер реально использует buildWorkerLoggerOptions', () => {
  it('фабрика вызывает pino(buildWorkerLoggerOptions()), а не отдельный конфиг', async () => {
    const { InventorySyncFailedModule } = await import('./inventory-sync-failed.module.js')
    const { LOGGER } = await import('./in-memory-failed-ports.js')

    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, InventorySyncFailedModule) as readonly unknown[]
    const loggerProvider = providers.find(
      (candidate): candidate is { provide: symbol; useFactory: () => unknown } =>
        typeof candidate === 'object' && candidate !== null && (candidate as { provide?: unknown }).provide === LOGGER,
    )
    if (loggerProvider === undefined) throw new Error('LOGGER provider not found in InventorySyncFailedModule')

    pinoSpy.mockClear()
    loggerProvider.useFactory()

    expect(pinoSpy).toHaveBeenCalledWith(buildWorkerLoggerOptions())
  })
})
