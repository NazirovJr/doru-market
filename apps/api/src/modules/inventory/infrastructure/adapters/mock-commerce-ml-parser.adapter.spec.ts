import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CommerceMlMalformedXmlError } from '@dorutj/contracts'
import { MockCommerceMlParserAdapter } from './mock-commerce-ml-parser.adapter.js'

const FILE_URL_PATH = fileURLToPath(import.meta.url)
const SPEC_DIR = dirname(FILE_URL_PATH)
const APPS_API_DIR = resolve(SPEC_DIR, '..', '..', '..', '..', '..')
const FIXTURES_DIR = join(APPS_API_DIR, 'test', 'fixtures', 'commerce-ml')

const validXml = readFileSync(join(FIXTURES_DIR, 'valid-offer-package.xml'))
const invalidXml = readFileSync(join(FIXTURES_DIR, 'invalid-not-commerce-ml.xml'))

describe('MockCommerceMlParserAdapter (DTJ-165, SRS-INV-017/018)', () => {
  it('валидный маркерный XML даёт детерминированный фиксированный набор из 3 строк', async () => {
    const adapter = new MockCommerceMlParserAdapter()

    const result = await adapter.parse(validXml)

    expect(result.rows).toHaveLength(3)
    expect(result.rows[0]).toMatchObject({
      internalSku: 'CML-SKU-1',
      rawTradeName: 'Парацетамол',
      quantity: 100,
    })
    expect(result.rows[0]?.priceDiram).toBe(1250n)
  })

  it('повторный вызов с тем же входом даёт идентичный результат (детерминизм)', async () => {
    const adapter = new MockCommerceMlParserAdapter()

    const first = await adapter.parse(validXml)
    const second = await adapter.parse(validXml)

    expect(second).toEqual(first)
  })

  it('XML без корневого тега <КоммерческаяИнформация> бросает CommerceMlMalformedXmlError (TC-INV-030)', async () => {
    const adapter = new MockCommerceMlParserAdapter()

    await expect(adapter.parse(invalidXml)).rejects.toThrow(CommerceMlMalformedXmlError)
  })

  it('пустой Buffer бросает CommerceMlMalformedXmlError', async () => {
    const adapter = new MockCommerceMlParserAdapter()

    await expect(adapter.parse(Buffer.alloc(0))).rejects.toThrow(CommerceMlMalformedXmlError)
  })
})
