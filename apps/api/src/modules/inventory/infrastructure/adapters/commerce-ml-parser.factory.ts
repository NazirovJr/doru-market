// `real` бросает вместо тихой деградации к моку (в отличие от search-provider.factory.ts) —
// значение уже именовано в ENV-схеме, молчаливый фоллбэк дал бы ложное ощущение готовности.
import { Logger, type Provider } from '@nestjs/common'
import { AppConfigService } from '@/config/app-config.service.js'
import { COMMERCE_ML_PARSER_PORT, type CommerceMlParserPort } from '@/modules/inventory/application/ports/commerce-ml-parser.port.js'
import { MockCommerceMlParserAdapter } from './mock-commerce-ml-parser.adapter.js'

const factoryLogger = new Logger('CommerceMlParserFactory')

export function createCommerceMlParserPort(config: AppConfigService): CommerceMlParserPort {
  const driver = config.commerceMlParserDriver
  if (driver === 'real') {
    factoryLogger.error('COMMERCE_ML_PARSER_DRIVER=real задан, но реальный CommerceML-парсер не реализован в R1')
    throw new Error(
      'CommerceML real-парсер не реализован в R1, используйте driver=mock (COMMERCE_ML_PARSER_DRIVER=mock)',
    )
  }
  return new MockCommerceMlParserAdapter()
}

export const commerceMlParserProvider: Provider = {
  provide: COMMERCE_ML_PARSER_PORT,
  inject: [AppConfigService],
  useFactory: createCommerceMlParserPort,
}
