import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { renderXlsx } from './xlsx-renderer.js'

describe('renderXlsx', () => {
  it('строит читаемую книгу с заголовками и строками', async () => {
    const buffer = await renderXlsx([{ name: 'Панадол', price: 15 }], [
      { key: 'name', header: 'Название' },
      { key: 'price', header: 'Цена' },
    ])

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0])
    const worksheet = workbook.worksheets[0]
    expect(worksheet?.getRow(1).getCell(1).value).toBe('Название')
    expect(worksheet?.getRow(1).getCell(2).value).toBe('Цена')
    expect(worksheet?.getRow(2).getCell(1).value).toBe('Панадол')
    expect(worksheet?.getRow(2).getCell(2).value).toBe(15)
  })
})
