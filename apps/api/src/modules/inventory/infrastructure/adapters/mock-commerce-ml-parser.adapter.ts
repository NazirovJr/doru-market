/** R1-мок `CommerceMlParserPort` (DTJ-165): не парсит XML, только проверяет маркер корневого тега. */
import { Injectable } from '@nestjs/common'
import { CommerceMlMalformedXmlError } from '@dorutj/contracts'
import type {
  CommerceMlParserPort,
  CommerceMlParseResult,
  UnresolvedCommerceMlRow,
} from '@/modules/inventory/application/ports/commerce-ml-parser.port.js'

const COMMERCE_ML_ROOT_MARKER = '<КоммерческаяИнформация'

const FIXED_ROWS: readonly UnresolvedCommerceMlRow[] = [
  {
    rowIndex: 0,
    internalSku: 'CML-SKU-1',
    rawBarcode: '4600000000012',
    rawTradeName: 'Парацетамол',
    rawDosageForm: 'таблетки',
    rawDosageStrength: '500мг',
    rawManufacturerName: 'ОАО Фарм',
    priceDiram: 1250n,
    quantity: 100,
    expiresAtIso: '2028-03-15',
    batchNumber: 'B-CML-1',
  },
  {
    rowIndex: 1,
    internalSku: 'CML-SKU-2',
    rawBarcode: '4600000000029',
    rawTradeName: 'Ибупрофен',
    rawDosageForm: 'капсулы',
    rawDosageStrength: '200мг',
    rawManufacturerName: 'ОАО Фарм',
    priceDiram: 800n,
    quantity: 50,
    expiresAtIso: '2027-11-01',
    batchNumber: 'B-CML-2',
  },
  {
    rowIndex: 2,
    internalSku: 'CML-SKU-3',
    rawBarcode: null,
    rawTradeName: 'Аскорбиновая кислота',
    rawDosageForm: 'драже',
    rawDosageStrength: '50мг',
    rawManufacturerName: 'ЗАО Витамин',
    priceDiram: 300n,
    quantity: 200,
    expiresAtIso: '2029-06-30',
    batchNumber: 'B-CML-3',
  },
]

@Injectable()
export class MockCommerceMlParserAdapter implements CommerceMlParserPort {
  // `Promise.reject`, не `throw` — гарантирует отклонение промиса, а не синхронное исключение.
  parse(xml: Buffer): Promise<CommerceMlParseResult> {
    if (!isMarkedAsCommerceMl(xml)) {
      return Promise.reject(
        new CommerceMlMalformedXmlError({ reason: 'missing root element <КоммерческаяИнформация>' }),
      )
    }
    return Promise.resolve({ rows: FIXED_ROWS })
  }
}

function isMarkedAsCommerceMl(xml: Buffer): boolean {
  return xml.length > 0 && xml.toString('utf-8').includes(COMMERCE_ML_ROOT_MARKER)
}
