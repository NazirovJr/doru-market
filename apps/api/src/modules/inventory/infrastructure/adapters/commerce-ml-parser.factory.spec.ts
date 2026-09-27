import { describe, expect, it } from 'vitest'
import type { FactoryProvider } from '@nestjs/common'
import type { AppConfigService } from '@/config/app-config.service.js'
import { COMMERCE_ML_PARSER_PORT, type CommerceMlParserPort } from '@/modules/inventory/application/ports/commerce-ml-parser.port.js'
import { createCommerceMlParserPort, commerceMlParserProvider } from './commerce-ml-parser.factory.js'
import { MockCommerceMlParserAdapter } from './mock-commerce-ml-parser.adapter.js'

function fakeConfig(driver: 'mock' | 'real' | undefined): AppConfigService {
  return { commerceMlParserDriver: driver ?? 'mock' } as unknown as AppConfigService
}

describe('createCommerceMlParserPort (SRS-INV-017/018, реальная развилка)', () => {
  it('COMMERCE_ML_PARSER_DRIVER не задан (дефолт mock) → MockCommerceMlParserAdapter (AC4)', () => {
    const port = createCommerceMlParserPort(fakeConfig(undefined))
    expect(port).toBeInstanceOf(MockCommerceMlParserAdapter)
  })

  it('COMMERCE_ML_PARSER_DRIVER="mock" → MockCommerceMlParserAdapter', () => {
    const port = createCommerceMlParserPort(fakeConfig('mock'))
    expect(port).toBeInstanceOf(MockCommerceMlParserAdapter)
  })

  it('COMMERCE_ML_PARSER_DRIVER="real" → бросает понятную ошибку конфигурации, не молчит (AC3)', () => {
    expect(() => createCommerceMlParserPort(fakeConfig('real'))).toThrow(/не реализован в R1/)
  })
})

describe('commerceMlParserProvider (D-27 DI-биндинг)', () => {
  const factoryProvider = commerceMlParserProvider as FactoryProvider<CommerceMlParserPort>

  it('провайдер зарегистрирован на токен COMMERCE_ML_PARSER_PORT', () => {
    expect(factoryProvider.provide).toBe(COMMERCE_ML_PARSER_PORT)
  })

  it('useFactory ссылается на createCommerceMlParserPort', () => {
    expect(factoryProvider.useFactory).toBe(createCommerceMlParserPort)
  })
})
