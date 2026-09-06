/**
 * Тест `InventoryImportTemplateController` (EP-05, DTJ-159, критерии приёмки).
 *
 * Покрывает:
 *   - xlsx-шаблон содержит 10 заголовков в правильном порядке (и открывается тем же
 *     `exceljs` без ошибок парсинга — round-trip)
 *   - csv-шаблон содержит те же заголовки через запятую, с BOM
 *   - колонка «Срок годности» форматирована как текст (`numFmt='@'`), не date-тип
 *   - `@Roles('pharmacy_admin', 'super_admin')` — метаданные, из которых `RolesGuard`
 *     (её собственный, отдельно протестированный класс) строит 403 для остальных ролей;
 *     полный HTTP-бутстрап здесь НЕ поднимается — ни один существующий контроллер этой
 *     кодовой базы не тестирует `RolesGuard`-отказ через реальный Nest-пайплайн на уровне
 *     unit-спека контроллера (проверено), тот же паттерн сохранён здесь.
 */
import 'reflect-metadata'
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import type { FastifyReply } from 'fastify'
import { ROLES_METADATA_KEY } from '@/modules/auth/index.js'
import {
  InventoryImportTemplateController,
  buildInventoryImportTemplateWorkbook,
} from './inventory-import-template.controller.js'
import {
  INVENTORY_IMPORT_TEMPLATE_EXPIRY_HEADER,
  INVENTORY_IMPORT_TEMPLATE_HEADERS,
} from '../../infrastructure/inventory-import-template.constants.js'

const BOM_CODE_POINT = 0xfeff

function createReplyStub(): {
  reply: FastifyReply
  headers: Record<string, string>
  getBody: () => Buffer
} {
  const headers: Record<string, string> = {}
  let body: Buffer | null = null
  const reply = {
    header(name: string, value: string) {
      headers[name] = value
      return reply
    },
    send(payload: Buffer) {
      body = payload
      return reply
    },
  } as unknown as FastifyReply
  return {
    reply,
    headers,
    getBody: () => {
      if (body === null) throw new Error('reply.send() was not called')
      return body
    },
  }
}

describe('InventoryImportTemplateController (DTJ-159, SRS-INV-012)', () => {
  it('xlsx-шаблон: 200, правильный content-type/disposition, 10 заголовков в порядке SRS-INV-012, читается тем же exceljs', async () => {
    const controller = new InventoryImportTemplateController()
    const { reply, headers, getBody } = createReplyStub()
    await controller.download(undefined, reply)

    expect(headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(headers['content-disposition']).toContain('doru-tj-inventory-template.xlsx')

    const workbook = new ExcelJS.Workbook()
    // `exceljs` → `fast-csv` → `@fast-csv/format` тянет СВОЙ `@types/node@14` (см. `pnpm why
    // @types/node`), конфликтующий с корневым `@types/node@24` (генерик `Buffer<T>`) —
    // `workbook.xlsx.load` типизирован по СТАРОМУ `Buffer` глазами компилятора. Рантайм не
    // затронут (один и тот же класс `Buffer` в одном процессе Node), это чисто структурная
    // типизация двух разных снапшотов `@types/node`; сузить через `unknown` — стандартный обход
    // версийного расхождения транзитивной зависимости, не ошибка в этом коде.
    type XlsxLoadBuffer = Parameters<typeof workbook.xlsx.load>[0]
    await workbook.xlsx.load(getBody() as unknown as XlsxLoadBuffer) // не должно бросить — round-trip
    const worksheet = workbook.worksheets[0]
    expect(worksheet).toBeDefined()
    const headerRow = worksheet?.getRow(1)
    const actualHeaders = INVENTORY_IMPORT_TEMPLATE_HEADERS.map(
      (_, index) => headerRow?.getCell(index + 1).text,
    )
    expect(actualHeaders).toEqual(INVENTORY_IMPORT_TEMPLATE_HEADERS.map((spec) => spec.header))
    expect(actualHeaders).toHaveLength(10)
  })

  it('csv-шаблон (?format=csv): 200, text/csv, заголовки через запятую, BOM в начале файла', async () => {
    const controller = new InventoryImportTemplateController()
    const { reply, headers, getBody } = createReplyStub()
    await controller.download('csv', reply)

    expect(headers['content-type']).toContain('text/csv')
    expect(headers['content-disposition']).toContain('doru-tj-inventory-template.csv')

    const text = getBody().toString('utf-8')
    expect(text.charCodeAt(0)).toBe(BOM_CODE_POINT)
    const firstLine = text.slice(1).split(/\r?\n/)[0]
    expect(firstLine).toBe(INVENTORY_IMPORT_TEMPLATE_HEADERS.map((spec) => spec.header).join(','))
  })

  it('колонка «Срок годности» форматирована как текст (numFmt="@"), не как Excel date-тип (SRS-INV-013)', () => {
    const workbook = buildInventoryImportTemplateWorkbook()
    const worksheet = workbook.worksheets[0]
    const expiryIndex = INVENTORY_IMPORT_TEMPLATE_HEADERS.findIndex(
      (spec) => spec.header === INVENTORY_IMPORT_TEMPLATE_EXPIRY_HEADER,
    )
    const column = worksheet?.getColumn(expiryIndex + 1)
    expect(column?.numFmt).toBe('@')
  })

  it('маршрут ограничен @Roles(pharmacy_admin, super_admin) — pharmacist/customer/courier не проходят RolesGuard', () => {
    const roles: readonly string[] | undefined = Reflect.getMetadata(
      ROLES_METADATA_KEY,
      InventoryImportTemplateController,
    )
    expect(roles).toEqual(['pharmacy_admin', 'super_admin'])
  })
})
