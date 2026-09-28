import { describe, expect, it } from 'vitest'
import { buildReportExportObjectKey, isSyncExportPeriod, renderCsvRows } from './report-export.js'

describe('isSyncExportPeriod', () => {
  it('31 день — синхронная ветка', () => {
    expect(isSyncExportPeriod(31)).toBe(true)
  })

  it('32 дня — асинхронная ветка', () => {
    expect(isSyncExportPeriod(32)).toBe(false)
  })
})

describe('buildReportExportObjectKey', () => {
  it('детерминированный ключ от exportJobId + format', () => {
    expect(buildReportExportObjectKey('job-1', 'csv')).toBe('report-exports/job-1.csv')
    expect(buildReportExportObjectKey('job-1', 'xlsx')).toBe('report-exports/job-1.xlsx')
  })
})

describe('renderCsvRows', () => {
  it('простые значения — без экранирования', () => {
    const csv = renderCsvRows([{ a: 'x', b: 1 }], [
      { key: 'a', header: 'A' },
      { key: 'b', header: 'B' },
    ])
    expect(csv).toBe('A,B\r\nx,1')
  })

  it('значение с запятой — оборачивается в кавычки', () => {
    const csv = renderCsvRows([{ a: 'x,y' }], [{ key: 'a', header: 'A' }])
    expect(csv).toBe('A\r\n"x,y"')
  })

  it('значение с кавычкой — кавычка удваивается', () => {
    const csv = renderCsvRows([{ a: 'x"y' }], [{ key: 'a', header: 'A' }])
    expect(csv).toBe('A\r\n"x""y"')
  })

  it('null/undefined — пустая строка', () => {
    const csv = renderCsvRows([{ a: null, b: undefined }], [
      { key: 'a', header: 'A' },
      { key: 'b', header: 'B' },
    ])
    expect(csv).toBe('A,B\r\n,')
  })

  it('пустой массив строк — только заголовок', () => {
    expect(renderCsvRows([], [{ key: 'a', header: 'A' }])).toBe('A')
  })
})
